"use client";

/**
 * Admin actions on one request: cancel (free before payment; after it, with
 * a full, partial or no refund through the refund machinery) and mark
 * fulfilled (from the event day). The refund policy itself is
 * NEEDS_CONFIRMATION, so the admin chooses each time.
 */
import { CircleCheck, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { inputClass, textareaClass } from "@/components/admin/form-layout";
import { adminCancelCateringAction, markCateringFulfilledAction } from "@/lib/catering/admin-actions";
import type { CateringStatus } from "@/lib/catering/status";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

export function AdminCateringActions({
  requestId,
  status,
  refundableCents,
  canFulfil,
  cancellationRequestReason,
}: {
  requestId: string;
  status: CateringStatus;
  /** What the request's payment could still give back. */
  refundableCents: number;
  canFulfil: boolean;
  cancellationRequestReason: string | null;
}) {
  const id = useId();
  const router = useRouter();
  const [reason, setReason] = useState(cancellationRequestReason ? `Customer asked: ${cancellationRequestReason}`.slice(0, 500) : "");
  const [refundChoice, setRefundChoice] = useState<"full" | "partial" | "none">("full");
  const [partial, setPartial] = useState("");
  const paid = status === "confirmed" && refundableCents > 0;
  const partialCents = Math.round(Number(partial.replace(/[$,\s]/g, "")) * 100);
  const partialValid = Number.isFinite(partialCents) && partialCents >= 1 && partialCents <= refundableCents;

  if (status === "fulfilled" || status === "cancelled") return null;

  async function cancel() {
    const result = await adminCancelCateringAction({
      requestId,
      reason,
      refund: !paid ? undefined : refundChoice === "partial" ? partialCents : refundChoice,
    });
    if (!result.ok) {
      toast.error(result.message);
      return false;
    }
    toast.success(result.message);
    router.refresh();
    return true;
  }

  async function fulfil() {
    const result = await markCateringFulfilledAction(requestId);
    if (!result.ok) toast.error(result.message);
    else {
      toast.success(result.message);
      router.refresh();
    }
    return result.ok;
  }

  return (
    <div className="flex flex-wrap gap-3">
      {status === "confirmed" && canFulfil ? (
        <ConfirmDialog
          trigger={
            <button type="button" className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-teal-deep px-5 text-sm font-semibold text-white hover:bg-brand-teal-deep/90">
              <CircleCheck className="size-4" aria-hidden="true" />
              Mark fulfilled
            </button>
          }
          title="Mark this event fulfilled?"
          description="Do this once the drinks have been picked up or delivered."
          confirmLabel="Mark fulfilled"
          onConfirm={fulfil}
        />
      ) : null}
      <ConfirmDialog
        trigger={
          <button type="button" className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full border border-destructive/40 px-5 text-sm font-semibold text-destructive hover:bg-destructive/10">
            <XCircle className="size-4" aria-hidden="true" />
            {paid ? "Cancel and refund" : "Cancel request"}
          </button>
        }
        title={paid ? "Cancel this paid request?" : "Cancel this request?"}
        description={
          paid
            ? `The customer paid; up to ${formatCents(refundableCents)} can be refunded to their card. The customer is emailed.`
            : "No money has been taken, so nothing needs refunding. The customer is emailed."
        }
        confirmLabel={paid ? (refundChoice === "none" ? "Cancel without refund" : "Cancel and refund") : "Cancel request"}
        pendingLabel="Cancelling…"
        tone="danger"
        confirmDisabled={reason.trim().length < 3 || (paid && refundChoice === "partial" && !partialValid)}
        onConfirm={cancel}
      >
        <div className="space-y-1.5">
          <label htmlFor={`${id}-reason`} className="block text-sm font-semibold">
            Reason (the customer sees it)
          </label>
          <textarea id={`${id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className={textareaClass} />
        </div>
        {paid ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Refund</legend>
            {(
              [
                ["full", `Full refund (${formatCents(refundableCents)})`],
                ["partial", "Partial refund"],
                ["none", "No refund"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className={cn("flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm", refundChoice === value && "border-brand-teal-deep bg-brand-teal-soft")}>
                <input type="radio" name={`${id}-refund`} checked={refundChoice === value} onChange={() => setRefundChoice(value)} className="accent-[var(--brand-teal-deep)]" />
                {label}
              </label>
            ))}
            {refundChoice === "partial" ? (
              <div className="space-y-1">
                <label htmlFor={`${id}-partial`} className="block text-sm font-semibold">
                  Amount to refund ($)
                </label>
                <input id={`${id}-partial`} inputMode="decimal" value={partial} onChange={(e) => setPartial(e.target.value)} className={inputClass} aria-invalid={partial && !partialValid ? true : undefined} />
                {partial && !partialValid ? <p className="text-sm text-destructive">Between $0.01 and {formatCents(refundableCents)}.</p> : null}
              </div>
            ) : null}
          </fieldset>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
