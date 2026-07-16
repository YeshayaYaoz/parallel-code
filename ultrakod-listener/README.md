# ultrakod-listener

An always-on router for the ultrakod task queue. Deploys standalone (e.g. to
Railway) as the "brain": it decides which model/provider should handle each
queued task right now — factoring in cost, throughput, and which providers are
currently rate-limited — and reacts within seconds instead of waiting for a
cron tick. It's the "hands" for actual repo edits — that's still
`.github/workflows/claude-queue.yml`, which this service drives on demand via
`workflow_dispatch` rather than reimplementing git/PR plumbing here.

## How it works

This service has two independent entry points into the same router/cooldown/
provider-adapter machinery:

- **The GitHub-issue queue** (below) — manual, works from anywhere (even your
  phone), and its coding-task path can make real repo edits via
  `claude-queue.yml`.
- **The live CLI queue** (`POST /cli-tasks`) — automatic, submitted directly
  by the Parallel Code desktop app the moment one of its terminal sessions
  detects a rate limit. It's plain-text continuation only (no repo edits —
  see "Known limitations"): the app sends the pending input plus a compacted
  context bundle (recent transcript, git diff/status), this service answers
  it once a suitable model is available (possibly hours later, even with
  your computer off), and the app resends the answer into that same terminal
  session next time it's running. Auth is a single shared bearer token
  (`ULTRAKOD_CLI_KEY`), not a GitHub PAT. See `src/cli-tasks.ts`.

### GitHub-issue queue

1. Open a GitHub issue with the `queued-task` label — that's the queue.
   Optional labels: `mode:cheap` / `mode:balanced` / `mode:extra` (default
   `balanced`), and `coding-task` if it needs repo edits (default: treated as
   a plain question, answered as a comment — repo write access is opt-in).
2. Every `POLL_INTERVAL_MS` (default 10s), this service lists open queued
   tasks and, for each one, picks the best available model for its mode from
   `src/registry.ts`, skipping any provider that's currently cooling down
   (rate-limited) or missing its API key.
3. **Plain-question tasks** get answered directly via that provider's API,
   posted back as an issue comment.
4. **Coding tasks** always route through Claude specifically (see
   "Coding-task fallback is Claude-only" under Known Limitations below) via
   `claude-queue.yml`, triggered precisely for that issue instead of waiting
   for its own 15-minute cron.
5. If a provider comes back rate-limited (HTTP 429, or Claude's CLI reporting
   something that looks like a usage-limit message), it's marked cooling down
   and the task falls to the next-best model for that mode. There's no
   separate "switch back" code path — every task re-picks fresh, so the
   moment a cooldown clears, that provider is simply the best option again on
   the next matching task.
6. A Q&A task that keeps failing for a non-quota reason (a real, persistent
   error, not just "everything's rate-limited right now") stops retrying
   after 20 attempts and gets labeled `ultrakod-stuck` instead of retrying —
   and commenting — forever. Remove that label to re-queue it once you've
   looked into why it kept failing.

## One-time setup

1. **GitHub token**: create a PAT (fine-grained, scoped to this repo) with
   `Issues: read/write`, `Contents: read`, `Actions: read/write` permissions.
2. **Claude**: run `claude setup-token` locally, copy the printed token.
3. Deploy to Railway:
   - New service → "Deploy from GitHub repo" → this repo.
   - **Root Directory**: `ultrakod-listener` (so Railway builds and runs this
     package specifically, not the whole monorepo).
   - Build command: `npm install && npm run build`
   - Start command: `npm start`
4. Add these as Railway service variables:

   | Variable                  | Required?                                           | Purpose                                                                                                                                                                     |
   | ------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `GITHUB_REPOSITORY`       | yes                                                 | `owner/repo`, e.g. `yourname/parallel-code`                                                                                                                                 |
   | `GITHUB_TOKEN`            | yes                                                 | the PAT from step 1                                                                                                                                                         |
   | `CLAUDE_CODE_OAUTH_TOKEN` | yes (for any task)                                  | from `claude setup-token` — also needed by claude-queue.yml as a repo secret, separately                                                                                    |
   | `PREFERRED_PROVIDER`      | no (default `anthropic`)                            | which provider to route back to once available                                                                                                                              |
   | `OPENAI_API_KEY`          | no                                                  | enables OpenAI as a Q&A fallback/candidate                                                                                                                                  |
   | `GEMINI_API_KEY`          | no                                                  | enables Gemini as a Q&A fallback/candidate                                                                                                                                  |
   | `DEEPSEEK_API_KEY`        | no                                                  | enables DeepSeek as a Q&A fallback/candidate                                                                                                                                |
   | `MISTRAL_API_KEY`         | no                                                  | enables Mistral as a Q&A fallback/candidate                                                                                                                                 |
   | `POLL_INTERVAL_MS`        | no (default 10000)                                  | how often to check the queue                                                                                                                                                |
   | `ULTRAKOD_CLI_KEY`        | no (required for the live CLI queue)                | shared bearer secret the Parallel Code app authenticates `/cli-tasks` requests with — generate any long random string and paste it into both Railway and the app's settings |
   | `CLI_TASKS_DIR`           | no (default `data/cli-tasks` under the working dir) | where queued CLI-task JSON files are stored — see the volume note below                                                                                                     |

   Any provider without its API key configured is simply excluded from
   routing (`isConfigured()` check) — you don't need all of them.

5. **If you're using the live CLI queue** (`POST /cli-tasks`, driven by the
   Parallel Code app's own terminal sessions rather than GitHub issues):
   attach a **Railway volume** and mount it at (or so that it contains)
   `CLI_TASKS_DIR`. Without a volume, queued-but-not-yet-answered tasks are
   lost on redeploy/restart — unlike cooldown state, this is real pending
   user input, not something safe to just re-probe.

## Known limitations (read before relying on this)

- **Coding-task fallback is Claude-only, not cross-provider.** Only Claude has
  a verified-safe unattended execution path (`claude-code-action`, already
  battle-tested in `claude-queue.yml`). Codex CLI and Gemini CLI exist and
  Parallel Code itself already drives them interactively, but neither has a
  confirmed, documented "run unattended, auto-approve every edit, commit and
  open a PR" mode verified here — guessing at that flag is exactly the kind
  of mistake that could silently misbehave with real repo write access. So
  when Claude is cooling down, a coding task **waits** for it rather than
  falling back to a different provider; only Claude's own haiku/sonnet/opus
  tier changes with mode. Extending this to other providers is a real
  follow-up, gated on verifying each CLI's non-interactive flags are actually
  safe — not something to guess at.
- **This operates at the level of discrete queued tasks (GitHub issues), not
  live conversations.** It does not interrupt an in-progress interactive
  terminal session in the Parallel Code app and hot-swap its model mid-turn.
  "Compacted context handoff" here means each task's issue body — there's no
  cross-vendor way to hand one provider's actual internal session state to a
  different vendor's model; that's not a gap specific to this service, it's
  a hard constraint of these being separate products with no shared session
  format.
- **Cooldown state is in-memory only** — it resets on redeploy/restart. Cheap
  self-correcting cost for a personal-scale router: worst case is briefly
  re-probing a provider that was already known to be cooling down.
- **No push-notification channel is wired up.** A provider coming back from
  cooldown is logged (visible via Railway's log viewer) and immediately
  affects routing, but nothing pings your phone. Wiring up something like
  ntfy.sh is a small, easy follow-up if you want that.
- **Gemini and Mistral model API slugs are best-effort**, not independently
  confirmed — their official pricing/model-list pages blocked automated
  fetches during registry research (see `src/registry.ts`'s header comment).
  A wrong slug surfaces as an HTTP 404 from that provider, not silent
  misbehavior; check `src/providers/gemini.ts` / `mistral.ts` if that happens.
- **`src/registry.ts` is a synced copy, not hand-maintained — but it IS
  committed.** The single source of truth is `electron/ultrakod/registry.ts`
  (used by the desktop app's own `ultrakod` CLI). Never edit
  `src/registry.ts` directly: edit the source file, then run
  `npm run sync-registry` here and commit the result. It's committed rather
  than generated at Railway build time because Railway's Root Directory
  setting for this service scopes its build to `ultrakod-listener/` only —
  `../../electron/ultrakod/registry.ts` genuinely isn't there (confirmed by a
  failed deploy, not assumption), so `build`/`start` can't depend on reaching
  outside this directory. CI (`.github/workflows/ci.yml`) re-runs the sync
  and fails if the committed copy has drifted from the source, so a forgotten
  sync can't silently ship.
