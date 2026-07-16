import { createServer } from 'http';
import { processQueueOnce } from './router.js';
import { unavailableProviderIds, justRecovered } from './cooldowns.js';

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
createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ultrakod-listener is running\n');
}).listen(PORT, () => {
  console.log(`[ultrakod] health server listening on :${PORT}`);
});

void loop();
