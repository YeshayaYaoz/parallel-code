#!/usr/bin/env node
// Standalone entry point. Boots the same WebSocket+REST protocol
// (server-remote.ts, ported verbatim from electron/remote/server.ts) backed
// by a single Coordinator instance, as a plain Node process instead of
// inside the Electron main process — so the existing remote client
// (src/remote/*, today built into the Electron app's bundled mobile SPA)
// can attach to this process exactly as it already attaches to a desktop
// instance, without any client-side changes.
import path from 'path';
import { fileURLToPath } from 'url';
import { Coordinator } from './coordinator.js';
import { startRemoteServer } from './server-remote.js';
import { getAgentMeta } from './pty.js';
import { info as logInfo } from './log.js';

const thisDir = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 7777);
const HOST = process.env.HOST ?? '0.0.0.0';
const STATIC_DIR = process.env.STATIC_DIR ?? path.join(thisDir, '..', 'public');

const coordinator = new Coordinator();
coordinator.setNotifier((channel, data) => {
  logInfo('coordinator', channel, data as Record<string, unknown>);
});

const server = await startRemoteServer({
  port: PORT,
  host: HOST,
  staticDir: STATIC_DIR,
  getTaskName: (taskId) => coordinator.getTask(taskId)?.name ?? taskId,
  getAgentStatus: (agentId) => {
    const meta = getAgentMeta(agentId);
    return { status: meta ? ('running' as const) : ('exited' as const), exitCode: null, lastLine: '' };
  },
  getCoordinator: () => coordinator,
});

logInfo('server', `cloud-backend listening on ${server.url}`, {
  port: server.port,
  bindHost: server.bindHost,
});

async function shutdown(): Promise<void> {
  await server.stop();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
