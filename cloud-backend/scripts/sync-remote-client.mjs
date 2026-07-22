#!/usr/bin/env node
// Builds the mobile/browser web client (src/remote/*, a real SolidJS SPA —
// the same one the desktop app's "Connect Phone" feature bundles) and copies
// the compiled output into this package's own public/ directory, so this
// service can serve it directly instead of just answering bare API/WS
// requests. public/ is committed (not gitignored), same reasoning as
// registry.ts's sync-registry.mjs: fly.toml scopes the Docker build context
// to cloud-backend/ alone, so ../../src/remote is not reachable from inside
// that build — the compiled output has to already be sitting in this
// directory before `fly deploy` captures the build context. Re-run this
// (from cloud-backend/) and commit the result whenever src/remote changes.

import { execFileSync } from 'child_process';
import { cpSync, rmSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const distRemote = path.join(repoRoot, 'dist-remote');
const publicDir = path.resolve(__dirname, '..', 'public');

console.log('[sync-remote-client] building src/remote via npm run build:remote...');
execFileSync('npm', ['run', 'build:remote'], { cwd: repoRoot, stdio: 'inherit' });

if (!existsSync(distRemote)) {
  throw new Error(`Expected build output at ${distRemote}, but it doesn't exist.`);
}

rmSync(publicDir, { recursive: true, force: true });
cpSync(distRemote, publicDir, { recursive: true });

console.log(
  `[sync-remote-client] ${path.relative(process.cwd(), distRemote)} -> ${path.relative(process.cwd(), publicDir)}`,
);
