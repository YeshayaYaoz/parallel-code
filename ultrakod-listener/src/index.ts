import { createServer } from 'http';
import { processQueueOnce, processCliQueueOnce } from './router.js';
import { unavailableProviderIds, justRecovered } from './cooldowns.js';
import { handleCliTasksRequest } from './cli-tasks.js';

// Last-resort safety net for a long-running background service: without
// these, any error that slips past every other try/catch in this codebase
// (a bug, an unexpected library throw, a promise rejection nothing upstream
// awaits) crashes the whole process by Node's default behavior — killing the
// poll loop and the health-check server together, then Railway restarts it,
// repeating whenever the same trigger recurs. Log and keep running instead;
// a single bad request or a single failed task should never take down the
// whole service.
process.on('unhandledRejection', (reason) => {
  console.error('[ultrakod] unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[ultrakod] uncaught exception:', err);
});

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 10_000;
const PORT = Number(process.env.PORT) || 3000;

let lastKnownUnavailable = new Set(unavailableProviderIds());

/** Logs the moment a provider's cooldown clears. There's no push-notification
 *  channel wired up (that needs picking a service — e.g. ntfy.sh is a
 *  one-line addition if wanted later); for now, recovery just means that
 *  provider re-enters routing immediately, visible in these logs. */
function logRecoveries(): void {
  for (const provider of justRecovered(lastKnownUnavailable)) {
    console.log(`[ultrakod] ${provider} is available again — eligible for the next matching task.`);
  }
  lastKnownUnavailable = new Set(unavailableProviderIds());
}

async function loop(): Promise<void> {
  for (;;) {
    try {
      logRecoveries();
      await processQueueOnce();
      await processCliQueueOnce();
    } catch (err) {
      console.error('[ultrakod] loop iteration failed:', err);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Minimal health-check server — Railway (like most PaaS) expects a service to
// bind a port and answer HTTP, even for a background-worker-shaped app like
// this one whose real work is the poll loop below, not request handling.
createServer((req, res) => {
  void handleCliTasksRequest(req, res)
    .then((handled) => {
      if (handled) return;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ultrakod-listener is running\n');
    })
    .catch((err) => {
      console.error('[ultrakod] request handler failed:', err);
      if (!res.headersSent) {
        try {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'internal error' }));
        } catch {
          /* socket already gone */
        }
      }
    });
}).listen(PORT, () => {
  console.log(`[ultrakod] health server listening on :${PORT}`);
});

void loop();
