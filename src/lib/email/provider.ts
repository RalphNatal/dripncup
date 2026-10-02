import "server-only";

/**
 * The email-provider seam. The outbox sender talks only to `EmailProvider`;
 * which implementation runs is decided by the environment:
 *
 *   RESEND_API_KEY set   → Resend (production)
 *   otherwise            → the local Supabase stack's Mailpit, read at
 *                          http://127.0.0.1:54324 -- no account needed
 *
 * Swapping in another provider means one more implementation here.
 */
import { serverEnv } from "@/lib/env";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  /** Every email has a plain-text version. */
  text: string;
  /**
   * Stable per email (the outbox row id). Resend uses it to drop a repeat
   * of a send that already went through, e.g. after a crash before the row
   * was marked sent.
   */
  idempotencyKey: string;
}

export interface EmailProvider {
  readonly name: "resend" | "mailpit";
  /** Resolves to the provider's message id; throws on failure. */
  send(message: EmailMessage): Promise<{ id: string }>;
}

/** Fails with a short, loggable reason (never the API key). */
async function failure(provider: string, response: Response): Promise<Error> {
  const body = (await response.text().catch(() => "")).slice(0, 300);
  return new Error(`${provider} answered ${response.status}${body ? `: ${body}` : ""}`);
}

const DEFAULT_FROM = "Drincup Cafe <orders@drincup.test>";

function fromAddress(): string {
  return serverEnv().EMAIL_FROM || DEFAULT_FROM;
}

/** https://resend.com/docs/api-reference/emails/send-email */
function resend(apiKey: string): EmailProvider {
  return {
    name: "resend",
    async send(message) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          "idempotency-key": message.idempotencyKey,
        },
        body: JSON.stringify({
          from: fromAddress(),
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw await failure("Resend", response);
      const { id } = (await response.json()) as { id: string };
      return { id };
    },
  };
}

/** Mailpit's send API: https://mailpit.axllent.org/docs/api-v1/view.html#post-/api/v1/send */
function mailpit(baseUrl: string): EmailProvider {
  return {
    name: "mailpit",
    async send(message) {
      const from = fromAddress();
      const match = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
      const response = await fetch(new URL("/api/v1/send", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          From: match ? { Name: match[1].replace(/^"|"$/g, ""), Email: match[2] } : { Email: from },
          To: [{ Email: message.to }],
          Subject: message.subject,
          HTML: message.html,
          Text: message.text,
          Headers: { "X-Idempotency-Key": message.idempotencyKey },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw await failure("Mailpit", response);
      const { ID } = (await response.json()) as { ID: string };
      return { id: ID };
    },
  };
}

export function emailProvider(): EmailProvider {
  const env = serverEnv();
  return env.RESEND_API_KEY ? resend(env.RESEND_API_KEY) : mailpit(env.MAILPIT_URL);
}
