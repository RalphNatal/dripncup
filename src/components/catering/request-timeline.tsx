import { MessageSquareText } from "lucide-react";

import type { CateringHistoryEntry, CateringMessageView } from "@/lib/catering/queries";
import { CATERING_STATUS_LABELS } from "@/lib/catering/status";
import { formatCafeDateTime } from "@/lib/time";

const MESSAGE_TITLES: Record<CateringMessageView["kind"], string> = {
  change_request: "Asked for changes",
  cancellation_request: "Asked to cancel",
  quote_note: "Note with the quote",
  note: "Note",
};

type Entry =
  | { at: string; kind: "status"; entry: CateringHistoryEntry }
  | { at: string; kind: "message"; message: CateringMessageView };

/** Status changes and messages, oldest first, with who did what. */
export function RequestTimeline({ history, messages }: { history: CateringHistoryEntry[]; messages: CateringMessageView[] }) {
  const entries: Entry[] = [
    ...history.map((entry): Entry => ({ at: entry.at, kind: "status", entry })),
    ...messages.map((message): Entry => ({ at: message.at, kind: "message", message })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <ol className="space-y-3" data-testid="catering-timeline">
      {entries.map((item, index) =>
        item.kind === "status" ? (
          <li key={`s${index}`} className="flex gap-3 text-sm">
            <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-brand-teal-deep" aria-hidden="true" />
            <div>
              <p>
                <span className="font-semibold">
                  {item.entry.fromStatus === null
                    ? "Request sent"
                    : item.entry.fromStatus === item.entry.toStatus
                      ? "Quote revised"
                      : CATERING_STATUS_LABELS[item.entry.toStatus]}
                </span>{" "}
                <span className="text-muted-foreground">by {item.entry.actor}</span>
              </p>
              {item.entry.reason ? <p className="text-muted-foreground">{item.entry.reason}</p> : null}
              <p className="text-xs text-muted-foreground">{formatCafeDateTime(new Date(item.at))}</p>
            </div>
          </li>
        ) : (
          <li key={`m${item.message.id}`} className="flex gap-3 text-sm">
            <MessageSquareText className="mt-0.5 size-4 shrink-0 text-brand-magenta-deep" aria-hidden="true" />
            <div className="min-w-0 flex-1 rounded-2xl bg-muted/60 px-3 py-2">
              <p className="font-semibold">
                {MESSAGE_TITLES[item.message.kind]} <span className="font-normal text-muted-foreground">· {item.message.author}</span>
              </p>
              <p className="whitespace-pre-wrap break-words">{item.message.body}</p>
              <p className="text-xs text-muted-foreground">{formatCafeDateTime(new Date(item.at))}</p>
            </div>
          </li>
        ),
      )}
    </ol>
  );
}
