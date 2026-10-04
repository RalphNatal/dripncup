"use client";

/**
 * Points activity, newest first: earned, redeemed, reserved, returned,
 * reversed, adjusted and expired entries with the Honolulu date and a link
 * to the order. "Show more" pages through the rest.
 */
import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { loadMorePointsActivityAction } from "@/lib/rewards/actions";
import { ACTIVITY_LABELS, activityNote, type ActivityEntry } from "@/lib/rewards/activity";
import { formatPoints } from "@/lib/rewards/model";
import { formatCafeDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

export function ActivityList({ initial, initialCursor }: { initial: ActivityEntry[]; initialCursor: string | null }) {
  const [entries, setEntries] = useState(initial);
  const [cursor, setCursor] = useState(initialCursor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function more() {
    if (!cursor) return;
    setBusy(true);
    setError(null);
    const page = await loadMorePointsActivityAction(cursor).catch(() => ({ error: "Couldn't load more activity." }));
    setBusy(false);
    if ("error" in page) {
      setError(page.error);
      return;
    }
    setEntries((current) => [...current, ...page.entries.filter((e) => !current.some((c) => c.id === e.id))]);
    setCursor(page.nextCursor);
  }

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity yet. Points appear here when you pick up an order.</p>;
  }

  return (
    <div>
      <ul className="divide-y" data-testid="activity-list">
        {entries.map((entry) => {
          const note = activityNote(entry);
          return (
            <li key={entry.id} className="flex items-start justify-between gap-3 py-3" data-testid="activity-entry" data-kind={entry.kind}>
              <div className="min-w-0">
                <p className="font-semibold">{ACTIVITY_LABELS[entry.kind]}</p>
                {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
                <p className="text-xs text-muted-foreground">
                  <time dateTime={entry.createdAt}>{formatCafeDateTime(new Date(entry.createdAt))}</time>
                  {entry.orderId && entry.orderNumber ? (
                    <>
                      {" · "}
                      <Link href={`/orders/${entry.orderId}`} className="font-semibold text-brand-teal-deep underline underline-offset-2">
                        Order {entry.orderNumber}
                      </Link>
                    </>
                  ) : null}
                </p>
              </div>
              <p
                className={cn(
                  "tabular shrink-0 font-bold",
                  entry.points > 0 ? "text-brand-teal-deep" : "text-foreground",
                  entry.kind === "reserved" && !entry.held && "text-muted-foreground line-through",
                )}
              >
                {formatPoints(entry.points, { signed: true })}
              </p>
            </li>
          );
        })}
      </ul>
      {error ? (
        <p role="alert" className="mt-2 text-sm font-semibold text-destructive">
          {error}
        </p>
      ) : null}
      {cursor ? (
        <button
          type="button"
          onClick={() => void more()}
          disabled={busy}
          className="focus-ring mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border bg-card px-5 text-sm font-semibold hover:bg-muted disabled:opacity-60"
        >
          {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
          Show more
        </button>
      ) : null}
    </div>
  );
}
