## Why

Issue #161 tracks audit cleanup that still makes the repo harder to maintain: coordinator tests and store tests duplicate fragile harness code, and `screens/` still carries unreferenced binary captures. Recent upstream work resolved the main-process steps watcher warning in #186, so this change should focus on the remaining high-signal cleanup and only verify that no regular steps warning remains.

## What Changes

- Add a Vitest-aware coordinator test harness and migrate `electron/mcp/coordinator.test.ts` plus `electron/mcp/coordinator-sequence.test.ts` away from duplicated fs, pty, git, task, channel, renderer, timer, and write-inspection setup.
- Add a colocated store test helper in `src/store/test-helpers.ts` and migrate duplicated store proxy, `setStore`, `produce`, and reset setup across high-duplication `src/store/*.test.ts` files.
- Reduce repo media weight by keeping README-rendered `screens/` assets in git and removing only unreferenced raw/video alternates in the minimum PR; defer ambiguous screenshot variants or external archival to maintainer confirmation.
- Treat `electron/ipc/steps.ts` warning spam as already addressed by merged PR #186; optionally remove or route the remaining regular-event renderer warning in `src/App.tsx` if the implementation confirms it is not needed.
- Include validation evidence and a PR-ready upstream flow from the ASRagab fork branch to `johannesjo/parallel-code:main`.

## Capabilities

### New Capabilities

- `quality-audit-hygiene`: Maintainer-facing quality cleanup for issue #161, covering reusable test harnesses, repo media hygiene, logging-noise verification, validation gates, and upstream PR preparation.

### Modified Capabilities

None. No existing OpenSpec capabilities are present in this repo.

## Impact

- Affected tests: `electron/mcp/coordinator.test.ts`, `electron/mcp/coordinator-sequence.test.ts`, and the high-duplication `src/store/*.test.ts` files that mock `./core` or reset store state locally.
- New test utilities: a coordinator harness under `electron/mcp/` and a store helper at `src/store/test-helpers.ts`.
- Affected assets: `screens/` raw/video alternates that are not referenced by tracked markdown; README-rendered files stay in place.
- Affected logging: no production behavior change expected; only a residual regular-event steps receive warning may be removed or routed to debug logging.
- External workflow: branch from synced `origin/main`/`upstream/main`, rebase before PR because open PR #193 touches `electron/mcp/coordinator.test.ts` and open PR #179 is store-heavy, then open an upstream PR that links issue #161 and notes #186 overlap.
