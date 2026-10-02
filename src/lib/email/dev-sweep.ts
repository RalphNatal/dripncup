import "server-only";

/**
 * `npm run dev` only: sends due outbox emails every 15 seconds, so an email
 * owed by a change made outside the app (an order moved along in Supabase
 * Studio, a retry coming due) shows up in Mailpit without anyone calling the
 * cron route. Production relies on kickOutbox() and the scheduled
 * /api/cron/send-emails instead.
 */
import { processOutbox } from "./outbox";

const SWEEP_MS = 15_000;

/** Survives hot reloads, which re-run register() in the same process. */
const state = globalThis as typeof globalThis & { __drincupOutboxSweep?: ReturnType<typeof setInterval> };

export function startDevOutboxSweep() {
  if (state.__drincupOutboxSweep) return;
  let quietUntil = 0;
  state.__drincupOutboxSweep = setInterval(() => {
    processOutbox().then(
      (report) => {
        if (report.sent || report.failed) console.log(`[outbox] sent ${report.sent}, failed ${report.failed}`);
      },
      (error) => {
        // The database being down is already loud elsewhere; say so once a minute.
        if (Date.now() < quietUntil) return;
        quietUntil = Date.now() + 60_000;
        console.warn(`[outbox] sweep failed: ${error instanceof Error ? error.message : error}`);
      },
    );
  }, SWEEP_MS);
}
