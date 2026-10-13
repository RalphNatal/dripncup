import "server-only";

/**
 * `npm run dev` only: sends due outbox emails and push notifications every
 * 15 seconds, so an email owed by a change made outside the app (an order moved along in Supabase
 * Studio, a retry coming due) shows up in Mailpit without anyone calling the
 * cron route. Production relies on kickOutbox() and the scheduled
 * /api/cron/send-emails instead.
 */
import { processPushOutbox } from "@/lib/push/outbox";

import { processOutbox } from "./outbox";

const SWEEP_MS = 15_000;

/** Survives hot reloads, which re-run register() in the same process. */
const state = globalThis as typeof globalThis & { __drincupOutboxSweep?: ReturnType<typeof setInterval> };

export function startDevOutboxSweep() {
  if (state.__drincupOutboxSweep) return;
  let quietUntil = 0;
  state.__drincupOutboxSweep = setInterval(() => {
    Promise.all([processOutbox(), processPushOutbox()]).then(
      ([emails, pushes]) => {
        if (emails.sent || emails.failed) console.log(`[outbox] emails sent ${emails.sent}, failed ${emails.failed}`);
        if (pushes.sent || pushes.failed) console.log(`[outbox] pushes sent ${pushes.sent}, failed ${pushes.failed}`);
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
