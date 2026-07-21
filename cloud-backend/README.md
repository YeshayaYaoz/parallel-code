# cloud-backend

Standalone (non-Electron) Parallel Code backend: git worktree management, CLI
agent PTY spawning, and the MCP sub-task coordinator, extracted from the
desktop app's Electron main process so a project's tasks can run in a cloud
container instead of on one local machine. Speaks the same WebSocket+REST
protocol the desktop app already uses for phone control
(`src/server-remote.ts`, ported from `electron/remote/server.ts`
unchanged) — so the existing client code needs no changes to attach to a
remote instance of this service instead of `localhost:7777`.

## Local development

```sh
npm install
npm run dev     # tsx src/index.ts, listens on :7777 by default
npm test
npm run typecheck
```

`npm run sync-registry` keeps `src/registry.ts` in sync with
`electron/ultrakod/registry.ts` (the canonical model-routing table) — it runs
automatically before `dev`/`test`/`typecheck`, and CI fails if the committed
copy has drifted.

## Configuration

| Env var         | Default                    | Meaning                                                                                                                        |
| --------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`          | `7777`                     | HTTP/WS listen port                                                                                                            |
| `HOST`          | `0.0.0.0`                  | Listen address                                                                                                                 |
| `DATA_DIR`      | `~/.parallel-code-cloud`   | Where `state.json`/`coordinator-snapshot.json` live (the Fly volume mount point in production)                                 |
| `PROJECT_ROOT`  | _(unset)_                  | Git repo checkout this instance manages. **Required** for plain task creation (`/api/mobile/*`) — without it those routes 503. |
| `PROJECT_ID`    | `default`                  | Arbitrary ID returned by `GET /api/mobile/projects`                                                                            |
| `PROJECT_NAME`  | basename of `PROJECT_ROOT` | Display name for the same                                                                                                      |
| `AGENT_COMMAND` | `claude`                   | CLI spawned for a newly created plain task                                                                                     |
| `AGENT_ARGS`    | `[]`                       | JSON array of extra args, e.g. `'["--model","claude-opus-4-8"]'`                                                               |

## Creating a task

On boot, the service logs two credentials — don't confuse them:

```
[server] cloud-backend listening on http://<host>:7777?token=<mobile-token>
[server] operator (coordinator) token: <coordinator-token>
```

The URL's embedded token is **mobile-scoped** (read-only agent status — safe
to hand to a phone). The **coordinator token**, logged separately, is the
full-access operator credential: it's what lets you create tasks, read/write
`/api/state`, and drive the coordinator API. Treat it like an SSH key — it's
meant for whoever can read this process's own logs (`fly logs`), not for
pasting into a browser URL bar.

With `PROJECT_ROOT` set, create and drive a task with plain `curl` — no
desktop app or MCP client required:

```sh
TOKEN=<coordinator-token>

# What project(s) this instance manages
curl -H "Authorization: Bearer $TOKEN" http://localhost:7777/api/mobile/projects

# Create a task — this makes a real git worktree + spawns AGENT_COMMAND in it
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"projectId":"default","name":"fix-the-bug","prompt":"investigate the crash"}' \
  http://localhost:7777/api/mobile/tasks
# => {"taskId":"..."}

# See it running
curl -H "Authorization: Bearer $TOKEN" http://localhost:7777/api/agents

# Read its scrollback (base64) — decode to see terminal output
curl -H "Authorization: Bearer $TOKEN" http://localhost:7777/api/agents/<agentId>
```

To actually interact with it live (type into it, watch it stream), connect a
WebSocket to `ws://<host>:<port>` with `{"type":"auth","token":"<coordinator
or mobile token>"}`, then `{"type":"subscribe","agentId":"..."}` and
`{"type":"input","agentId":"...","data":"...\n"}` — this is exactly the
protocol `src/remote/ws.ts` (the desktop app's bundled mobile client) already
speaks, so pointing that client at this service's URL works today with no
client-side changes.

**Not yet wired**: the desktop Electron app itself has no "point at a remote
cloud-backend instead of my local one" setting — today it always runs its
own local backend. Driving a cloud-backend instance means talking to its
REST/WS API directly (as above), or pointing the `src/remote` mobile SPA at
it; it isn't yet a toggle inside the main desktop UI.

## Deploying to Fly.io

One Fly app/machine per **project**, not per task — a project's tasks all
share the same worktree parent dir and the same running coordinator, so they
belong on the same machine. If you run more than one project in the cloud,
repeat this whole guide with a different `app` name and volume per project.

### Prerequisites

- A Fly.io account (`fly auth signup` / `fly auth login`).
- [`flyctl`](https://fly.io/docs/flyctl/install/) installed locally.
- This repo checked out locally (deploys build from `cloud-backend/`).

### First deploy

Every `fly` command below passes `cloud-backend` as the working directory —
that single positional argument is enough to tell flyctl "this is the app
root," which is where it finds both `fly.toml` (with the `app =` name) and
`Dockerfile`. **Don't also add `--config`/`--dockerfile` pointing back at
`cloud-backend/...` on top of it** — flyctl resolves those paths _relative to
the working directory you just gave it_, so `--config cloud-backend/fly.toml`
actually looks for the nonexistent `cloud-backend/cloud-backend/fly.toml`,
silently falls back to an empty config, and fails with a confusing "missing
an app name" error. The working-directory argument alone is both necessary
and sufficient; run these from the repo root:

```sh
# Creates the app on Fly and asks a few questions (region, etc.) — it will
# offer to rewrite `app =` in fly.toml to a name you own; accept that,
# each project needs a unique app name.
fly launch --no-deploy --copy-config cloud-backend

# Create the persistent volume fly.toml's [[mounts]] expects. Must be in the
# same region you picked above (iad by default — pass --region to match).
fly volumes create cloud_backend_data --size 1 --region iad --config cloud-backend/fly.toml

fly deploy cloud-backend
```

The service needs an actual git repo on its volume before it can create
tasks — clone one onto it after the first deploy:

```sh
fly secrets set PROJECT_ROOT=/data/repo --config cloud-backend/fly.toml

fly ssh console --config cloud-backend/fly.toml
# inside the machine:
git clone https://github.com/you/your-repo /data/repo
exit
```

`fly ssh console` connects as **root**, while the service itself runs as the
unprivileged `agent` user — so a repo cloned this way is root-owned, and
git's dubious-ownership check will refuse to let `agent` touch it (every
git call in `git.ts` then collapses that refusal into a misleading
"repository with no commits" error). The Dockerfile already sets
`safe.directory '*'` system-wide to prevent this, but if you're running an
image built before that fix, add the exception by hand after cloning:

```sh
fly ssh console --config cloud-backend/fly.toml
git config --system --add safe.directory /data/repo
exit
```

`fly deploy` builds `cloud-backend/Dockerfile` and starts one machine. The
service prints its connection URL (with an embedded mobile-scoped token) on
boot:

```sh
fly logs --config cloud-backend/fly.toml
# [server] cloud-backend listening on http://<host>:7777?token=<token>
# [server] operator (coordinator) token: <token>
```

That URL is what the desktop app (or `src/remote` mobile client) points at
instead of `localhost:7777` — same WebSocket/REST protocol either way. The
separately-logged operator token (not the one embedded in the URL) is what
you paste into the desktop app's project settings — see "Creating a task"
above.

### Scale-to-zero

`fly.toml` sets `min_machines_running = 0` and `auto_stop_machines = "stop"`,
so the machine suspends itself after the configured idle grace period and
Fly auto-starts it again on the next incoming connection (cold start is
typically 1-2 seconds). This is the entire cost lever: a project with no
client attached and no coordinator actively running costs nothing beyond the
~1GB volume while idle.

Two things keep a machine alive against your will, worth knowing about before
you're surprised by a bill:

- **An active coordinator** (unattended sub-task runs) keeps the process
  busy, which Fly's proxy treats as "not idle" — that's intentional, it's
  supposed to keep working with no client connected. See "Unattended
  coordinator" below.
- **A `tcp_checks` health probe** (configured in `fly.toml`, every 15s)
  counts as traffic on some Fly configurations. If you see a project that
  never suspends and nothing is actually running, check `fly status` and
  consider loosening or removing the health check for pure cost-sensitive
  projects.

### Cost expectations

Per the cloud-migration plan: a `shared-cpu-1x`/1GB machine at realistic
bursty personal usage (a few active hours/day) should land around
**$3-10/month**, plus **~$1-3/month** for the 1GB volume. Track your actual
bill for the first week after deploying — this is an estimate, not a
guarantee, and Fly's pricing can change.

### Updating

```sh
fly deploy cloud-backend
```

This rebuilds the image and does a rolling restart. In-progress PTY sessions
on the old machine are lost on restart (no live-migration of running
processes) — land or wrap up active tasks before deploying, or rely on the
auto-hydration below to pick task bookkeeping back up.

### Multiple projects

Repeat the whole guide in a separate `fly launch` with its own app name and
volume — there is currently no multi-project routing inside a single
cloud-backend instance (see `src/coordinator.ts`'s `setDefaultProject`, which
is one-project-per-process by design).

## State persistence

`GET`/`PUT /api/state` (coordinator-token only) lets a client read/write the
app's opaque state blob remotely instead of local disk — see
`src/persistence.ts`. Server-side, that data lives at `$DATA_DIR/state.json`
(the Fly volume mount point), with one rolling `.bak` backup.

## Unattended coordinator

Restarting the container (a `fly deploy`, a scale-to-zero wake, a crash) does
not restart the CLI agent processes it had spawned — those die with the
container like any other PTY would. What it _does_ restore automatically on
boot is the coordinator's own bookkeeping — which coordinators were
registered and which sub-tasks they knew about — from
`$DATA_DIR/coordinator-snapshot.json`, so `GET /api/tasks` and friends don't
simply forget everything the moment the process restarts (see
`src/coordinator-persistence.ts`). A snapshot is written on every coordinator
state change, so the file only ever lags by one event.

This does not by itself spawn a fresh coordinator CLI process after a
restart — that still requires the same MCP-server bootstrap
(`.mcp.json` + `setMCPServerInfo`) a client establishes today. What it
guarantees is that the service's task bookkeeping survives a restart even if
no client reconnects immediately afterward.
