import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { IPC } from './ipc/channels.js';

const require = createRequire(import.meta.url);
const IPC_MANIFEST = require('./ipc/channel-manifest.json') as Record<string, string>;

describe('preload ALLOWED_CHANNELS', () => {
  const preloadSrc = readFileSync(join(__dirname, 'preload.cjs'), 'utf8');

  it('uses the shared channel manifest', () => {
    expect(preloadSrc).toContain("require('./ipc/channel-manifest.json')");
  });

  it('keeps the manifest and IPC enum as an exact set', () => {
    const channels = Object.values(IPC);
    const IPC_CHANNELS = Object.values(IPC_MANIFEST);
    expect(new Set(IPC_CHANNELS)).toEqual(new Set(channels));
    expect(IPC_CHANNELS).toHaveLength(channels.length);
    expect(new Set(IPC_CHANNELS).size).toBe(IPC_CHANNELS.length);
  });
});
