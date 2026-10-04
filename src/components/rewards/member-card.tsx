"use client";

/**
 * The member QR and code, for future in-store scanning. The code is random
 * (not the customer's id, email or phone). Regenerating it retires the old
 * one at once -- for a code someone else has seen -- after a confirm step.
 */
import { LoaderCircle, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { QrCode } from "@/components/rewards/qr-code";
import { regenerateMemberCodeAction } from "@/lib/rewards/actions";
import { formatMemberCode } from "@/lib/rewards/model";

export function MemberCard({ code: initialCode, programName }: { code: string; programName: string }) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function regenerate() {
    setBusy(true);
    setMessage(null);
    const result = await regenerateMemberCodeAction();
    setBusy(false);
    setConfirming(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setCode(result.code);
    setMessage("New code ready. Your old one no longer works.");
    router.refresh();
  }

  return (
    <section aria-labelledby="member-card-heading" className="rounded-3xl border bg-card p-5">
      <h2 id="member-card-heading" className="text-lg font-bold">
        Your member code
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Soon you&apos;ll be able to show this at the counter to collect {programName} points in store.
      </p>
      <div className="mt-4 flex flex-col items-center gap-3">
        <div className="rounded-2xl border bg-white p-3">
          <QrCode value={code} label={`${programName} member code ${formatMemberCode(code)}`} className="size-44" />
        </div>
        <p className="font-mono text-xl font-bold tracking-widest tabular" data-testid="member-code">
          {formatMemberCode(code)}
        </p>
      </div>

      {message ? (
        <p role="status" className="mt-3 text-center text-sm font-medium">
          {message}
        </p>
      ) : null}

      <div className="mt-4 flex flex-col items-center gap-2">
        {confirming ? (
          <>
            <p className="text-center text-sm">Make a new code? The current one will stop working.</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void regenerate()}
                disabled={busy}
                className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-teal-deep px-5 text-sm font-bold text-white hover:bg-brand-teal-deep/90 disabled:opacity-60"
              >
                {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
                Yes, new code
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="focus-ring inline-flex min-h-11 items-center rounded-full border px-5 text-sm font-semibold hover:bg-muted"
              >
                Keep this one
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold text-brand-teal-deep hover:bg-brand-teal-soft"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Regenerate code
          </button>
        )}
      </div>
    </section>
  );
}
