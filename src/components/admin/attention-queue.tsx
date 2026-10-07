"use client";

/**
 * "Needs attention": one card per item, newest first, each with what can be
 * done about it right here (retry, dismiss with a note, place or refund) and
 * a link to its detail page. An item leaves the list once it is resolved.
 */
import { ChevronRight, CircleCheck } from "lucide-react";
import Link from "next/link";

import {
  checkStuckOrderAction,
  clearCateringFlagAction,
  dismissEmailAction,
  markRefundHandledAction,
  resolveFlaggedOrderAction,
  retryEmailAction,
  retryRefundAction,
} from "@/lib/admin/attention-actions";
import type { AttentionItem } from "@/lib/admin/attention";
import { formatCents } from "@/lib/money";
import { formatCafeDateTime } from "@/lib/time";

import { ActionButton } from "./action-button";
import { StatusPill } from "./status-pill";

const LABELS: Record<AttentionItem["kind"], { label: string; tone: "bad" | "warn" | "info" }> = {
  flagged_order: { label: "Payment mismatch", tone: "bad" },
  flagged_catering: { label: "Catering payment mismatch", tone: "bad" },
  failed_refund: { label: "Failed refund", tone: "bad" },
  failed_email: { label: "Failed email", tone: "warn" },
  catering: { label: "Catering", tone: "info" },
  stuck_unpaid: { label: "Stuck unpaid", tone: "warn" },
};

function Actions({ item }: { item: AttentionItem }) {
  switch (item.kind) {
    case "flagged_order":
      return (
        <>
          <ActionButton
            size="sm"
            variant="primary"
            action={(note) => resolveFlaggedOrderAction(item.id, "place", note)}
            note={{
              title: "Accept the payment and place the order?",
              description: "The order goes to the counter's queue as it is, with the amount that was actually paid, and the customer gets their receipt.",
              label: "Why is this payment OK?",
              confirmLabel: "Place the order",
            }}
          >
            Place order
          </ActionButton>
          <ActionButton
            size="sm"
            variant="danger"
            action={(note) => resolveFlaggedOrderAction(item.id, "cancel", note)}
            note={{
              title: "Cancel and refund this order?",
              description: "The order is cancelled and everything that was paid is refunded. The customer is emailed.",
              label: "Reason",
              confirmLabel: "Cancel and refund",
              tone: "danger",
            }}
          >
            Refund and cancel
          </ActionButton>
        </>
      );
    case "flagged_catering":
      return (
        <ActionButton
          size="sm"
          action={(note) => clearCateringFlagAction(item.id, note)}
          note={{ title: "Mark this payment reviewed?", label: "What did you decide?", confirmLabel: "Mark reviewed" }}
        >
          Mark reviewed
        </ActionButton>
      );
    case "failed_refund":
      return (
        <>
          <ActionButton size="sm" variant="primary" action={() => retryRefundAction(item.id)}>
            Retry refund
          </ActionButton>
          <ActionButton
            size="sm"
            action={(note) => markRefundHandledAction(item.id, note)}
            note={{
              title: "Mark this refund handled?",
              description: "Use this when it was settled another way, for example refunded from the Stripe dashboard or in cash.",
              label: "How was it handled?",
              confirmLabel: "Mark handled",
            }}
          >
            Mark handled
          </ActionButton>
        </>
      );
    case "failed_email":
      return (
        <>
          <ActionButton size="sm" variant="primary" action={() => retryEmailAction(item.id)} testId="attention-retry-email">
            Retry
          </ActionButton>
          <ActionButton
            size="sm"
            action={(note) => dismissEmailAction(item.id, note)}
            note={{ title: "Dismiss this email?", description: "It won't be sent.", label: "Why not send it?", confirmLabel: "Dismiss" }}
          >
            Dismiss
          </ActionButton>
        </>
      );
    case "stuck_unpaid":
      return (
        <ActionButton size="sm" variant="primary" action={() => checkStuckOrderAction(item.id)}>
          Check with Stripe
        </ActionButton>
      );
    default:
      return null;
  }
}

export function AttentionQueue({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-3xl border border-dashed p-6 text-sm text-muted-foreground" data-testid="attention-empty">
        <CircleCheck className="size-5 text-brand-teal-deep" aria-hidden="true" />
        Nothing needs you right now.
      </p>
    );
  }
  return (
    <ul className="space-y-3" aria-label="Needs attention" data-testid="attention-queue">
      {items.map((item) => {
        const meta = LABELS[item.kind];
        return (
          <li key={`${item.kind}-${item.id}`} className="rounded-3xl border bg-card p-4" data-testid="attention-item" data-kind={item.kind}>
            <div className="flex flex-wrap items-start gap-2">
              <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
              {item.occurredAt ? <span className="text-xs text-muted-foreground">{formatCafeDateTime(new Date(item.occurredAt))}</span> : null}
            </div>
            <p className="mt-2 font-semibold">
              {item.title}
              {item.amountCents !== null ? <span className="tabular font-normal text-muted-foreground"> · {formatCents(item.amountCents)}</span> : null}
            </p>
            {item.detail ? <p className="mt-1 text-sm break-words text-muted-foreground">{item.detail}</p> : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Actions item={item} />
              <Link
                href={item.href}
                className="focus-ring inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm font-semibold text-brand-teal-deep hover:underline"
              >
                Open
                <ChevronRight className="size-4" aria-hidden="true" />
              </Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
