import {
  getModelForMode,
  MODEL_REGISTRY,
  type ModelInfo,
  type Provider,
  type RoutingMode,
} from './registry.js';
import {
  isAvailable,
  markCoolingDown,
  clearCooldown,
  unavailableProviderIds,
} from './cooldowns.js';
import { anthropicAdapter } from './providers/anthropic.js';
import { openaiAdapter } from './providers/openai.js';
import { geminiAdapter } from './providers/gemini.js';
import { deepseekAdapter } from './providers/deepseek.js';
import { mistralAdapter } from './providers/mistral.js';
import * as gh from './github.js';
import type { ProviderAdapter, QueuedTask } from './types.js';
import {
  listPendingCliTasks,
  markCliTaskAnswered,
  markCliTaskFailedAttempt,
  type CliTaskRecord,
} from './cli-tasks.js';

const ADAPTERS: Record<Provider, ProviderAdapter> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  google: geminiAdapter,
  deepseek: deepseekAdapter,
  mistral: mistralAdapter,
};

// Repo-editing coding tasks only ever run through Claude today — see the
// long comment in runCodingTask() for why. This is the tier -> Claude-model
// mapping used for that path regardless of what the cost/tier router would
// otherwise pick for a Q&A task in the same mode.
const CLAUDE_MODEL_BY_MODE: Record<RoutingMode, string> = {
  cheap: 'claude-haiku-4-5',
  balanced: 'claude-sonnet-5',
  extra: 'claude-opus-4-8',
};

function claudeModelForMode(mode: RoutingMode): ModelInfo {
  return MODEL_REGISTRY[CLAUDE_MODEL_BY_MODE[mode]];
}

function excludedModelIds(): string[] {
  const unavailable = new Set(unavailableProviderIds());
  return Object.values(MODEL_REGISTRY)
    .filter((m) => unavailable.has(m.provider) || !ADAPTERS[m.provider].isConfigured())
    .map((m) => m.id);
}

/**
 * Picks the best model for a task's mode, skipping providers that are
 * currently cooling down or unconfigured. This alone is what implements
 * "switch to the second-best model, then switch back" — there's no separate
 * switchback code path. Every task re-runs this fresh, so the moment a
 * cooldown clears, that provider re-enters the candidate pool and wins again
 * on the very next task if it's still the best-ranked option.
 */
function pickModel(task: QueuedTask): ModelInfo | null {
  return getModelForMode(task.mode, excludedModelIds());
}

/**
 * Processes every currently-queued task once. Q&A tasks are awaited in order
 * (they're one HTTP call each, fast); coding tasks are fired off without
 * waiting, because driving claude-queue.yml to completion can take up to
 * ~20 minutes (a real GitHub Actions run) and blocking the loop on that would
 * stall every other queued task — including fast Q&A ones — for the duration.
 * Multiple coding tasks dispatched in the same pass are still safely
 * serialized by claude-queue.yml's own `concurrency` group, so this can't
 * flood Actions with parallel runs.
 */
export async function processQueueOnce(): Promise<void> {
  const tasks = await gh.listQueuedTasks();

  for (const task of tasks) {
    const model = pickModel(task);
    if (!model) {
      await gh.commentOnIssue(
        task.number,
        '⚠️ No configured model is currently available for this task (all candidates are cooling down or missing credentials). Will keep checking.',
      );
      continue;
    }

    await gh.addLabel(task.number, 'ultrakod-in-progress');

    if (task.needsRepoAccess) {
      void runCodingTask(task, model).finally(() =>
        gh.removeLabel(task.number, 'ultrakod-in-progress'),
      );
    } else {
      try {
        await runQaTask(task, model);
      } finally {
        await gh.removeLabel(task.number, 'ultrakod-in-progress');
      }
    }
  }
}

// Same convention as runQaTask's MAX_QA_RETRIES: cap retries so a
// persistently-broken task stops silently retrying forever. Unlike the
// GitHub-issue queue there's no comment thread to spam, but the underlying
// reason (don't retry a real error forever) is the same.
const MAX_CLI_TASK_ATTEMPTS = 20;

function buildCliPrompt(task: CliTaskRecord): string {
  const parts = [task.context.transcriptExcerpt];
  if (task.context.gitDiff) parts.push(`Git diff:\n${task.context.gitDiff}`);
  if (task.context.gitStatus) parts.push(`Git status:\n${task.context.gitStatus}`);
  parts.push(`User: ${task.prompt}`);
  return parts.join('\n\n');
}

/**
 * Processes every currently-pending CLI-queue task once — the live-terminal
 * counterpart to processQueueOnce() above. Submitted directly by the
 * Parallel Code desktop app (see cli-tasks.ts) rather than via a GitHub
 * issue, and always a plain text continuation (no repo access) — a task
 * needing real file edits is the existing GitHub coding-task path's job,
 * not this one's; see README "Known limitations".
 */
export async function processCliQueueOnce(): Promise<void> {
  const tasks = listPendingCliTasks();

  for (const task of tasks) {
    const model = getModelForMode(task.mode, excludedModelIds());
    if (!model) continue; // nothing available yet — try again next pass

    const response = await ADAPTERS[model.provider].ask(buildCliPrompt(task), model);

    if (response.ok) {
      markCliTaskAnswered(task.id, response.text, model.name);
      clearCooldown(model.provider);
      continue;
    }

    if (response.quotaExceeded) {
      markCoolingDown(model.provider, response.resetAt);
      continue; // leave pending — the next pass will pick the next-best model
    }

    markCliTaskFailedAttempt(task.id, response.error, MAX_CLI_TASK_ATTEMPTS);
  }
}

async function runCodingTask(task: QueuedTask, pickedModel: ModelInfo): Promise<void> {
  // Only Claude has a verified-safe unattended, auto-approving execution path
  // today (claude-code-action, already wired up in claude-queue.yml). Codex
  // CLI and Gemini CLI both exist and Parallel Code itself already drives
  // them interactively, but neither has a confirmed, documented "run
  // unattended in CI, auto-approve every edit, commit and open a PR" mode
  // verified here — guessing at that flag is exactly the kind of mistake that
  // could silently do the wrong thing with real repo write access. So: repo
  // edits always go through Claude, regardless of which provider the
  // cost/tier router would otherwise pick for this task's mode.
  const model = pickedModel.provider === 'anthropic' ? pickedModel : claudeModelForMode(task.mode);

  if (!isAvailable('anthropic')) {
    await gh.commentOnIssue(
      task.number,
      '⏳ Claude is cooling down and is currently the only provider trusted with repo edits. Will retry once its window resets.',
    );
    return;
  }

  const result = await gh.runClaudeWorkflow({ issueNumber: task.number, model: model.id });

  if (result.conclusion === 'success') {
    clearCooldown('anthropic');
    return;
  }
  if (result.conclusion === 'failure') {
    // claude-queue.yml already posts its own retry/backoff comment on the
    // issue — we only need to track the cooldown so pickModel() routes
    // around Claude for other queued Q&A tasks in the meantime.
    markCoolingDown('anthropic');
  }
  // 'timed_out' (couldn't even find/poll the dispatched run) — leave no
  // cooldown; this is a listener-side plumbing hiccup, not a signal about
  // Claude's actual availability.
}

// Same convention as claude-queue.yml's MAX_RETRIES: cap retries so a
// permanently-broken task (not just a temporarily rate-limited one) stops
// retrying and spamming comments forever, instead surfacing for a manual look.
const MAX_QA_RETRIES = 20;
const RETRY_COMMENT_RE = /^(🔁|⚠️)/;

async function runQaTask(task: QueuedTask, model: ModelInfo): Promise<void> {
  const adapter = ADAPTERS[model.provider];
  const response = await adapter.ask(task.body, model);

  if (response.ok) {
    await gh.commentOnIssue(task.number, `**${model.name}** answered:\n\n${response.text}`);
    await gh.addLabel(task.number, 'ultrakod-answered');
    clearCooldown(model.provider);
    return;
  }

  if (response.quotaExceeded) {
    markCoolingDown(model.provider, response.resetAt);
  }

  const priorAttempts = (await gh.listCommentBodies(task.number)).filter((body) =>
    RETRY_COMMENT_RE.test(body),
  ).length;
  const attempt = priorAttempts + 1;

  if (attempt >= MAX_QA_RETRIES) {
    await gh.addLabel(task.number, 'ultrakod-stuck');
    await gh.commentOnIssue(
      task.number,
      `⚠️ Failed ${attempt} times in a row across available models — stopping automatic retries. Last error from ${model.name}: ${response.error}. Remove the \`ultrakod-stuck\` label to re-queue.`,
    );
    return;
  }

  if (response.quotaExceeded) {
    await gh.commentOnIssue(
      task.number,
      `🔁 ${model.name} is rate-limited/out of quota (attempt ${attempt}/${MAX_QA_RETRIES}) — routing this task to the next-best model.`,
    );
  } else {
    await gh.commentOnIssue(
      task.number,
      `⚠️ ${model.name} failed (attempt ${attempt}/${MAX_QA_RETRIES}): ${response.error}`,
    );
  }
}
