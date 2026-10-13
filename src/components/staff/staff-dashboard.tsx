"use client";

/**
 * The barista dashboard for one counter.
 *
 *   Start shift     a tap that unlocks sound, keeps the screen awake and
 *                   (optionally) goes fullscreen, before the queue shows
 *   Toolbar         location (and switcher), open / closed / paused, today's
 *                   hours, the Honolulu clock, today's numbers, pause, sold
 *                   out, catering, completed, settings (staff-toolbar.tsx)
 *   Queue           Upcoming · New · In progress · Ready, laid out for the
 *                   screen it is on (queue-board.tsx)
 *   Detail          beside the queue on wide screens, over it on tablets,
 *                   full screen on phones (ticket-detail.tsx)
 *   Bottom dock     the new-order alert and the undo countdowns: part of the
 *                   layout, not floating over it, so they never cover a
 *                   ticket's button
 *
 * The screen fills the viewport and never scrolls; each column scrolls on its
 * own. Ticket density and the light or dark counter theme are per device
 * (device.ts).
 *
 * Data: the orders for this location under the barista's own session,
 * refetched whenever Realtime reports a change to one of them, on reconnect,
 * on the tab becoming visible, and every 15 s while Realtime is down
 * (useOrderChanges, shared with the customer tracker). The clock ticks every
 * second, so scheduled orders drop into New and tickets change colour
 * without any server round trip.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CheckCheck, Undo2, WifiOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { isAcceptingOrders } from "@/lib/locations/status";
import { useOrderChanges } from "@/lib/orders/live";
import { formatCents } from "@/lib/money";
import type { OrderStatus } from "@/lib/order-status";
import { QueryProvider } from "@/lib/query-client";
import { cafeDateKey, startOfCafeDay } from "@/lib/time";

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
  useDisplaySettings,
  useRememberedFullscreen,
  unlockAudio,
  useNow,
  useOnline,
  useSoundSettings,
  useMediaQuery,
  useStaffBoardClass,
  useStaffScreenClasses,
  useWakeLock,
} from "./device";
import { PausedBanner } from "./pause-control";
import { PrintView, type PrintJob } from "./print";
import { QueueBoard, type BoardLayout } from "./queue-board";
import { ShortcutsDialog, useStaffShortcuts } from "./shortcuts";
import { SoldOutPanel } from "./sold-out-panel";
import { LocationHeading, StaffToolbar, type StaffPanel } from "./staff-toolbar";
import { TicketCard, type PendingAction } from "./ticket-card";
import { TicketDetail, type DetailVariant } from "./ticket-detail";
import { useNewOrderAlerts } from "./use-new-order-alerts";

export function StaffDashboard(props: Parameters<typeof StaffDashboardContent>[0]) {
  return (
    <QueryProvider>
      <StaffDashboardContent {...props} />
    </QueryProvider>
  );
}

function StaffDashboardContent({
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
  const display = useDisplaySettings();
  useStaffScreenClasses(display.theme);

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
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <LocationHeading location={location} options={options} now={now} />
      <div className="space-y-5 rounded-3xl border border-staff-line bg-staff-card p-6 shadow-sm sm:p-8">
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
  const display = useDisplaySettings();
  useStaffBoardClass();
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

  // ---- Layout ---------------------------------------------------------------
  const [panel, setPanel] = useState<StaffPanel | null>(null);
  const [tab, setTab] = useState<QueueColumn>("new");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const atLeastTablet = useMediaQuery("(min-width: 768px)");
  const wide = useMediaQuery("(min-width: 1024px)");
  const dock = useMediaQuery("(min-width: 1280px)");
  const layout: BoardLayout = wide ? "wide" : atLeastTablet ? "portrait" : "phone";
  const detailVariant: DetailVariant = dock ? "panel" : atLeastTablet ? "sheet" : "fullscreen";

  useStaffShortcuts({
    enabled: true,
    onAcknowledge: alerts.acknowledgeAll,
    onEscape: () => setDetailId(null),
    onHelp: () => setShortcutsOpen(true),
  });

  const renderTicket = (order: StaffOrder, column: QueueColumn) => (
    <TicketCard
      key={order.id}
      order={order}
      column={column}
      now={now}
      prepMinutes={prep}
      urgency={ticketUrgency(order, now, prep, thresholds)}
      meta={catalog}
      density={display.density}
      unacknowledged={alerts.unacknowledged.has(order.id)}
      selected={detailVariant === "panel" && detailId === order.id}
      pending={pending[order.id]}
      busy={busy.has(order.id)}
      onAction={act}
      onUndo={undo}
      onOpen={open}
    />
  );

  const pendingOrders = Object.keys(pending)
    .map((id) => allOrders.find((o) => o.id === id))
    .filter((o): o is StaffOrder => Boolean(o));

  const detailView = (
    <TicketDetail
      order={detail}
      meta={catalog}
      density={display.density}
      variant={detailVariant}
      onClose={() => setDetailId(null)}
      onPrint={(kind, order) => setPrintJob({ kind, order })}
      onCancel={cancel}
    />
  );

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-3"
      data-testid="staff-dashboard"
      data-live={live ? "true" : "false"}
      data-layout={layout}
      data-density={display.density}
      data-theme={display.theme}
    >
      <StaffToolbar
        phone={layout === "phone"}
        location={location}
        options={options}
        now={now}
        accepting={accepting}
        onlineOrderingEnabled={locationState.data.onlineOrderingEnabled}
        summary={summary}
        pausedUntil={locationState.data.pausedUntil}
        pausing={pausing}
        onPause={pause}
        onResume={resume}
        cateringCount={catering.data?.length || undefined}
        onOpenPanel={setPanel}
        onShowShortcuts={() => setShortcutsOpen(true)}
      />

      {/* Standing conditions: each one a slim strip under the toolbar. */}
      {disconnected ? (
        <div
          role="alert"
          data-testid="offline-banner"
          className="flex items-center gap-3 rounded-xl bg-staff-fill-late px-4 py-2.5 text-white"
        >
          <WifiOff className="size-6 shrink-0" aria-hidden="true" />
          <p className="text-lg font-extrabold">
            Offline — reconnecting…{" "}
            <span className="font-semibold">New orders may be missing and taps won&apos;t save until it&apos;s back.</span>
          </p>
        </div>
      ) : null}
      {!locationState.data.onlineOrderingEnabled ? (
        <div role="status" className="rounded-xl border-l-[6px] border-staff-warn bg-staff-warn-soft px-4 py-2.5 text-lg font-bold">
          Online ordering is switched off for every location (admin setting).
        </div>
      ) : null}
      {!accepting ? <PausedBanner pausedUntil={locationState.data.pausedUntil} now={now} busy={pausing} onResume={resume} /> : null}
      {wakeLock === "unsupported" || wakeLock === "failed" ? (
        <p className="rounded-xl bg-staff-chip px-4 py-2 text-base" data-testid="wake-lock-warning">
          {wakeLock === "unsupported"
            ? "This browser can't keep the screen awake. Set the tablet's screen timeout to Never (README)."
            : "The screen may go to sleep: the browser refused to keep it awake. Tap the page to try again."}
        </p>
      ) : null}
      {orders.isError && !orders.data ? (
        <p role="alert" className="rounded-xl border-2 border-staff-late/60 px-4 py-2.5 text-lg">
          Couldn&apos;t load the orders. Retrying…
        </p>
      ) : null}
      <span hidden data-testid="alert-state" data-alert-count={alerts.alertCount} data-alerting={alerts.alerting ? "true" : "false"} />

      <div className="flex min-h-0 flex-1 gap-2.5">
        <QueueBoard
          layout={layout}
          queue={queue}
          loading={orders.isPending}
          unacknowledged={alerts.unacknowledged.size}
          tab={tab}
          onTabChange={setTab}
          renderTicket={renderTicket}
        />
        {detailVariant === "panel" ? detailView : null}
      </div>

      {/* Bottom dock: the new-order alert and the undo countdowns. In the
          layout rather than over it, so nothing here ever covers a ticket. */}
      {alerts.alerting || pendingOrders.length ? (
        <div className="flex flex-col items-center gap-2">
          {alerts.alerting ? (
            <div
              role="alert"
              className="flex w-full max-w-xl items-center gap-3 rounded-xl bg-staff-fill-new py-1 pr-1 pl-4 text-white shadow-lg"
              data-testid="new-order-alert"
            >
              <BellRing className="size-6 shrink-0 motion-safe:animate-pulse" aria-hidden="true" />
              <p className="min-w-0 flex-1 text-base font-extrabold sm:text-lg">
                {alerts.unacknowledged.size} new order{alerts.unacknowledged.size === 1 ? "" : "s"}
              </p>
              <button
                type="button"
                onClick={alerts.acknowledgeAll}
                aria-keyshortcuts="A"
                className="focus-ring inline-flex min-h-14 items-center gap-2 rounded-lg bg-white px-5 text-lg font-extrabold text-brand-ink"
              >
                <CheckCheck className="size-6" aria-hidden="true" /> Acknowledge
              </button>
            </div>
          ) : null}
          {pendingOrders.length ? (
            <div className="flex w-full max-w-xl flex-col gap-2" data-testid="undo-toasts">
              {pendingOrders.map((order) => {
                const p = pending[order.id];
                const seconds = Math.max(0, Math.ceil((p.deadline - now.getTime()) / 1000));
                return (
                  <div
                    key={order.id}
                    role="status"
                    className="flex items-center gap-3 rounded-xl bg-foreground py-1 pr-1 pl-4 text-background shadow-lg"
                  >
                    <p className="min-w-0 flex-1 text-lg font-bold">
                      {p.label} {order.cupName ?? order.orderNumber}{" "}
                      <span className="tabular opacity-80">({seconds})</span>
                    </p>
                    <button
                      type="button"
                      onClick={() => undo(order)}
                      className="focus-ring inline-flex min-h-14 items-center gap-2 rounded-lg bg-background px-5 text-lg font-extrabold text-foreground"
                    >
                      <Undo2 className="size-5" aria-hidden="true" /> Undo
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {detailVariant === "panel" ? null : detailView}
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
        onOpenOrder={(order) => {
          // The drawer and a docked panel share the right edge: close the drawer first.
          if (detailVariant === "panel") setPanel(null);
          setDetailId(order.id);
        }}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <PrintView job={printJob} meta={catalog} settings={location.settings} locationName={location.name} onDone={endPrint} />
    </div>
  );
}
