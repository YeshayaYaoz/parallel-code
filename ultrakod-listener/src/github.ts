// GitHub REST API access: the issue queue (list/label/comment/close) and
// driving .github/workflows/claude-queue.yml on-demand for Claude coding
// tasks. Uses a plain PAT via fetch — no SDK dependency needed for this
// handful of well-established, stable REST endpoints.

import type { QueuedTask } from './types.js';
import type { RoutingMode } from './registry.js';

const GITHUB_API = 'https://api.github.com';

function repoFromEnv(): { owner: string; repo: string } {
  const full = process.env.GITHUB_REPOSITORY;
  if (!full) {
    throw new Error('GITHUB_REPOSITORY env var is required (e.g. "yourname/yourrepo").');
  }
  const [owner, repo] = full.split('/');
  if (!owner || !repo) {
    throw new Error(`GITHUB_REPOSITORY must be "owner/repo", got: ${full}`);
  }
  return { owner, repo };
}

function authHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN env var is required (a PAT with repo + workflow scope).');
  }
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'ultrakod-listener',
  };
}

function parseMode(labels: string[]): RoutingMode {
  if (labels.includes('mode:cheap')) return 'cheap';
  if (labels.includes('mode:extra')) return 'extra';
  return 'balanced';
}

export async function listQueuedTasks(): Promise<QueuedTask[]> {
  const { owner, repo } = repoFromEnv();
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/issues?state=open&labels=queued-task&per_page=100`,
    { headers: authHeaders() },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to list issues: HTTP ${res.status}${body ? ` — ${body}` : ''}`);
  }

  const issues = (await res.json()) as Array<{
    number: number;
    title: string;
    body: string | null;
    labels: Array<{ name: string } | string>;
  }>;

  const tasks: QueuedTask[] = [];
  for (const issue of issues) {
    const labelNames = issue.labels.map((l) => (typeof l === 'string' ? l : l.name));
    const claimed =
      labelNames.includes('claude-in-progress') ||
      labelNames.includes('claude-stuck') ||
      labelNames.includes('ultrakod-in-progress') ||
      labelNames.includes('ultrakod-stuck');
    if (claimed) continue;

    tasks.push({
      number: issue.number,
      title: issue.title,
      body: issue.body ?? '',
      mode: parseMode(labelNames),
      needsRepoAccess: labelNames.includes('coding-task'),
    });
  }
  return tasks.sort((a, b) => a.number - b.number);
}

export async function addLabel(issueNumber: number, label: string): Promise<void> {
  const { owner, repo } = repoFromEnv();
  await fetch(`${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}/labels`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ labels: [label] }),
  });
}

export async function removeLabel(issueNumber: number, label: string): Promise<void> {
  const { owner, repo } = repoFromEnv();
  try {
    await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`,
      { method: 'DELETE', headers: authHeaders() },
    );
  } catch {
    // Label may not have been present — not fatal.
  }
}

export async function commentOnIssue(issueNumber: number, body: string): Promise<void> {
  const { owner, repo } = repoFromEnv();
  await fetch(`${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
}

/** Comment bodies on an issue, oldest first — used to count prior retry
 *  attempts without needing separate persisted state (mirrors the same
 *  technique claude-queue.yml uses for its own retry cap). */
export async function listCommentBodies(issueNumber: number): Promise<string[]> {
  const { owner, repo } = repoFromEnv();
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100`,
    { headers: authHeaders() },
  );
  if (!res.ok) return [];
  const comments = (await res.json()) as Array<{ body: string | null }>;
  return comments.map((c) => c.body ?? '');
}

let cachedDefaultBranch: string | null = null;

async function getDefaultBranch(owner: string, repo: string): Promise<string> {
  if (cachedDefaultBranch) return cachedDefaultBranch;
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Failed to look up default branch: HTTP ${res.status}${body ? ` — ${body}` : ''}`,
    );
  }
  const data = (await res.json()) as { default_branch: string };
  cachedDefaultBranch = data.default_branch;
  return cachedDefaultBranch;
}

export interface WorkflowRunResult {
  conclusion: 'success' | 'failure' | 'timed_out';
  runUrl?: string;
}

/**
 * Triggers .github/workflows/claude-queue.yml for one specific issue/model
 * (rather than letting it auto-pick the oldest queued issue on its own cron),
 * then polls until that run finishes. This is what makes the listener able to
 * react in seconds instead of waiting for the workflow's 15-minute cron tick.
 */
export async function runClaudeWorkflow(args: {
  issueNumber: number;
  model: string;
}): Promise<WorkflowRunResult> {
  const { owner, repo } = repoFromEnv();
  const ref = await getDefaultBranch(owner, repo);
  const dispatchedAt = new Date();

  const dispatchRes = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/actions/workflows/claude-queue.yml/dispatches`,
    {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ref,
        inputs: { issue_number: String(args.issueNumber), model: args.model },
      }),
    },
  );
  if (!dispatchRes.ok) {
    throw new Error(`Failed to dispatch claude-queue workflow: HTTP ${dispatchRes.status}`);
  }

  const runId = await findDispatchedRun(owner, repo, dispatchedAt);
  if (!runId) return { conclusion: 'timed_out' };

  return pollRunUntilDone(owner, repo, runId);
}

/** workflow_dispatch doesn't return a run id directly, so find the run it
 *  just created by matching on creation time — the technique GitHub's own
 *  docs recommend for this gap. */
async function findDispatchedRun(
  owner: string,
  repo: string,
  after: Date,
  attempts = 10,
): Promise<number | null> {
  for (let i = 0; i < attempts; i++) {
    await sleep(3000);
    const res = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/actions/workflows/claude-queue.yml/runs?event=workflow_dispatch&per_page=5`,
      { headers: authHeaders() },
    );
    if (res.ok) {
      const data = (await res.json()) as {
        workflow_runs: Array<{ id: number; created_at: string }>;
      };
      const match = data.workflow_runs.find((run) => new Date(run.created_at) >= after);
      if (match) return match.id;
    }
  }
  return null;
}

async function pollRunUntilDone(
  owner: string,
  repo: string,
  runId: number,
  maxWaitMs = 20 * 60 * 1000,
): Promise<WorkflowRunResult> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/actions/runs/${runId}`, {
      headers: authHeaders(),
    });
    if (res.ok) {
      const run = (await res.json()) as {
        status: string;
        conclusion: string | null;
        html_url: string;
      };
      if (run.status === 'completed') {
        return {
          conclusion: run.conclusion === 'success' ? 'success' : 'failure',
          runUrl: run.html_url,
        };
      }
    }
    await sleep(10_000);
  }
  return { conclusion: 'timed_out' };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
