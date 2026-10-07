"use client";

/**
 * Cancel with a refund, or refund a picked-up order: full (leave the amount
 * empty) or partial, with a required reason. The dialog says exactly what
 * will happen before anything does.
 */
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

import { cancelWithRefundAction, refundAction } from "@/lib/orders/admin-actions";
import { formatCents } from "@/lib/money";

import { buttonClass } from "./action-button";
import { ConfirmDialog } from "./confirm-dialog";
import { inputClass, textareaClass } from "./form-layout";

export function RefundDialog({ orderId, mode, refundableCents, orderNumber }: { orderId: string; mode: "cancel" | "refund"; refundableCents: number; orderNumber: string }) {
  const id = useId();
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const cents = /^\d{1,5}(\.\d{1,2})?$/.test(amount.trim()) ? Math.round(Number(amount) * 100) : null;
  const refunding = amount.trim() ? cents : refundableCents;

  const what =
    mode === "cancel"
      ? `Order ${orderNumber} is taken off the queue and cancelled, and ${refunding !== null ? formatCents(refunding) : "the amount below"} is refunded to the customer's card. The customer is emailed. This can't be undone.`
      : `${refunding !== null ? formatCents(refunding) : "The amount below"} of order ${orderNumber} is refunded to the customer's card${refunding === refundableCents ? ", and the order is marked Refunded" : ""}. This can't be undone.`;

  return (
    <ConfirmDialog
      trigger={
        <button type="button" className={`focus-ring inline-flex min-h-11 items-center rounded-full px-5 text-sm font-semibold ${buttonClass.danger}`}>
          {mode === "cancel" ? "Cancel with refund" : "Refund"}
        </button>
      }
      title={mode === "cancel" ? "Cancel and refund this order?" : "Refund this order?"}
      description={what}
      confirmLabel={mode === "cancel" ? "Cancel and refund" : "Refund"}
      tone="danger"
      confirmDisabled={reason.trim().length < 3 || (amount.trim() !== "" && (cents === null || cents <= 0 || cents > refundableCents))}
      onConfirm={async () => {
        setError(null);
        const result = await (mode === "cancel" ? cancelWithRefundAction : refundAction)(orderId, amount, reason);
        if (!result.ok) {
          setError(result.message);
          toast.error(result.message);
          return false;
        }
        toast.success(result.message ?? "Done.");
        setAmount("");
        setReason("");
        router.refresh();
        return true;
      }}
    >
      <div className="space-y-1.5">
        <label htmlFor={`${id}-amount`} className="block text-sm font-semibold">
          Amount to refund ($)
        </label>
        <input id={`${id}-amount`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={(refundableCents / 100).toFixed(2)} className={inputClass} aria-describedby={`${id}-amount-hint`} />
        <p id={`${id}-amount-hint`} className="text-xs text-muted-foreground">
          Empty = everything left ({formatCents(refundableCents)}). Enter less for a partial refund.
        </p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${id}-reason`} className="block text-sm font-semibold">
          Reason
        </label>
        <textarea id={`${id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className={textareaClass} aria-describedby={`${id}-reason-hint`} />
        <p id={`${id}-reason-hint`} className="text-xs text-muted-foreground">
          Required. {mode === "cancel" ? "The customer sees it." : "Kept with the refund."}
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </ConfirmDialog>
  );
}
