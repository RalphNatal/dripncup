"use client";

/**
 * The queue's columns, laid out for the screen they are on.
 *
 *   wide       1024 px and up (tablet landscape, laptop, wall display):
 *              Upcoming · New · In progress · Ready side by side. Upcoming
 *              shrinks to a narrow strip while it is empty, so the busy
 *              columns get the room
 *   portrait   768-1023 px (tablet portrait): New on the left, always; In
 *              progress, Ready and Upcoming as tabs on the right, so the two
 *              columns a barista works from are on screen together
 *   phone      one column at a time, as tabs with counts
 *
 * Each column scrolls on its own under a header that stays put (the screen
 * itself never scrolls, so the toolbar is always there). The ticket itself is
 * rendered by the dashboard (renderTicket), which owns the state.
 */
import { CalendarClock, ChefHat, CupSoda, Inbox } from "lucide-react";
import { Tabs as TabsPrimitive } from "radix-ui";
import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { QUEUE_COLUMNS, type Queue, type QueueColumn, type StaffOrder } from "@/lib/staff/queue";

export type BoardLayout = "phone" | "portrait" | "wide";

const LABELS: Record<QueueColumn, string> = Object.fromEntries(QUEUE_COLUMNS.map((c) => [c.id, c.label])) as Record<
  QueueColumn,
  string
>;

/** The colour of the action that takes a ticket out of the column, as a small key on its header. */
const DOT: Record<QueueColumn, string> = {
  upcoming: "bg-muted-foreground/50",
  new: "bg-staff-fill-new",
  in_progress: "bg-staff-fill-start",
  ready: "bg-staff-fill-ready",
};

const EMPTY: Record<QueueColumn, { icon: typeof Inbox; title: string; hint: string }> = {
  upcoming: { icon: CalendarClock, title: "No scheduled orders", hint: "Orders for a later pickup wait here until it's time to make them." },
  new: { icon: Inbox, title: "No new orders", hint: "New orders appear here with a chime." },
  in_progress: { icon: ChefHat, title: "Nothing being made", hint: "Accepted orders move here." },
  ready: { icon: CupSoda, title: "Nothing waiting for pickup", hint: "Finished orders wait here until they're collected." },
};

interface BoardProps {
  layout: BoardLayout;
  queue: Queue;
  loading: boolean;
  /** Unacknowledged new orders, for the New tab's badge. */
  unacknowledged: number;
  tab: QueueColumn;
  onTabChange: (tab: QueueColumn) => void;
  renderTicket: (order: StaffOrder, column: QueueColumn) => ReactNode;
}

export function QueueBoard(props: BoardProps) {
  if (props.layout === "phone") return <PhoneBoard {...props} />;
  if (props.layout === "portrait") return <PortraitBoard {...props} />;
  return <WideBoard {...props} />;
}

function ColumnBody({ id, queue, loading, renderTicket }: { id: QueueColumn } & Pick<BoardProps, "queue" | "loading" | "renderTicket">) {
  const orders = queue[id];
  return (
    <div
      className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain px-2 pt-0.5 pb-3"
      data-testid={`column-${id}`}
      data-count={orders.length}
    >
      {loading && orders.length === 0 ? (
        <ColumnSkeleton />
      ) : orders.length === 0 ? (
        <EmptyColumn id={id} />
      ) : (
        orders.map((order) => renderTicket(order, id))
      )}
    </div>
  );
}

function ColumnSkeleton() {
  return (
    <div role="status" aria-label="Loading orders" className="space-y-2.5">
      {[0, 1].map((i) => (
        <div key={i} className="space-y-2 rounded-xl border border-staff-line bg-staff-card p-3">
          <Skeleton className="h-7 w-2/3 rounded-md" />
          <Skeleton className="h-6 w-1/2 rounded-md" />
          <Skeleton className="h-16 w-full rounded-md" />
          <Skeleton className="h-14 w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}

function EmptyColumn({ id }: { id: QueueColumn }) {
  const { icon: Icon, title, hint } = EMPTY[id];
  return (
    <div className="flex flex-col items-center gap-2 px-4 pt-[12vh] pb-10 text-center" data-testid="empty-column">
      <Icon className="size-10 text-muted-foreground/60" aria-hidden="true" strokeWidth={1.5} />
      <p className="text-lg font-bold">{title}</p>
      <p className="max-w-56 text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

function ColumnHeader({ id, count }: { id: QueueColumn; count: number }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 pt-2 pb-1.5">
      <h2 id={`col-${id}`} className="flex min-w-0 items-center gap-2 font-sans text-base font-extrabold tracking-wide uppercase">
        <span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-full", DOT[id])} />
        <span className="truncate">{LABELS[id]}</span>
      </h2>
      <span className="tabular text-3xl leading-none font-extrabold" data-testid={`count-${id}`} aria-label={`${count} orders`}>
        {count}
      </span>
    </div>
  );
}

function Column({ id, ...rest }: { id: QueueColumn } & Pick<BoardProps, "queue" | "loading" | "renderTicket">) {
  return (
    <section aria-labelledby={`col-${id}`} className="flex min-h-0 min-w-0 flex-col rounded-2xl bg-staff-column">
      <ColumnHeader id={id} count={rest.queue[id].length} />
      <ColumnBody id={id} {...rest} />
    </section>
  );
}

function WideBoard({ queue, loading, renderTicket }: BoardProps) {
  const collapsed = queue.upcoming.length === 0;
  return (
    <div
      className="grid min-h-0 min-w-0 flex-1 gap-2.5"
      style={{ gridTemplateColumns: collapsed ? "auto repeat(3, minmax(0, 1fr))" : "minmax(0, 0.8fr) repeat(3, minmax(0, 1fr))" }}
      data-testid="queue-board"
      data-layout="wide"
    >
      {collapsed ? (
        <section
          aria-labelledby="col-upcoming"
          className="flex w-14 flex-col items-center gap-3 rounded-2xl bg-staff-column py-3"
          data-testid="upcoming-collapsed"
        >
          <span className="tabular text-2xl leading-none font-extrabold text-muted-foreground" data-testid="count-upcoming" aria-label="0 orders">
            0
          </span>
          <h2
            id="col-upcoming"
            className="rotate-180 font-sans text-sm font-extrabold tracking-wider text-muted-foreground uppercase [writing-mode:vertical-rl]"
          >
            Upcoming
          </h2>
        </section>
      ) : (
        <Column id="upcoming" queue={queue} loading={loading} renderTicket={renderTicket} />
      )}
      {(["new", "in_progress", "ready"] as const).map((id) => (
        <Column key={id} id={id} queue={queue} loading={loading} renderTicket={renderTicket} />
      ))}
    </div>
  );
}

function TabTrigger({ id, count, alert }: { id: QueueColumn; count: number; alert?: boolean }) {
  return (
    <TabsPrimitive.Trigger
      value={id}
      data-testid={`tab-${id}`}
      className={cn(
        "focus-ring flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-sm leading-tight font-bold text-muted-foreground",
        "data-[state=active]:bg-staff-card data-[state=active]:text-foreground data-[state=active]:shadow-sm",
      )}
    >
      <span className="max-w-full truncate whitespace-nowrap">{LABELS[id]}</span>
      <span
        className={cn(
          "tabular min-w-8 rounded-full px-1.5 text-lg leading-6 font-extrabold",
          alert ? "bg-staff-fill-new text-white" : "text-foreground",
        )}
      >
        {count}
      </span>
    </TabsPrimitive.Trigger>
  );
}

function PhoneBoard({ queue, loading, unacknowledged, tab, onTabChange, renderTicket }: BoardProps) {
  const order: QueueColumn[] = ["new", "in_progress", "ready", "upcoming"];
  return (
    <TabsPrimitive.Root
      value={tab}
      onValueChange={(value) => onTabChange(value as QueueColumn)}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-2"
      data-testid="queue-board"
      data-layout="phone"
    >
      <TabsPrimitive.List aria-label="Queue" className="flex gap-1 rounded-2xl bg-staff-column p-1">
        {order.map((id) => (
          <TabTrigger key={id} id={id} count={queue[id].length} alert={id === "new" && unacknowledged > 0} />
        ))}
      </TabsPrimitive.List>
      {order.map((id) => (
        <TabsPrimitive.Content key={id} value={id} className="flex min-h-0 flex-1 flex-col rounded-2xl bg-staff-column pt-2 outline-none">
          <ColumnBody id={id} queue={queue} loading={loading} renderTicket={renderTicket} />
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}

function PortraitBoard({ queue, loading, tab, onTabChange, renderTicket }: BoardProps) {
  const right: QueueColumn[] = ["in_progress", "ready", "upcoming"];
  const active = right.includes(tab) ? tab : "in_progress";
  return (
    <div className="grid min-h-0 min-w-0 flex-1 grid-cols-2 gap-2.5" data-testid="queue-board" data-layout="portrait">
      <Column id="new" queue={queue} loading={loading} renderTicket={renderTicket} />
      <TabsPrimitive.Root
        value={active}
        onValueChange={(value) => onTabChange(value as QueueColumn)}
        className="flex min-h-0 min-w-0 flex-col rounded-2xl bg-staff-column"
      >
        <TabsPrimitive.List aria-label="More columns" className="flex gap-1 p-1">
          {right.map((id) => (
            <TabTrigger key={id} id={id} count={queue[id].length} />
          ))}
        </TabsPrimitive.List>
        {right.map((id) => (
          <TabsPrimitive.Content key={id} value={id} className="flex min-h-0 flex-1 flex-col pt-1 outline-none">
            <ColumnBody id={id} queue={queue} loading={loading} renderTicket={renderTicket} />
          </TabsPrimitive.Content>
        ))}
      </TabsPrimitive.Root>
    </div>
  );
}
