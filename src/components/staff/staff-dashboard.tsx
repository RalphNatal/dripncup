"use client";

/**
 * The barista dashboard for one counter.
 *
 *   Start shift     a tap that unlocks sound, keeps the screen awake and
 *                   (optionally) goes fullscreen, before the queue shows
 *   Header          location (and switcher), open / closed / paused, today's
 *                   hours, sound, pause, sold out, catering, completed
 *   Summary         orders today, average time to ready, how many waiting
 *   Queue           Upcoming · New · In progress · Ready as columns on a
 *                   tablet, as tabs on a phone
 *
 * Data: the orders for this location under the barista's own session,
 * refetched whenever Realtime reports a change to one of them, on reconnect,
 * on the tab becoming visible, and every 15 s while Realtime is down
 * (useOrderChanges, shared with the customer tracker). The clock ticks every
 * second, so scheduled orders drop into New and tickets change colour
 * without any server round trip.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BellRing,
  CheckCheck,
  ChefHat,
  ClipboardList,
  Maximize,
  PackageX,
  Volume2,
  VolumeX,
  WifiOff,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getLocationStatus, isAcceptingOrders, statusLabel, todaysHoursText } from "@/lib/locations/status";
import { useOrderChanges } from "@/lib/orders/live";
import { formatCents } from "@/lib/money";
import type { OrderStatus } from "@/lib/order-status";
import { cafeDateKey, startOfCafeDay } from "@/lib/time";
import { cn } from "@/lib/utils";

import { rememberStaffLocation } from "@/lib/staff/actions";
import {
  advanceOrder,
  cancelOrder,
  fetchCateringPrep,
  fetchCatalogMeta,
  fetchLocationState,
  fetchStaffOrders,
  setAcceptingOrders,
} from "@/lib/staff/client";
import type { StaffLocationOption } from "@/lib/staff/locations";
import {
  QUEUE_COLUMNS,
  UNDO_WINDOW_MS,
  buildQueue,
  nextAction,
  summarise,
  ticketUrgency,
  type QueueColumn,
  type StaffOrder,
} from "@/lib/staff/queue";
import { EMPTY_CATALOG_META } from "@/lib/staff/ticket";
import type { StaffLocationContext } from "@/lib/staff/types";

import { CateringPanel } from "./catering-panel";
import { CompletedDrawer, completedToday } from "./completed-drawer";
import {
  enterFullscreen,
  rememberFullscreen,
  useRememberedFullscreen,
  toggleFullscreen,
  unlockAudio,
  useNow,
  useOnline,
  useSoundSettings,
  useMediaQuery,
  useWakeLock,
} from "./device";
import { PauseButton, PausedBanner } from "./pause-control";
import { PrintView, type PrintJob } from "./print";
import { SoldOutPanel } from "./sold-out-panel";
import { TicketCard, type PendingAction } from "./ticket-card";
import { TicketDetail } from "./ticket-detail";
import { useNewOrderAlerts } from "./use-new-order-alerts";

const EMPTY_COLUMN_TEXT: Record<QueueColumn, string> = {
  upcoming: "No scheduled orders waiting.",
  new: "No new orders.",
  in_progress: "Nothing being made.",
  ready: "Nothing waiting for pickup.",
};

export function StaffDashboard({
  location,
  options,
  viewer,
  renderedAt,
  clockOffsetMs = 0,
}: {
  location: StaffLocationContext;
  options: StaffLocationOption[];
  viewer: { id: string; name: string; role: "customer" | "staff" | "admin" };
  /** When the server rendered the page (ISO): the Start shift heading's clock until hydrated. */
  renderedAt: string;
  /**
   * The server's request clock minus real time: always 0, except under the
   * e2e suite's controllable clock (src/lib/test-clock.ts), which moves the
   * catering prep list to "the day of the event".
   */
  clockOffsetMs?: number;
}) {
  const [started, setStarted] = useState(false);
  const wakeLock = useWakeLock(started);

  if (!started) {
    return (
      <StartShift
        location={location}
        options={options}
        viewerName={viewer.name}
        renderedAt={renderedAt}
        onStart={(fullscreen) => {
          unlockAudio();
          rememberFullscreen(fullscreen);
          if (fullscreen) enterFullscreen();
          setStarted(true);
        }}
      />
    );
  }
  return <Dashboard location={location} options={options} wakeLock={wakeLock} clockOffsetMs={clockOffsetMs} />;
}

// ---------------------------------------------------------------------------
// Start shift.
// ---------------------------------------------------------------------------

function StartShift({
  location,
  options,
  viewerName,
  renderedAt,
  onStart,
}: {
  location: StaffLocationContext;
  options: StaffLocationOption[];
  viewerName: string;
  renderedAt: string;
  onStart: (fullscreen: boolean) => void;
}) {
  // Open/closed is worked out from the clock: the server's render time while
  // hydrating (so the heading matches the HTML), then the live clock.
  const [serverNow] = useState(() => new Date(renderedAt));
  const now = useNow(serverNow);
  const remembered = useRememberedFullscreen();
  const [choice, setFullscreen] = useState<boolean | null>(null);
  const fullscreen = choice ?? remembered;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-6">
      <LocationHeading location={location} options={options} now={now} />
      <div className="space-y-5 rounded-3xl border-2 bg-card p-6 sm:p-8">
        <h1 className="font-heading text-4xl font-extrabold">Aloha, {viewerName}!</h1>
        <p className="text-xl">
          Starting your shift turns on the new-order sound and keeps this screen awake while the queue is open.
        </p>
        <label className="flex min-h-14 cursor-pointer items-center gap-3 text-lg font-semibold">
          <input
            type="checkbox"
            checked={fullscreen}
            onChange={(event) => setFullscreen(event.target.checked)}
            className="size-6 accent-[var(--brand-teal-deep)]"
          />
          Go fullscreen
        </label>
        <button
          type="button"
          onClick={() => onStart(fullscreen)}
          className="focus-ring min-h-20 w-full rounded-2xl bg-brand-teal-deep text-3xl font-extrabold text-white"
        >
          Start shift
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Location: name, switcher, status and today's hours. Always on screen.
// ---------------------------------------------------------------------------

function LocationHeading({
  location,
  options,
  now,
  accepting,
  onlineOrderingEnabled,
}: {
  location: StaffLocationContext;
  options: StaffLocationOption[];
  now: Date | null;
  accepting?: boolean;
  onlineOrderingEnabled?: boolean;
}) {
  const router = useRouter();
  const [switching, startSwitch] = useTransition();
  const at = now ?? new Date();
  const statusLocation = {
    id: location.id,
    type: location.type,
    acceptingOrders: accepting ?? location.acceptingOrders,
    startsAt: location.startsAt,
    endsAt: location.endsAt,
  };
  const status = getLocationStatus({
    location: statusLocation,
    hours: location.hours,
    closures: location.closures,
    now: at,
    onlineOrderingEnabled: onlineOrderingEnabled ?? location.onlineOrderingEnabled,
  });
  const today = todaysHoursText({ location: statusLocation, hours: location.hours, closures: location.closures, now: at });

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
      {options.length > 1 ? (
        <label className="min-w-0">
          <span className="sr-only">Location</span>
          <select
            value={location.id}
            disabled={switching}
            onChange={(event) => {
              const id = event.target.value;
              startSwitch(async () => {
                const result = await rememberStaffLocation(id);
                if (!result.ok) {
                  toast.error(result.message);
                  return;
                }
                router.replace("/staff");
                router.refresh();
              });
            }}
            className="focus-ring min-h-14 max-w-full rounded-xl border-2 bg-card pr-10 pl-3 font-heading text-2xl font-extrabold"
            data-testid="location-switcher"
          >
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
                {option.type === "event" ? " (pop-up)" : ""}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <h1 className="font-heading text-2xl font-extrabold" data-testid="location-name">
          {location.name}
        </h1>
      )}
      <span
        data-testid="location-status"
        className={cn(
          "rounded-full px-3 py-1 text-lg font-extrabold",
          status.kind === "open" && "bg-success text-white",
          status.kind === "paused" && "bg-warning text-white",
          (status.kind === "closed" || status.kind === "event") && "bg-muted text-foreground",
        )}
      >
        {statusLabel(status, at)}
      </span>
      <span className="text-lg text-muted-foreground" data-testid="todays-hours">
        Today: {today.hours}
        {today.note ? ` · ${today.note}` : ""}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The dashboard proper.
// ---------------------------------------------------------------------------

function Dashboard({
  location,
  options,
  wakeLock,
  clockOffsetMs,
}: {
  location: StaffLocationContext;
  options: StaffLocationOption[];
  wakeLock: ReturnType<typeof useWakeLock>;
  clockOffsetMs: number;
}) {
  const queryClient = useQueryClient();
  const now = useNow() ?? new Date();
  const online = useOnline();
  const sound = useSoundSettings();
  const prep = location.prepTimeMinutes;
  const thresholds = { warningMinutes: location.settings.warningMinutes, lateMinutes: location.settings.lateMinutes };

  // Today, in Honolulu. The query key carries the date, so at midnight the
  // completed list and the summary start over.
  const dateKey = cafeDateKey(now);
  const todayStart = useMemo(() => startOfCafeDay(new Date(`${dateKey}T12:00:00-10:00`)), [dateKey]);

  // ---- Data -----------------------------------------------------------------
  const ordersKey = useMemo(() => ["staff-orders", location.id, dateKey] as const, [location.id, dateKey]);
  const orders = useQuery({
    queryKey: ordersKey,
    queryFn: () => fetchStaffOrders(location.id, todayStart),
    staleTime: 0,
  });
  const meta = useQuery({ queryKey: ["staff-catalog-meta"], queryFn: fetchCatalogMeta, staleTime: 10 * 60_000 });
  const locationState = useQuery({
    queryKey: ["staff-location", location.id],
    queryFn: () => fetchLocationState(location.id),
    initialData: {
      acceptingOrders: location.acceptingOrders,
      pausedUntil: location.pausedUntil,
      pausedAt: location.pausedAt,
      onlineOrderingEnabled: location.onlineOrderingEnabled,
    },
    staleTime: 0,
    refetchInterval: 20_000,
  });
  // The prep list's day: today in Honolulu (by the server's clock).
  const prepDay = clockOffsetMs ? cafeDateKey(new Date(now.getTime() + clockOffsetMs)) : dateKey;
  const catering = useQuery({
    queryKey: ["staff-catering", location.id, prepDay],
    queryFn: () => fetchCateringPrep(location.id, prepDay),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["staff-orders", location.id] });
    void queryClient.invalidateQueries({ queryKey: ["staff-location", location.id] });
  }, [queryClient, location.id]);
  const { live } = useOrderChanges(`location_id=eq.${location.id}`, refresh);

  // ---- Derived --------------------------------------------------------------
  const allOrders = useMemo(() => orders.data ?? [], [orders.data]);
  const queue = buildQueue(allOrders, now, prep);
  const summary = summarise(allOrders, queue, { todayStart, prepMinutes: prep });
  const completed = useMemo(() => completedToday(allOrders, todayStart), [allOrders, todayStart]);
  const catalog = meta.data ?? EMPTY_CATALOG_META;
  const accepting = isAcceptingOrders(locationState.data.acceptingOrders, locationState.data.pausedUntil, now);
  const newIds = queue.new.map((o) => o.id);
  const newKey = newIds.join(",");
  const stableNewIds = useMemo(() => (newKey ? newKey.split(",") : []), [newKey]);

  // ---- Alerts ---------------------------------------------------------------
  const alerts = useNewOrderAlerts({
    locationId: location.id,
    newOrderIds: stableNewIds,
    enabled: true,
    repeatSeconds: location.settings.repeatSeconds,
    volume: sound.volume,
    muted: sound.muted,
  });

  // A count in the tab title, so a hidden tab still says something is waiting.
  useEffect(() => {
    const original = document.title;
    return () => {
      document.title = original;
    };
  }, []);
  useEffect(() => {
    const count = queue.new.length;
    document.title = count > 0 ? `(${count}) New order${count === 1 ? "" : "s"} · ${location.name}` : `Staff · ${location.name}`;
  }, [queue.new.length, location.name]);

  // ---- Connection -----------------------------------------------------------
  // Realtime starts out not yet joined; only a drop after it has joined counts
  // as losing the connection (adjusting state during render, not in an effect).
  const [everLive, setEverLive] = useState(false);
  if (live && !everLive) setEverLive(true);
  const disconnected = !online || (everLive && !live);

  const { acknowledge } = alerts;

  // ---- One-tap actions and the undo window ----------------------------------
  const [pending, setPending] = useState<Record<string, PendingAction>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [busy, setBusy] = useState<Set<string>>(new Set());

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((timer) => clearTimeout(timer));
  }, []);

  const send = useCallback(
    async (order: StaffOrder, from: OrderStatus, to: OrderStatus) => {
      setBusy((b) => new Set(b).add(order.id));
      try {
        const result = await advanceOrder(order.id, from, to);
        if (result.outcome === "already") {
          toast.info("Already updated", {
            description: `${order.cupName ?? order.orderNumber}'s order was changed on another screen. Showing the latest.`,
          });
        } else if (result.outcome === "error") {
          toast.error(result.message);
        }
      } finally {
        setBusy((b) => {
          const next = new Set(b);
          next.delete(order.id);
          return next;
        });
        refresh();
      }
    },
    [refresh],
  );

  const act = useCallback(
    (order: StaffOrder) => {
      const action = nextAction(order.status);
      if (!action) return;
      acknowledge([order.id]);
      if (!action.pendingLabel) {
        void send(order, order.status, action.to);
        return;
      }
      // Ready and Picked up tell (or close out) the customer: hold them for
      // a few seconds so a mis-tap can be undone before anything is sent.
      const from = order.status;
      const to = action.to as PendingAction["to"];
      setPending((p) => ({ ...p, [order.id]: { to, label: action.pendingLabel!, deadline: Date.now() + UNDO_WINDOW_MS } }));
      timers.current.set(
        order.id,
        setTimeout(() => {
          timers.current.delete(order.id);
          setPending((p) => {
            const next = { ...p };
            delete next[order.id];
            return next;
          });
          void send(order, from, to);
        }, UNDO_WINDOW_MS),
      );
    },
    [acknowledge, send],
  );

  const undo = useCallback((order: StaffOrder) => {
    clearTimeout(timers.current.get(order.id));
    timers.current.delete(order.id);
    setPending((p) => {
      const next = { ...p };
      delete next[order.id];
      return next;
    });
  }, []);

  // ---- Detail, cancel, print ------------------------------------------------
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = detailId ? (allOrders.find((o) => o.id === detailId) ?? null) : null;
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);
  const endPrint = useCallback(() => setPrintJob(null), [setPrintJob]);

  const open = useCallback(
    (order: StaffOrder) => {
      acknowledge([order.id]);
      setDetailId(order.id);
    },
    [acknowledge, setDetailId],
  );

  const cancel = useCallback(
    async (order: StaffOrder, reason: string, refundableCents: number) => {
      const result = await cancelOrder(order.id, reason);
      refresh();
      if (result.outcome === "already") {
        toast.info("Already updated", { description: "This order can no longer be cancelled. Showing the latest." });
        return true;
      }
      if (result.outcome === "error") {
        toast.error(result.message);
        return false;
      }
      if (result.refundFailed) {
        toast.warning(`Order ${order.orderNumber} cancelled`, {
          description: "The refund didn't go through. It's saved for an admin to retry.",
        });
      } else {
        toast.success(`Order ${order.orderNumber} cancelled`, {
          description:
            result.refundedCents > 0
              ? `${formatCents(result.refundedCents)} refunded to the customer.`
              : refundableCents > 0
                ? "The refund is on its way."
                : "No payment to refund.",
        });
      }
      return true;
    },
    [refresh],
  );

  // ---- Pause ----------------------------------------------------------------
  const [pausing, setPausing] = useState(false);
  const pause = useCallback(
    async (minutes: number | null) => {
      setPausing(true);
      const result = await setAcceptingOrders(location.id, false, minutes ? new Date(Date.now() + minutes * 60_000) : null);
      setPausing(false);
      if (result.outcome === "error") toast.error(result.message);
      else toast.success(minutes ? `Online orders paused for ${minutes} minutes` : "Online orders paused");
      void queryClient.invalidateQueries({ queryKey: ["staff-location", location.id] });
    },
    [location.id, queryClient],
  );
  const resume = useCallback(async () => {
    setPausing(true);
    const result = await setAcceptingOrders(location.id, true, null);
    setPausing(false);
    if (result.outcome === "error") toast.error(result.message);
    else toast.success("Online orders are back on");
    void queryClient.invalidateQueries({ queryKey: ["staff-location", location.id] });
  }, [location.id, queryClient]);

  // ---- Panels ---------------------------------------------------------------
  const [panel, setPanel] = useState<"sold-out" | "catering" | "completed" | null>(null);
  const [tab, setTab] = useState<QueueColumn>("new");
  const wide = useMediaQuery("(min-width: 1024px)");

  const renderColumn = (column: QueueColumn) => (
    <div className="space-y-3" data-testid={`column-${column}`}>
      {queue[column].length === 0 ? (
        <p className="rounded-2xl border-2 border-dashed p-6 text-center text-lg text-muted-foreground">
          {EMPTY_COLUMN_TEXT[column]}
        </p>
      ) : (
        queue[column].map((order) => (
          <TicketCard
            key={order.id}
            order={order}
            column={column}
            now={now}
            prepMinutes={prep}
            urgency={ticketUrgency(order, now, prep, thresholds)}
            meta={catalog}
            unacknowledged={alerts.unacknowledged.has(order.id)}
            pending={pending[order.id]}
            busy={busy.has(order.id)}
            onAction={act}
            onUndo={undo}
            onOpen={open}
          />
        ))
      )}
    </div>
  );

  const pendingOrders = Object.keys(pending)
    .map((id) => allOrders.find((o) => o.id === id))
    .filter((o): o is StaffOrder => Boolean(o));

  return (
    <div className="flex flex-col gap-3" data-testid="staff-dashboard" data-live={live ? "true" : "false"}>
      {/* Header */}
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <LocationHeading
            location={location}
            options={options}
            now={now}
            accepting={accepting}
            onlineOrderingEnabled={locationState.data.onlineOrderingEnabled}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                unlockAudio();
                sound.setMuted(!sound.muted);
              }}
              aria-pressed={!sound.muted}
              aria-label={sound.muted ? "Sound off. Turn sound on" : "Sound on. Mute"}
              className={cn(
                "focus-ring inline-flex size-14 items-center justify-center rounded-xl border-2",
                sound.muted ? "border-destructive text-destructive" : "bg-card",
              )}
            >
              {sound.muted ? <VolumeX className="size-7" aria-hidden="true" /> : <Volume2 className="size-7" aria-hidden="true" />}
            </button>
            <label className="hidden items-center gap-2 sm:flex">
              <span className="sr-only">Alert volume</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={sound.muted ? 0 : sound.volume}
                onChange={(event) => {
                  unlockAudio();
                  sound.setVolume(Number(event.target.value));
                }}
                className="h-14 w-32 accent-[var(--brand-teal-deep)]"
              />
            </label>
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label="Toggle fullscreen"
              className="focus-ring hidden size-14 items-center justify-center rounded-xl border-2 bg-card sm:inline-flex"
            >
              <Maximize className="size-7" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <dl className="flex flex-wrap gap-2" data-testid="summary">
            <SummaryStat label="Orders today" value={String(summary.ordersToday)} testId="summary-orders" />
            <SummaryStat
              label="Avg to ready"
              value={summary.averageMinutesToReady === null ? "—" : `${summary.averageMinutesToReady} min`}
              testId="summary-average"
            />
            <SummaryStat label="Waiting" value={String(summary.waiting)} testId="summary-waiting" />
          </dl>
          <div className="ml-auto flex flex-wrap gap-2">
            <PauseButton paused={!accepting} busy={pausing} onPause={pause} onResume={resume} />
            <HeaderButton onClick={() => setPanel("sold-out")} icon={<PackageX className="size-6" aria-hidden="true" />}>
              Sold out
            </HeaderButton>
            <HeaderButton
              onClick={() => setPanel("catering")}
              icon={<ChefHat className="size-6" aria-hidden="true" />}
              badge={catering.data?.length || undefined}
            >
              Catering
            </HeaderButton>
            <HeaderButton onClick={() => setPanel("completed")} icon={<ClipboardList className="size-6" aria-hidden="true" />}>
              Completed
            </HeaderButton>
          </div>
        </div>
      </header>

      {/* Banners */}
      {disconnected ? (
        <div role="alert" data-testid="offline-banner" className="flex items-center gap-3 rounded-2xl bg-destructive px-5 py-3 text-white">
          <WifiOff className="size-8 shrink-0" aria-hidden="true" />
          <p className="text-xl font-extrabold">
            Offline — reconnecting…{" "}
            <span className="font-semibold">New orders may be missing and taps won&apos;t save until it&apos;s back.</span>
          </p>
        </div>
      ) : null}
      {!locationState.data.onlineOrderingEnabled ? (
        <div role="status" className="rounded-2xl bg-warning px-5 py-3 text-xl font-extrabold text-white">
          Online ordering is switched off for every location (admin setting).
        </div>
      ) : null}
      {!accepting ? (
        <PausedBanner pausedUntil={locationState.data.pausedUntil} now={now} busy={pausing} onResume={resume} />
      ) : null}
      {wakeLock === "unsupported" || wakeLock === "failed" ? (
        <p className="rounded-xl bg-muted px-4 py-2 text-base" data-testid="wake-lock-warning">
          {wakeLock === "unsupported"
            ? "This browser can't keep the screen awake. Set the tablet's screen timeout to Never (README)."
            : "The screen may go to sleep: the browser refused to keep it awake. Tap the page to try again."}
        </p>
      ) : null}
      {alerts.alerting ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-2xl bg-brand-magenta-deep px-5 py-3 text-white"
          data-testid="new-order-alert"
        >
          <BellRing className="size-8 shrink-0 motion-safe:animate-bounce" aria-hidden="true" />
          <p className="flex-1 text-xl font-extrabold">
            {alerts.unacknowledged.size} new order{alerts.unacknowledged.size === 1 ? "" : "s"}
          </p>
          <button
            type="button"
            onClick={alerts.acknowledgeAll}
            className="focus-ring inline-flex min-h-14 items-center gap-2 rounded-xl bg-white px-5 text-lg font-extrabold text-brand-ink"
          >
            <CheckCheck className="size-6" aria-hidden="true" /> Acknowledge
          </button>
        </div>
      ) : null}
      <span hidden data-testid="alert-state" data-alert-count={alerts.alertCount} data-alerting={alerts.alerting ? "true" : "false"} />

      {orders.isError && !orders.data ? (
        <p role="alert" className="rounded-2xl border-2 border-destructive p-4 text-lg">
          Couldn&apos;t load the orders. Retrying…
        </p>
      ) : null}

      {/* Queue: columns on a tablet (lg, 1024px and up), tabs on a phone. One
          layout is rendered at a time, so each ticket exists once. */}
      {wide ? (
        <div className="grid grid-cols-4 gap-3">
          {QUEUE_COLUMNS.map((column) => (
            <section key={column.id} aria-labelledby={`col-${column.id}`} className="min-w-0 rounded-2xl bg-muted/50 p-2">
              <h2 id={`col-${column.id}`} className="mb-2 flex items-center justify-between px-2 text-2xl font-extrabold">
                {column.label}
                <span className="tabular rounded-full bg-card px-3 text-xl" data-testid={`count-${column.id}`}>
                  {queue[column.id].length}
                </span>
              </h2>
              {renderColumn(column.id)}
            </section>
          ))}
        </div>
      ) : (
        <Tabs value={tab} onValueChange={(value) => setTab(value as QueueColumn)}>
          <TabsList className="grid h-auto w-full grid-cols-4 gap-1 p-1">
            {QUEUE_COLUMNS.map((column) => (
              <TabsTrigger
                key={column.id}
                value={column.id}
                className="min-h-14 flex-col gap-0 px-1 text-base font-bold whitespace-normal"
                data-testid={`tab-${column.id}`}
              >
                <span>{column.label}</span>
                <span className="tabular text-lg">{queue[column.id].length}</span>
              </TabsTrigger>
            ))}
          </TabsList>
          {QUEUE_COLUMNS.map((column) => (
            <TabsContent key={column.id} value={column.id} className="mt-2">
              {renderColumn(column.id)}
            </TabsContent>
          ))}
        </Tabs>
      )}

      {/* Undo toasts: big, at the bottom, one per order waiting to be sent. */}
      {pendingOrders.length ? (
        <div className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-full max-w-xl flex-col gap-2 px-4" data-testid="undo-toasts">
          {pendingOrders.map((order) => {
            const p = pending[order.id];
            const seconds = Math.max(0, Math.ceil((p.deadline - now.getTime()) / 1000));
            return (
              <div key={order.id} role="status" className="flex items-center gap-3 rounded-2xl bg-brand-ink p-3 pl-5 text-white shadow-xl">
                <p className="flex-1 text-lg font-bold">
                  {p.label} {order.cupName ?? order.orderNumber} <span className="tabular opacity-80">({seconds})</span>
                </p>
                <button
                  type="button"
                  onClick={() => undo(order)}
                  className="focus-ring min-h-14 rounded-xl bg-white px-6 text-xl font-extrabold text-brand-ink"
                >
                  Undo
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      <TicketDetail
        order={detail}
        meta={catalog}
        onClose={() => setDetailId(null)}
        onPrint={(kind, order) => setPrintJob({ kind, order })}
        onCancel={cancel}
      />
      <SoldOutPanel open={panel === "sold-out"} onOpenChange={(o) => setPanel(o ? "sold-out" : null)} location={location} />
      <CateringPanel
        open={panel === "catering"}
        onOpenChange={(o) => setPanel(o ? "catering" : null)}
        locationName={location.name}
        requests={catering.data ?? []}
        loading={catering.isPending}
        failed={catering.isError}
        onChanged={() => void queryClient.invalidateQueries({ queryKey: ["staff-catering", location.id] })}
      />
      <CompletedDrawer
        open={panel === "completed"}
        onOpenChange={(o) => setPanel(o ? "completed" : null)}
        orders={completed}
        onOpenOrder={(order) => setDetailId(order.id)}
      />
      <PrintView job={printJob} meta={catalog} settings={location.settings} locationName={location.name} onDone={endPrint} />
    </div>
  );
}

function SummaryStat({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="flex min-h-14 flex-col justify-center rounded-xl bg-card px-4 py-1 shadow-sm">
      <dt className="text-sm font-semibold text-muted-foreground">{label}</dt>
      <dd className="tabular text-2xl leading-tight font-extrabold" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

function HeaderButton({
  onClick,
  icon,
  badge,
  children,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  badge?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring inline-flex min-h-14 items-center gap-2 rounded-xl border-2 bg-card px-4 text-lg font-bold"
    >
      {icon}
      {children}
      {badge ? (
        <span className="tabular rounded-full bg-brand-magenta-deep px-2 text-base text-white" aria-label={`${badge} today`}>
          {badge}
        </span>
      ) : null}
    </button>
  );
}
