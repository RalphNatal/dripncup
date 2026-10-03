"use client";

/**
 * The new-order alert.
 *
 * An order in the New column that nobody on this device has acknowledged
 * yet (by opening it, or with "Acknowledge") raises the alert: a chime the
 * moment it arrives, then again every `repeatSeconds` until every new order
 * is acknowledged. Scheduled orders join the New column when they fall due,
 * so they alert then, not when they were placed.
 *
 * Acknowledgements are remembered on this device per location, so reloading
 * the page does not ring again for orders already seen. Accepting an order
 * moves it out of New, which ends its alert too.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { playNewOrderChime } from "./device";

const MAX_REMEMBERED = 400;

function storageKey(locationId: string) {
  return `drincup:staff:acknowledged:${locationId}`;
}

function load(locationId: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(locationId));
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function save(locationId: string, ids: Set<string>) {
  try {
    localStorage.setItem(storageKey(locationId), JSON.stringify([...ids].slice(-MAX_REMEMBERED)));
  } catch {
    // Private mode: acknowledgements last for this visit.
  }
}

export function useNewOrderAlerts({
  locationId,
  newOrderIds,
  enabled,
  repeatSeconds,
  volume,
  muted,
}: {
  locationId: string;
  /** Ids in the New column right now, in display order. */
  newOrderIds: readonly string[];
  /** False until the shift has started (sound is locked before that). */
  enabled: boolean;
  repeatSeconds: number;
  volume: number;
  muted: boolean;
}) {
  // Read once on mount. The dashboard mounts only after the Start shift tap,
  // never on the server, and is keyed by location, so this is never stale.
  const [acknowledged, setAcknowledged] = useState<Set<string>>(() =>
    typeof window === "undefined" ? new Set() : load(locationId),
  );
  const [alertCount, setAlertCount] = useState(0);
  const sound = useRef({ volume, muted });
  const heard = useRef(new Set<string>());

  useEffect(() => {
    sound.current = { volume, muted };
  }, [volume, muted]);

  const unacknowledged = useMemo(
    () => newOrderIds.filter((id) => !acknowledged.has(id)),
    [acknowledged, newOrderIds],
  );
  const unacknowledgedKey = unacknowledged.join(",");
  const alerting = enabled && unacknowledged.length > 0;

  const ring = useCallback(() => {
    if (!sound.current.muted) playNewOrderChime(sound.current.volume);
    setAlertCount((n) => n + 1);
  }, []);

  // Ring at once for an order not rung for yet.
  useEffect(() => {
    if (!enabled || !unacknowledgedKey) return;
    const fresh = unacknowledgedKey.split(",").filter((id) => !heard.current.has(id));
    fresh.forEach((id) => heard.current.add(id));
    if (fresh.length > 0) ring();
  }, [enabled, unacknowledgedKey, ring]);

  // Then keep ringing until acknowledged.
  useEffect(() => {
    if (!alerting) return;
    const timer = setInterval(ring, Math.max(5, repeatSeconds) * 1000);
    return () => clearInterval(timer);
  }, [alerting, repeatSeconds, ring]);

  const acknowledge = useCallback(
    (ids: readonly string[]) => {
      setAcknowledged((current) => {
        const next = new Set(current);
        ids.forEach((id) => next.add(id));
        save(locationId, next);
        return next;
      });
    },
    [locationId],
  );

  return {
    unacknowledged: useMemo(() => new Set(unacknowledged), [unacknowledged]),
    alerting,
    /** How many times the alert has fired this visit (shown to tests, and handy when debugging a silent tablet). */
    alertCount,
    acknowledge,
    acknowledgeAll: useCallback(() => acknowledge(newOrderIds), [acknowledge, newOrderIds]),
  };
}
