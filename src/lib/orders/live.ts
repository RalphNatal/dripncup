"use client";

/**
 * Live order updates for the customer: the tracker, the active-order cards on
 * Home and the dot on the Orders tab all use these hooks.
 *
 * How it stays correct:
 *   - One Supabase Realtime channel per filter (`id=eq.<order>` for the
 *     tracker, `user_id=eq.<customer>` for the active list), shared by every
 *     component that asks for it and closed when the last one unmounts.
 *   - RLS applies to Realtime: the channel is joined with the customer's
 *     access token, so it only ever carries rows they may select.
 *   - A change event does not carry the data the UI renders; it just says
 *     "refetch". The refetch reads through RLS like any other query.
 *   - Every (re)join of the channel triggers a refetch, and so does the
 *     moment Realtime reports its database listener running, as does the tab
 *     becoming visible or the browser coming back online, so an update missed
 *     while disconnected or asleep is never lost.
 *   - While the channel is not joined (blocked websocket, server down), the
 *     data is polled every 15 seconds instead.
 */
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";

import { ORDER_DETAIL_SELECT, toOrderDetail, type OrderDetail, type OrderDetailRow } from "./detail";
import { toOrderListItem, type OrderListItem } from "./list";

/** Poll this often while Realtime is not connected. */
export const POLL_FALLBACK_MS = 15_000;

interface Listener {
  onChange: () => void;
  onLive: (live: boolean) => void;
}

interface Entry {
  channel: RealtimeChannel | null;
  listeners: Set<Listener>;
  live: boolean;
  closed: boolean;
}

const entries = new Map<string, Entry>();

/** Joins with the customer's token, or RLS would treat the socket as a guest and send nothing. */
async function authoriseRealtime() {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  await supabase.realtime.setAuth(data.session?.access_token ?? null);
}

function open(filter: string): Entry {
  const entry: Entry = { channel: null, listeners: new Set(), live: false, closed: false };
  const notify = () => entry.listeners.forEach((l) => l.onChange());
  const setLive = (live: boolean) => {
    entry.live = live;
    entry.listeners.forEach((l) => l.onLive(live));
  };

  void authoriseRealtime()
    .catch(() => undefined)
    .then(() => {
      if (entry.closed) return;
      const supabase = createClient();
      entry.channel = supabase
        .channel(`orders:${filter}:${Math.random().toString(36).slice(2, 10)}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter }, notify)
        // Realtime confirms the channel before its database listener is
        // running; a change in between would be lost. It says so when the
        // listener is ready, so refetch again then.
        .on("system", {}, (payload: { extension?: string; status?: string }) => {
          if (payload?.extension === "postgres_changes" && payload.status === "ok") notify();
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            setLive(true);
            // Joined or re-joined: anything that changed while we were not
            // listening is fetched now.
            notify();
          } else {
            setLive(false);
          }
        });
    });

  return entry;
}

/** Calls `listener.onChange` whenever an order matching `filter` changes. Returns the unsubscribe. */
function subscribe(filter: string, listener: Listener): () => void {
  let entry = entries.get(filter);
  if (!entry) {
    entry = open(filter);
    entries.set(filter, entry);
  }
  entry.listeners.add(listener);
  listener.onLive(entry.live);

  const current = entry;
  return () => {
    current.listeners.delete(listener);
    if (current.listeners.size > 0) return;
    current.closed = true;
    entries.delete(filter);
    if (current.channel) void createClient().removeChannel(current.channel);
  };
}

/**
 * Runs `onChange` when an order matching the Realtime `filter` changes, when
 * the channel (re)connects, when the tab becomes visible again and when the
 * browser comes back online -- and every 15 s while not connected.
 * `filter` null switches it off.
 */
export function useOrderChanges(filter: string | null, onChange: () => void): { live: boolean } {
  const [live, setLive] = useState(false);
  const callback = useRef(onChange);
  useEffect(() => {
    callback.current = onChange;
  });

  useEffect(() => {
    if (!filter) return;
    return subscribe(filter, { onChange: () => callback.current(), onLive: setLive });
  }, [filter]);

  useEffect(() => {
    if (!filter) return;
    const resync = () => {
      if (document.visibilityState === "visible") callback.current();
    };
    document.addEventListener("visibilitychange", resync);
    window.addEventListener("online", resync);
    return () => {
      document.removeEventListener("visibilitychange", resync);
      window.removeEventListener("online", resync);
    };
  }, [filter]);

  useEffect(() => {
    if (!filter || live) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") callback.current();
    }, POLL_FALLBACK_MS);
    return () => clearInterval(timer);
  }, [filter, live]);

  return { live: Boolean(filter) && live };
}

function useInvalidateOn(filter: string | null, queryKey: QueryKey) {
  const queryClient = useQueryClient();
  const key = useRef(queryKey);
  useEffect(() => {
    key.current = queryKey;
  });
  return useOrderChanges(filter, () => void queryClient.invalidateQueries({ queryKey: key.current }));
}

// ---------------------------------------------------------------------------
// The tracker: one order.
// ---------------------------------------------------------------------------

export const orderQueryKey = (orderId: string) => ["order", orderId] as const;

async function fetchOrderDetail(orderId: string): Promise<OrderDetail | null> {
  const { data, error } = await createClient().from("orders").select(ORDER_DETAIL_SELECT).eq("id", orderId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toOrderDetail(data as unknown as OrderDetailRow) : null;
}

/** One order, kept live. Starts from the server-rendered copy. */
export function useLiveOrder(initial: OrderDetail) {
  const query = useQuery({
    queryKey: orderQueryKey(initial.id),
    queryFn: () => fetchOrderDetail(initial.id),
    initialData: initial,
    staleTime: 0,
    refetchOnMount: false,
  });
  const { live } = useInvalidateOn(`id=eq.${initial.id}`, orderQueryKey(initial.id));
  return { order: query.data ?? initial, live };
}

// ---------------------------------------------------------------------------
// Active orders: Home cards and the Orders tab dot.
// ---------------------------------------------------------------------------

export const activeOrdersQueryKey = (userId: string) => ["orders", "active", userId] as const;

async function fetchActiveOrders(): Promise<OrderListItem[]> {
  const { data, error } = await createClient().rpc("list_my_orders", { p_scope: "active", p_limit: 20 });
  if (error) throw new Error(error.message);
  return (data ?? []).map(toOrderListItem);
}

/**
 * The signed-in customer's orders in Placed through Ready, kept live.
 * `userId` null (signed out) returns an empty list and opens nothing.
 */
export function useActiveOrders(userId: string | null, initial?: OrderListItem[]) {
  const query = useQuery({
    queryKey: activeOrdersQueryKey(userId ?? "signed-out"),
    queryFn: fetchActiveOrders,
    enabled: Boolean(userId),
    initialData: initial,
    staleTime: 0,
    refetchOnMount: initial ? false : true,
  });
  useInvalidateOn(userId ? `user_id=eq.${userId}` : null, activeOrdersQueryKey(userId ?? "signed-out"));
  return userId ? (query.data ?? []) : [];
}
