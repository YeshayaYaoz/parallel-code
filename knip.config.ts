import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: [
    'electron/main.ts',
    'electron/preload.cjs',
    'electron/mcp/server.ts',
    // Standalone CLI entry point, built independently via `npm run
    // build:ultrakod` (esbuild) into dist-electron/ultrakod/cli.js — the
    // package.json `bin.ultrakod` target. Nothing in the main src/electron
    // import graph reaches it, so knip flagged it as an unused file without
    // this listed as its own entry point.
    'electron/ultrakod/cli.ts',
  ],
  project: ['electron/**/*.ts', 'src/**/*.{ts,tsx}'],
  ignoreBinaries: [
    // Optional security tooling invoked from npm scripts; installed on demand.
    'semgrep',
    'gitleaks',
  ],
  // Test files are allowed to have unused exports (test helpers, fixtures).
  ignoreExportsUsedInFile: true,
};

export default config;
