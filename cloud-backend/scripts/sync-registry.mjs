#!/usr/bin/env node
// Copies the canonical model registry (electron/ultrakod/registry.ts) into
// this package's own src/registry.ts, so there's exactly one hand-maintained
// source of truth instead of two. Runs automatically before test/dev/
// typecheck (see package.json). Same convention as
// ultrakod-listener/scripts/sync-registry.mjs, for the same reason: if this
// service is ever deployed with its build scoped to just cloud-backend/
// (e.g. a hosting provider's Root Directory setting), the relative path to
// electron/ won't exist in that build's filesystem — src/registry.ts is
// committed (not gitignored) so build/start don't depend on this script
// running at deploy time.

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
