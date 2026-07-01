## 1. Branch and Baseline

- [x] 1.1 Fetch `origin main` and `upstream main`, then rebase the implementation branch on latest upstream main.
- [x] 1.2 Check open PR #193 before coordinator edits and open PR #179 before store edits; adapt the helper shape if either has merged.
- [x] 1.3 Confirm issue #161 scope on current main: finding 36, finding 37, finding 40, and residual renderer steps receive warning.

## 2. Coordinator Test Harness

- [x] 2.1 Add a test-only coordinator harness under `electron/mcp/` that registers shared Vitest mocks before dynamically importing `Coordinator`.
- [x] 2.2 Move common coordinator mocks into the harness: child process, fs, fs/promises, atomic writes, prompt detection, pty, git, backend tasks, IPC channel constants, renderer window, and logger mocks.
- [x] 2.3 Expose focused helpers: `setupCoordinatorHarness`, `resetCoordinatorMocks`, `mockNextTask`, `registerDefaultCoordinator`, `createCoordinatorTask`, PTY output helpers, event-handler getters, `getAgentTextWrites`, `getSubtaskConfigWrites`, `getSettingsLocalWrites`, and `rendererEvents`.
- [x] 2.4 Migrate `electron/mcp/coordinator-sequence.test.ts` to the harness first and remove its duplicate mock preamble and local PTY helpers.
- [x] 2.5 Migrate shared setup and repeated helper logic in `electron/mcp/coordinator.test.ts` without broad assertion rewrites.
- [x] 2.6 Preserve existing coordinator coverage and keep opt-in real-agent / real-PTY integration tests out of this helper pass.

## 3. Store Test Helper

- [x] 3.1 Add `src/store/test-helpers.ts` with generic mutable store proxy, path-based and producer-style `setStore` emulation, reset support, `moduleMock(extra?)`, and `mockSolidStoreProduce`.
- [x] 3.2 Migrate simple mocked-core tests first: `ui.test.ts`, `appearance-mode.test.ts`, `focus.test.ts`, and `navigation.test.ts`.
- [x] 3.3 Migrate remaining high-duplication mocked-core tests where the helper keeps intent explicit: `agents.test.ts`, `notifications.test.ts`, `taskStatus.test.ts`, `tasks.test.ts`, and `sidebar-order.test.ts`.
- [x] 3.4 Evaluate a tiny real-store reset helper for `persistence.test.ts`, `pr-checks.test.ts`, `autosave.test.ts`, and `projects.test.ts`; add it only if call sites become shorter and clearer.
- [x] 3.5 Keep IPC, window, coordinator, timer, and feature-specific fixtures local to each test or in their own helper; do not put them in `src/store/test-helpers.ts`.

## 4. Media and Steps Logging Hygiene

- [x] 4.1 Verify tracked markdown `screens/` references and keep every referenced media file in git.
- [x] 4.2 Remove high-confidence unreferenced raw/video alternates: `screens/demo.mov`, `screens/demo.gif`, `screens/longer-video.mp4`, `screens/longer-video.mkv`, and `screens/best-video.mkv` unless maintainer feedback changes retention.
- [x] 4.3 Leave ambiguous unreferenced PNG variants in place unless maintainer confirmation is available; document them as follow-up candidates in the PR body.
- [x] 4.4 Remove or route `src/App.tsx` regular `[steps.recv]` logging away from `console.warn`.
- [x] 4.5 Confirm `electron/ipc/steps.ts` still has no routine `console.warn` calls and cite PR #186 as the main-process fix.

## 5. Targeted Validation

- [x] 5.1 Run `openspec validate address-quality-audit-cleanup --strict` or the repo-supported strict validation equivalent.
- [x] 5.2 Run `npm test -- electron/mcp/coordinator-sequence.test.ts electron/mcp/coordinator.test.ts`.
- [x] 5.3 If prompt detection helpers changed or PR #193 merged, run `npm test -- electron/mcp/prompt-detect.test.ts electron/mcp/server.test.ts electron/remote/coordinator-scoping.test.ts`.
- [x] 5.4 Run `npm test -- src/store/ui.test.ts src/store/appearance-mode.test.ts src/store/focus.test.ts src/store/navigation.test.ts src/store/agents.test.ts src/store/notifications.test.ts src/store/taskStatus.test.ts src/store/tasks.test.ts src/store/sidebar-order.test.ts`.
- [x] 5.5 If real-store resets changed, run `npm test -- src/store/persistence.test.ts src/store/pr-checks.test.ts src/store/autosave.test.ts src/store/projects.test.ts`.
- [x] 5.6 Run `npm run typecheck`.
- [x] 5.7 Run a README media path check that extracts tracked markdown `screens/` references and fails if any referenced file is missing.
- [x] 5.8 Run a logging check that fails on routine steps `console.warn` patterns in `electron/ipc/steps.ts` and `src/App.tsx`.
- [x] 5.9 Run `du -sh screens` and capture the media size delta for the PR body.
- [x] 5.10 If targeted checks pass, run `npm run check` before requesting upstream review.

## 6. Upstream PR Preparation

- [x] 6.1 Create an implementation branch from synced main, e.g. `fix/issue-161-test-harness-media-hygiene`.
- [x] 6.2 Commit by finding area: coordinator harness, store helper, media cleanup, residual steps logging cleanup.
- [x] 6.3 Rebase once more on latest `upstream/main` after validation and before pushing.
- [ ] 6.4 Push the branch to `ASRagab/parallel-code`.
- [ ] 6.5 Create a PR to `johannesjo/parallel-code:main` that links issue #161, states which findings are addressed, notes that PR #186 already handled the main-process steps watcher warning, lists deferred media variants if any, and includes validation output.
