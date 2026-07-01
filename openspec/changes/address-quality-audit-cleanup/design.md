## Context

Local `main` was fetched from the ASRagab fork and fast-forwarded to `origin/main` at `bf60990`; `upstream/main` points at the same commit. Issue #161 remains open and lists four audit findings.

Current investigation found:

- Finding 36 remains: `electron/mcp/coordinator.test.ts` is 6081 lines and duplicates fs, fs/promises, pty, git, task, channel, renderer, timer, and write-inspection setup. `electron/mcp/coordinator-sequence.test.ts` repeats the same mock stack in a smaller smoke test.
- Finding 37 remains: `src/store/test-helpers.ts` does not exist. Store tests still duplicate core-store proxies, path/producible `setStore` mutations, `produce` passthroughs, and reset blocks.
- Finding 40 remains: `screens/` is 54M across 22 tracked files. README references only seven files. Fifteen files are unreferenced by tracked markdown; five high-confidence raw/video alternates account for about 35 MiB.
- Finding 42 is mostly resolved by merged PR #186: `electron/ipc/steps.ts` has no `console.warn` and now uses structured main-process logging. One renderer-side regular-event warning remains at `src/App.tsx` for `[steps.recv]`.

Recent PR overlap:

- #177 added coordinator replay coverage and split store focus helpers, but did not extract test harnesses.
- #183 expanded `focus.test.ts`, increasing the value of a store helper.
- #186 addressed the main-process `steps.ts` warning spam.
- #193 is open and touches `electron/mcp/coordinator.test.ts`; rebase immediately before implementation/PR.
- #179 is open and store-heavy; do not depend on it, but rebase if it lands.

## Goals / Non-Goals

**Goals:**

- Create one coordinator test harness that centralizes duplicated Vitest mocks, default coordinator setup, PTY output helpers, backend-task fixtures, renderer event queries, and write-inspection helpers.
- Create one generic store test helper for core-store proxying, `setStore` mutation emulation, `produce` passthroughs, and reset helpers.
- Migrate tests enough to prove the helpers are used across files and remove the duplicated setup called out in issue #161.
- Prune the largest high-confidence unreferenced media files while preserving every README-rendered screen asset.
- Remove regular steps receive warning noise from the renderer, or route it to debug logging if an appropriate renderer logger path exists.
- Record targeted validation commands and a concrete upstream PR flow.

**Non-Goals:**

- No production coordinator behavior changes.
- No full rewrite of every coordinator assertion or store test body.
- No migration of opt-in real-agent or real-PTY integration tests into the unit-test harness.
- No Git LFS setup in the minimum PR unless the maintainer explicitly requests it.
- No deletion of ambiguous unreferenced PNG screenshots unless the implementation confirms they are obsolete or the maintainer approves.

## Decisions

### Coordinator harness shape

Use a colocated test-only helper under `electron/mcp/`, for example `coordinator-test-harness.ts` or `coordinator.test-harness.ts`.

The helper owns the Vitest mock stack and dynamically imports `Coordinator` only after mocks are registered. It returns the imported `Coordinator`, a default `coordinator` instance, mock handles, a mock renderer, PTY helpers, task fixtures, and write-inspection helpers.

Minimum API:

- `setupCoordinatorHarness(options?)`
- `resetCoordinatorMocks(options?)`
- `mockNextTask(task)`
- `registerDefaultCoordinator(overrides?)`
- `createCoordinatorTask(overrides?)`
- `getOutputCb(index?)`, `emitAgentOutput(text, index?)`, `deliverReadyPrompt(args?)`
- `getAgentId(index?)`, `getSpawnHandler()`, `getExitHandler()`
- `getAgentTextWrites(agentId?)`
- `getSubtaskConfigWrites()`
- `getSettingsLocalWrites()`
- `rendererEvents(channel?)`

Alternative considered: keep helpers inside `coordinator.test.ts` and import them from the sequence test. Rejected because cross-file imports from a test file are brittle, hide Vitest module ordering, and keep the largest file as the owner of shared test infrastructure.

### Coordinator migration order

Migrate `coordinator-sequence.test.ts` first because it is small and proves cross-file mock reuse. Then migrate shared setup and helper use in `coordinator.test.ts` without rewriting assertions broadly.

Alternative considered: refactor the 6081-line test file in one pass. Rejected because it would create a high-conflict diff while #193 is open.

### Store helper shape

Create `src/store/test-helpers.ts` with generic test utilities only. It must not import production `./core` at runtime.

Minimum API:

- `createMockStoreHarness<T>(initial, options?)` returning mutable state access, store proxy, `setStore` mock, `reset`, `applySetStore`, and `moduleMock(extra?)`.
- `mockSolidStoreProduce()` for tests that currently mock Solid's `produce` as a passthrough.
- Optional `resetRealStore(setStore, overrides?)` only if it removes repeated reset lists in real-store tests without obscuring intent.

Alternative considered: separate helpers per store area. Rejected because the duplicated code is generic store mutation/proxy plumbing, not feature-specific setup.

### Store migration order

Migrate simple mocked-core tests first: `ui`, `appearance-mode`, `focus`, and `navigation`. Then migrate `agents`, `notifications`, `taskStatus`, `tasks`, and `sidebar-order` if the call sites shrink and remain explicit. Keep IPC/window/coordinator-specific setup local or in separate helpers.

Alternative considered: forcing all store tests through the helper. Rejected because `persistence`, `pr-checks`, `autosave`, and `projects` use the real store and only need a tiny reset helper, if any.

### Media cleanup scope

Minimum PR removes only high-confidence unreferenced raw/video alternates:

- `screens/demo.mov`
- `screens/demo.gif`
- `screens/longer-video.mp4`
- `screens/longer-video.mkv`
- `screens/best-video.mkv`

Keep every README-referenced asset:

- `screens/longer-video.gif`
- `screens/islands-overview.png`
- `screens/islands-focus-view.png`
- `screens/diff-dialog-code-comments.png`
- `screens/ai-arena-mode.png`
- `screens/showcase.mp4`
- `screens/best-video.gif`

Defer unreferenced PNG variants unless a maintainer confirms they are obsolete. This cuts about 35 MiB with minimal review risk.

Alternative considered: remove all unreferenced screens in one PR. Rejected for the minimum strategy because several PNGs look like feature captures rather than raw alternates.

### Steps logging cleanup

Do not reopen `electron/ipc/steps.ts`; #186 already moved routine send/watch events to structured logging. Remove `console.warn('[steps.recv]', ...)` from `src/App.tsx` or route it through renderer debug logging so regular receive events no longer appear as warnings.

Alternative considered: leave `src/App.tsx` alone and only cite #186. Rejected because issue #161 is about noisy regular-event warnings, and the renderer still has one.

### Upstream PR flow

Create a branch from current synced fork main, for example `fix/issue-161-test-harness-media-hygiene`. Before opening the PR, fetch/rebase against upstream main and check open PR #193. Push to `ASRagab/parallel-code`, then create a PR to `johannesjo/parallel-code:main` that links issue #161, lists which findings are addressed, and notes that #186 already handled the main-process steps watcher portion.

## Risks / Trade-offs

- Vitest mock ordering can break Coordinator imports → keep dynamic import inside the coordinator harness after mocks are registered and validate both coordinator test files in one command.
- A store helper can hide meaningful per-test differences → keep feature-specific overrides explicit and migrate only call sites where plumbing is the duplicated part.
- Media deletion reduces checkout weight but not existing git history size → present the PR as current-tree cleanup, and mention release assets or Git LFS only as maintainer-approved follow-up.
- #193 can conflict with coordinator test extraction → rebase immediately before coding and again before PR creation if #193 lands.
- #179 can change store shape → keep helper defaults override-friendly and re-run targeted store tests after rebase.
- Removing renderer steps warning can reduce ad-hoc debugging visibility → prefer renderer debug logging if the existing logger supports it; otherwise delete the regular-event warning.

## Migration Plan

1. Rebase branch on latest `upstream/main` / fork `origin/main`.
2. Implement coordinator harness and migrate `coordinator-sequence.test.ts`, then the shared setup in `coordinator.test.ts`.
3. Implement store helper and migrate duplicated mocked-core store tests.
4. Remove high-confidence raw/video screen alternates and verify README references.
5. Remove or route the renderer `[steps.recv]` warning.
6. Run targeted validation, then `npm run typecheck`; run broader `npm run check` if touched-file checks pass and time allows before PR.
7. Push branch to ASRagab fork and open upstream PR to `johannesjo/parallel-code:main` with validation evidence.

Rollback is straightforward: revert the PR. The changes are test utilities, asset deletions, and logging cleanup only; no data migration or user-facing behavior change is expected.

## Open Questions

- Should the minimum PR delete only high-confidence raw/video alternates, or also remove all unreferenced PNG variants to match the issue's stricter “README assets only” direction?
- If #193 merges first, should the coordinator harness also absorb its backend-selection and prompt-readiness additions in the same implementation pass?
- Does the maintainer prefer deleted screen alternates to remain recoverable only from git history, or should they be attached to a release / moved to Git LFS outside the PR?
