## ADDED Requirements

### Requirement: Coordinator tests use a shared harness

The change SHALL provide a reusable, Vitest-aware coordinator test harness for duplicated coordinator unit-test setup. The harness MUST centralize common fs, fs/promises, atomic write, pty, git, task, channel, renderer, timer, backend-task, PTY output, and write-inspection utilities without changing production Coordinator behavior.

#### Scenario: Coordinator sequence test uses harness

- **WHEN** `electron/mcp/coordinator-sequence.test.ts` creates a Coordinator for the sequence smoke tests
- **THEN** it SHALL use the shared coordinator harness instead of defining its own duplicate fs, pty, git, task, channel, renderer, output callback, and base64 helpers

#### Scenario: Coordinator unit test uses harness helpers

- **WHEN** `electron/mcp/coordinator.test.ts` needs default coordinator registration, backend task fixtures, PTY prompt delivery, renderer event queries, or subtask config write inspection
- **THEN** it SHALL use named harness helpers such as `registerDefaultCoordinator`, `mockNextTask`, `deliverReadyPrompt`, `rendererEvents`, and `getSubtaskConfigWrites` rather than repeating local parsing or mock-call indexing logic

#### Scenario: Coordinator harness stays test-only

- **WHEN** production code imports are analyzed
- **THEN** no production module SHALL import the coordinator test harness

### Requirement: Store tests use a shared store test helper

The change SHALL provide `src/store/test-helpers.ts` for duplicated store-test plumbing. The helper MUST support mutable store proxies, path-based `setStore` calls, producer-style `setStore` calls used by Solid store tests, reset helpers, and per-test overrides while keeping feature-specific assertions explicit.

#### Scenario: Mocked-core store tests use helper

- **WHEN** store tests mock `./core` and need a store proxy or `setStore` implementation
- **THEN** high-duplication tests SHALL use `src/store/test-helpers.ts` instead of hand-rolled local proxy and path-mutation logic

#### Scenario: Store helper preserves overrides

- **WHEN** a test needs custom store fields, custom task fixtures, or custom reset state
- **THEN** the helper SHALL allow explicit per-test overrides without hiding feature-specific setup in global defaults

#### Scenario: Real-store tests are not forced into the mock helper

- **WHEN** a store test intentionally imports the real `./core` store
- **THEN** the change SHALL avoid migrating it to the mocked-core helper unless a small reset helper reduces duplication without changing test intent

### Requirement: README media remains valid after screen cleanup

The change SHALL reduce tracked `screens/` bloat while preserving every media file referenced by tracked markdown. The minimum cleanup MUST keep all README-rendered assets and remove only unreferenced raw/video alternates unless maintainer confirmation expands the deletion set.

#### Scenario: README-referenced media exists

- **WHEN** tracked markdown references a `screens/` path after cleanup
- **THEN** every referenced file SHALL exist in the repository

#### Scenario: High-confidence raw video alternates are pruned

- **WHEN** the cleanup is implemented
- **THEN** unreferenced raw/video alternates such as `screens/demo.mov`, `screens/demo.gif`, `screens/longer-video.mp4`, `screens/longer-video.mkv`, and `screens/best-video.mkv` SHALL be removed from git unless the maintainer requests retention

#### Scenario: Ambiguous unreferenced screenshots are reviewed explicitly

- **WHEN** unreferenced PNG screenshots appear to be feature captures or recent visual evidence
- **THEN** the implementation SHALL either keep them for a follow-up decision or document maintainer approval before removing them

### Requirement: Regular steps events are not warning logs

The change SHALL ensure routine steps send, watch, and receive events do not use `console.warn`. Failure paths MAY continue to use warning/error logging through the existing logger.

#### Scenario: Main-process watcher warning spam stays resolved

- **WHEN** `electron/ipc/steps.ts` is checked after the change
- **THEN** routine send/watch events SHALL not be logged with `console.warn`

#### Scenario: Renderer receive event is not a warning

- **WHEN** `src/App.tsx` receives `IPC.StepsContent`
- **THEN** the routine receive event SHALL not emit `console.warn('[steps.recv]', ...)`

### Requirement: Validation and upstream PR steps are documented

The change SHALL define validation steps and upstream PR creation steps for issue #161. The PR plan MUST identify relevant targeted tests, README media checks, typechecking, OpenSpec validation, and the GitHub PR target.

#### Scenario: Validation covers affected test harnesses

- **WHEN** the implementation is ready for review
- **THEN** the validation plan SHALL include targeted coordinator tests, targeted store tests, README media reference checks, steps warning checks, and `npm run typecheck`

#### Scenario: Upstream PR is created from the fork

- **WHEN** validation passes
- **THEN** the plan SHALL push a branch to `ASRagab/parallel-code` and create a PR to `johannesjo/parallel-code:main` that links issue #161, notes #186 overlap for finding 42, and includes validation evidence

#### Scenario: Open upstream PRs are considered before publishing

- **WHEN** the PR branch is prepared
- **THEN** the plan SHALL fetch/rebase against latest upstream main and account for live conflict risks from open PR #193 and open PR #179 before opening the upstream PR
