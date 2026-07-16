#!/usr/bin/env node
// Copies the canonical model registry (electron/ultrakod/registry.ts) into
// this package's own src/, so there's exactly one source of truth instead of
// two hand-maintained copies. Runs automatically before build/test/dev/
// typecheck (see package.json) — you never need to run this by hand, and the
// generated file is gitignored so a stale copy can never accidentally get
// committed.
//
// This package still needs its own physical copy of the file (rather than
// importing electron/ultrakod/registry.ts directly) because it deploys
// independently — e.g. to Railway with its Root Directory set to
// ultrakod-listener/ — and a cross-directory import would make that deploy
// depend on exactly how much of the repo tree the platform's build actually
// exposes at that Root Directory, which isn't something to assume.

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
