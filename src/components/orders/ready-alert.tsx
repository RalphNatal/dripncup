"use client";

/**
 * "Your order is ready" -- everything the tracker does when an order turns
 * Ready while the customer is watching:
 *
 *   - a prominent banner (also shown whenever the order *is* ready)
 *   - a chime, but only once the customer has tapped or typed on the page:
 *     browsers block audio that starts without a user gesture. A mute toggle
 *     is remembered on this device
 *   - a vibration on phones that support it
 *   - the tab title changes while the order is ready
 *   - a browser notification, if the customer allowed them from the in-page
 *     prompt (never asked for on page load)
 *
 * The chime, vibration and notification fire on the *change* to Ready, not
 * when a page opens on an order that was already ready.
 */
import { Bell, BellOff, BellRing, PartyPopper, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";

import type { OrderStatus } from "@/lib/order-status";

// ---------------------------------------------------------------------------
// Sound: a short three-note chime, synthesised so there is no audio file.
// ---------------------------------------------------------------------------

let audio: AudioContext | null = null;

/** Creates (or wakes) the audio context inside a user gesture, which is what unlocks sound. */
function unlockAudio() {
  try {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    audio ??= new Context();
    if (audio.state === "suspended") void audio.resume();
  } catch {
    audio = null;
  }
}

function playChime() {
  if (!audio || audio.state !== "running") return;
  const start = audio.currentTime + 0.05;
  [880, 1108.73, 1318.51].forEach((frequency, index) => {
    const at = start + index * 0.16;
    const oscillator = audio!.createOscillator();
    const gain = audio!.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
    oscillator.connect(gain).connect(audio!.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.5);
  });
}

// ---------------------------------------------------------------------------
// Mute, remembered on the device.
// ---------------------------------------------------------------------------

const MUTE_KEY = "drincup:ready-sound-muted";
const muteListeners = new Set<() => void>();

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeMuted(muted: boolean) {
  try {
    if (muted) localStorage.setItem(MUTE_KEY, "1");
    else localStorage.removeItem(MUTE_KEY);
  } catch {
    // Private mode: the toggle still works for this visit.
  }
  mutedFallback = muted;
  muteListeners.forEach((l) => l());
}

let mutedFallback = false;

function useMuted(): [boolean, (muted: boolean) => void] {
  const muted = useSyncExternalStore(
    (onChange) => {
      muteListeners.add(onChange);
      return () => muteListeners.delete(onChange);
    },
    () => readMuted() || mutedFallback,
    () => false,
  );
  return [muted, writeMuted];
}

// ---------------------------------------------------------------------------
// Notifications.
// ---------------------------------------------------------------------------

type Permission = NotificationPermission | "unsupported";

function notificationPermission(): Permission {
  return typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported";
}

const permissionListeners = new Set<() => void>();

/** Read after hydration (the server cannot know); updates once the customer answers the prompt. */
function usePermission(): Permission {
  return useSyncExternalStore(
    (onChange) => {
      permissionListeners.add(onChange);
      return () => permissionListeners.delete(onChange);
    },
    notificationPermission,
    () => "unsupported",
  );
}

function askPermission() {
  const done = () => permissionListeners.forEach((l) => l());
  void Notification.requestPermission().then(done, done);
}

function showNotification(title: string, body: string, tag: string) {
  if (notificationPermission() !== "granted") return;
  try {
    new Notification(title, { body, tag, icon: "/favicon.ico" });
  } catch {
    // Chrome on Android only allows notifications from a service worker
    // (arrives with the PWA in Phase 10); the banner and chime still run.
  }
}

// ---------------------------------------------------------------------------

export function ReadyAlert({
  status,
  orderId,
  orderNumber,
  locationName,
}: {
  status: OrderStatus;
  orderId: string;
  orderNumber: string;
  locationName: string;
}) {
  const [muted, setMuted] = useMuted();
  const mutedRef = useRef(muted);
  const previous = useRef<OrderStatus | null>(null);
  const permission = usePermission();
  const ready = status === "ready";
  const message = `Your order is ready at ${locationName}! 🎉`;

  // Any tap or key press on the page counts as the gesture that allows sound.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  // The moment it turns Ready.
  useEffect(() => {
    const before = previous.current;
    previous.current = status;
    if (before === null || before === status || status !== "ready") return;
    if (!mutedRef.current) playChime();
    try {
      navigator.vibrate?.([200, 100, 200]);
    } catch {
      // Not allowed without a gesture on some browsers; nothing to do.
    }
    showNotification("Your order is ready! 🎉", `${orderNumber} is waiting for you at ${locationName}.`, `order-ready-${orderId}`);
  }, [status, orderId, orderNumber, locationName]);

  // The tab title says so while it is ready.
  useEffect(() => {
    if (!ready) return;
    const original = document.title;
    document.title = `🎉 Ready! ${orderNumber} · Drincup Cafe`;
    return () => {
      document.title = original;
    };
  }, [ready, orderNumber]);

  const active = status === "placed" || status === "accepted" || status === "preparing";

  return (
    <div className="space-y-3">
      {ready ? (
        <div
          role="status"
          aria-live="assertive"
          data-testid="ready-banner"
          className="flex items-center gap-3 rounded-3xl bg-brand-magenta-deep px-5 py-4 text-white shadow-lg"
        >
          <PartyPopper className="size-8 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-lg leading-tight font-extrabold">{message}</p>
            <p className="text-sm text-white/90">Grab it from the pickup shelf. Mahalo!</p>
          </div>
        </div>
      ) : null}

      {active || ready ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => {
              unlockAudio();
              setMuted(!muted);
            }}
            aria-pressed={!muted}
            className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full border bg-card px-4 font-semibold hover:bg-muted"
          >
            {muted ? <VolumeX className="size-4" aria-hidden="true" /> : <Volume2 className="size-4" aria-hidden="true" />}
            {muted ? "Ready sound off" : "Ready sound on"}
          </button>

          {active && permission === "default" ? (
            <button
              type="button"
              onClick={() => {
                unlockAudio();
                askPermission();
              }}
              className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full border border-brand-teal-deep/40 bg-brand-teal-soft px-4 font-semibold text-brand-teal-deep hover:bg-brand-teal-soft/70"
            >
              <Bell className="size-4" aria-hidden="true" />
              Notify me when it&apos;s ready
            </button>
          ) : null}
          {active && permission === "granted" ? (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <BellRing className="size-4" aria-hidden="true" />
              We&apos;ll send a notification when it&apos;s ready.
            </span>
          ) : null}
          {active && permission === "denied" ? (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <BellOff className="size-4" aria-hidden="true" />
              Notifications are blocked in your browser settings.
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
