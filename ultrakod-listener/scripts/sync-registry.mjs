#!/usr/bin/env node
// Copies the canonical model registry (electron/ultrakod/registry.ts) into
// this package's own src/registry.ts, so there's exactly one hand-maintained
// source of truth instead of two. Runs automatically before test/dev/
// typecheck (see package.json).
//
// src/registry.ts IS committed (not gitignored) — deliberately. Railway's
// Root Directory setting for this service scopes its build to just
// ultrakod-listener/, so ../../electron/ultrakod/registry.ts genuinely does
// not exist in that build's filesystem (confirmed by a real failed deploy,
// not assumption) — `build`/`start` cannot depend on this script running.
// Instead: run `npm run sync-registry` locally after editing the canonical
// file and commit the result. CI (.github/workflows/ci.yml, which checks out
// the full repo) re-runs this script and fails the build if the committed
// copy doesn't match the source, so drift can't silently ship.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(__dirname, '..', '..', 'electron', 'ultrakod', 'registry.ts');
const destDir = path.resolve(__dirname, '..', 'src');
const dest = path.join(destDir, 'registry.ts');

const banner = `// GENERATED FILE — do not edit directly.
// Synced from electron/ultrakod/registry.ts by scripts/sync-registry.mjs,
// which runs automatically before build/test/dev/typecheck. Edit the source
// file and re-run any of those to pick up the change here.

`;

mkdirSync(destDir, { recursive: true });
const content = readFileSync(source, 'utf8');
writeFileSync(dest, banner + content);

console.log(
  `[sync-registry] ${path.relative(process.cwd(), source)} -> ${path.relative(process.cwd(), dest)}`,
);
