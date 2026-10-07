"use client";

/**
 * What the customer can do with a request, by state:
 *   submitted  cancel (free)
 *   quoted     accept & pay, ask for changes, cancel (free)
 *   confirmed  ask us to cancel (only the cafe can cancel and refund)
 */
import { CreditCard, MessageSquarePlus, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { textareaClass } from "@/components/admin/form-layout";
import {
  cancelCateringRequestAction,
  requestCateringCancellationAction,
  requestCateringChangesAction,
} from "@/lib/catering/actions";
import type { CateringStatus } from "@/lib/catering/status";

const secondary =
  "focus-ring inline-flex min-h-12 items-center justify-center gap-2 rounded-full border px-5 text-base font-semibold hover:bg-muted";

function MessageBox({ label, value, onChange, required }: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
      </label>
      <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} maxLength={2000} required={required} className={textareaClass} />
    </div>
  );
}

export function CustomerCateringActions({
  requestId,
  status,
  quoteId,
  payable,
  cancellationRequested,
  refundPolicy,
}: {
  requestId: string;
  status: CateringStatus;
  quoteId: string | null;
  /** Null when there is nothing to pay; otherwise whether paying is possible now, and why not. */
  payable: { ok: true } | { ok: false; message: string } | null;
  cancellationRequested: boolean;
  refundPolicy: string;
}) {
  const router = useRouter();
  const [changes, setChanges] = useState("");
  const [reason, setReason] = useState("");

  async function run(action: () => Promise<{ ok: boolean; message?: string }>, success: string) {
    const result = await action();
    if (!result.ok) {
      toast.error(result.message ?? "Something went wrong. Please try again.");
      return false;
    }
    toast.success(success);
    router.refresh();
    return true;
  }

  const cancelFree = (
    <ConfirmDialog
      trigger={
        <button type="button" className={secondary}>
          <XCircle className="size-5" aria-hidden="true" />
          Cancel request
        </button>
      }
      title="Cancel this request?"
      description="It's free to cancel before you pay. You can always send a new request."
      confirmLabel="Cancel request"
      pendingLabel="Cancelling…"
      tone="danger"
      onConfirm={() => run(() => cancelCateringRequestAction({ requestId, reason }), "Your request was cancelled.")}
    >
      <MessageBox label="Why are you cancelling? (optional)" value={reason} onChange={setReason} />
    </ConfirmDialog>
  );

  if (status === "submitted") return <div className="flex flex-wrap gap-3">{cancelFree}</div>;

  if (status === "quoted") {
    return (
      <div className="space-y-3">
        {payable?.ok && quoteId ? (
          <Link
            href={`/catering/${requestId}/pay`}
            className="focus-ring inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-teal-deep px-6 text-base font-semibold text-white hover:bg-brand-teal-deep/90"
          >
            <CreditCard className="size-5" aria-hidden="true" />
            Accept &amp; pay
          </Link>
        ) : payable && !payable.ok ? (
          <p className="rounded-2xl border border-warning/40 bg-[color-mix(in_oklab,var(--warning)_8%,var(--card))] p-3 text-sm font-medium" role="status">
            {payable.message}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <ConfirmDialog
            trigger={
              <button type="button" className={secondary}>
                <MessageSquarePlus className="size-5" aria-hidden="true" />
                Request changes
              </button>
            }
            title="What would you like changed?"
            description="We'll revise your quote and email you when it's ready. This quote can't be paid in the meantime."
            confirmLabel="Send to the cafe"
            pendingLabel="Sending…"
            confirmDisabled={changes.trim().length < 3}
            onConfirm={() => run(() => requestCateringChangesAction({ requestId, message: changes }), "Sent. We'll revise your quote.")}
          >
            <MessageBox label="Your changes" value={changes} onChange={setChanges} required />
          </ConfirmDialog>
          {cancelFree}
        </div>
      </div>
    );
  }

  if (status === "confirmed") {
    return cancellationRequested ? (
      <p className="rounded-2xl bg-muted p-3 text-sm" role="status">
        You&apos;ve asked us to cancel. We&apos;ll be in touch about a refund.
      </p>
    ) : (
      <div className="space-y-2">
        <ConfirmDialog
          trigger={
            <button type="button" className={secondary}>
              <XCircle className="size-5" aria-hidden="true" />
              Ask to cancel
            </button>
          }
          title="Ask us to cancel?"
          description={refundPolicy}
          confirmLabel="Send request"
          pendingLabel="Sending…"
          tone="danger"
          confirmDisabled={reason.trim().length < 3}
          onConfirm={() => run(() => requestCateringCancellationAction({ requestId, reason }), "Sent. We'll be in touch about your refund.")}
        >
          <MessageBox label="Why do you need to cancel?" value={reason} onChange={setReason} required />
        </ConfirmDialog>
        <p className="text-xs text-muted-foreground">Your event is paid for, so the cafe cancels it and arranges any refund.</p>
      </div>
    );
  }

  return null;
}
