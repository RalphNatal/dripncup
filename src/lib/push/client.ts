"use client";

/**
 * Push notifications for this device: whether they can be turned on here,
 * whether they are, and the two buttons' actions. Opt-in only: nothing
 * asks for permission until the customer taps a button.
 *
 * Where it works (ARCHITECTURE.md, "Push notifications"):
 *   Chrome, Edge, Firefox, Samsung Internet on Android and desktop: yes, in
 *     the browser or installed
 *   iPhone and iPad: only once added to the Home Screen, on iOS 16.4 or
 *     later ("needs-install" until then)
 *   Safari on a Mac (16+): yes
 */
import { useCallback, useEffect, useState } from "react";

import { clientEnv } from "@/lib/env";
import { isIos, isStandalone, registerServiceWorker, serviceWorkerEnabled } from "@/lib/pwa/client";

import { removePushSubscriptionAction, savePushSubscriptionAction } from "./actions";

export type PushStatus =
  /** Not known yet (first render, or still asking the browser). */
  | "loading"
  /** No Web Push in this browser, or the server has no keys. */
  | "unsupported"
  /** iPhone/iPad in the browser: add to Home Screen first. */
  | "needs-install"
  /** The customer (or the browser) said no; only the browser settings can undo it. */
  | "denied"
  | "off"
  | "on";

/** The VAPID public key, URL-safe base64 → the bytes PushManager wants. */
function applicationServerKey(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export async function endpointHash(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function pushAvailable(): boolean {
  return (
    Boolean(clientEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY) &&
    serviceWorkerEnabled() &&
    "PushManager" in window &&
    "Notification" in window
  );
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await registerServiceWorker();
  if (!registration) return null;
  return registration.pushManager.getSubscription().catch(() => null);
}

/** This browser's push state, read from the browser (never asks for anything). */
async function readPushState(): Promise<{ status: PushStatus; hash: string | null }> {
  if (!pushAvailable()) return { status: isIos() && !isStandalone() ? "needs-install" : "unsupported", hash: null };
  if (Notification.permission === "denied") return { status: "denied", hash: null };
  const subscription = await currentSubscription();
  return {
    status: subscription && Notification.permission === "granted" ? "on" : "off",
    hash: subscription ? await endpointHash(subscription.endpoint) : null,
  };
}

export function usePushNotifications() {
  const [status, setStatus] = useState<PushStatus>("loading");
  const [hash, setHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const state = await readPushState();
    setStatus(state.status);
    setHash(state.hash);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void readPushState().then((state) => {
      if (cancelled) return;
      setStatus(state.status);
      setHash(state.hash);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Must run inside a tap: asks for permission, subscribes, tells the server. */
  const turnOn = useCallback(async (): Promise<{ ok: boolean; message?: string }> => {
    if (!pushAvailable()) return { ok: false, message: "This browser can't show notifications." };
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        return { ok: false, message: permission === "denied" ? "Notifications are blocked in your browser settings." : undefined };
      }
      const registration = await registerServiceWorker();
      if (!registration) return { ok: false, message: "This browser can't show notifications." };
      await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(clientEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
        }));
      const saved = await savePushSubscriptionAction(subscription.toJSON());
      if (!saved.ok) {
        await subscription.unsubscribe().catch(() => undefined);
        setStatus("off");
        return { ok: false, message: saved.message };
      }
      setHash(await endpointHash(subscription.endpoint));
      setStatus("on");
      return { ok: true };
    } catch {
      setStatus("off");
      return { ok: false, message: "We couldn't turn on notifications. Please try again." };
    } finally {
      setBusy(false);
    }
  }, []);

  const turnOff = useCallback(async () => {
    setBusy(true);
    try {
      const subscription = await currentSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe().catch(() => undefined);
        await removePushSubscriptionAction(endpoint);
      }
      setHash(null);
      setStatus("off");
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, busy, endpointHash: hash, turnOn, turnOff, refresh };
}
