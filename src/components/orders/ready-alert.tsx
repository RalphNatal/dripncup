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
 *   - a notification, if the customer turned them on with the in-page
 *     button (never asked for on page load). Where Web Push works, that
 *     button subscribes this device, so "ready" arrives even with the app
 *     closed; the page's own notification and the push share a tag, so
 *     only one shows. Shown through the service worker, which Android
 *     Chrome requires.
 *
 * The chime, vibration and notification fire on the *change* to Ready, not
 * when a page opens on an order that was already ready.
 */
import { Bell, BellOff, BellRing, PartyPopper, Smartphone, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { OrderStatus } from "@/lib/order-status";
import { usePushNotifications } from "@/lib/push/client";
import { orderReadyTag } from "@/lib/push/payload";

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

async function showNotification(title: string, body: string, tag: string, url: string) {
  if (notificationPermission() !== "granted") return;
  const options: NotificationOptions = { body, tag, icon: "/icons/icon-192.png", badge: "/icons/badge-96.png", data: { url } };
  try {
    // Chrome on Android only allows notifications from a service worker.
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.showNotification(title, options);
      return;
    }
  } catch {
    // Fall through to a page notification.
  }
  try {
    new Notification(title, options);
  } catch {
    // Not allowed here; the banner and chime still run.
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
    void showNotification("Your order is ready! 🎉", `${orderNumber} is waiting for you at ${locationName}. Mahalo!`, orderReadyTag(orderId), `/orders/${orderId}`);
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
          className="relative flex items-center gap-3 rounded-3xl bg-brand-magenta-deep px-5 py-4 text-white shadow-lg"
        >
          <Confetti />
          <PartyPopper className="size-8 shrink-0 motion-safe:animate-cart-bump" aria-hidden="true" />
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

          {active ? <NotifyMe /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Brand-coloured pieces that burst out of the Ready banner once (motion-safe only). */
const CONFETTI = Array.from({ length: 14 }, (_, i) => {
  const angle = (i / 14) * Math.PI * 2;
  const reach = 70 + (i % 3) * 22;
  return {
    dx: `${Math.round(Math.cos(angle) * reach * 1.6)}px`,
    dy: `${Math.round(Math.sin(angle) * reach)}px`,
    turn: `${(i % 2 ? 1 : -1) * (180 + i * 25)}deg`,
    color: ["var(--brand-teal)", "var(--brand-pink)", "#ffffff", "var(--brand-sand)"][i % 4],
    round: i % 3 === 0,
  };
});

function Confetti() {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 hidden overflow-visible motion-safe:block">
      {CONFETTI.map((piece, i) => (
        <span
          key={i}
          className={`absolute top-1/2 left-1/2 size-2.5 animate-confetti ${piece.round ? "rounded-full" : "rounded-[2px]"}`}
          style={{ backgroundColor: piece.color, ["--dx" as string]: piece.dx, ["--dy" as string]: piece.dy, ["--turn" as string]: piece.turn, animationDelay: `${(i % 4) * 40}ms` }}
        />
      ))}
    </span>
  );
}

const NOTIFY_BUTTON =
  "focus-ring inline-flex min-h-11 items-center gap-2 rounded-full border border-brand-teal-deep/40 bg-brand-teal-soft px-4 font-semibold text-brand-teal-deep hover:bg-brand-teal-soft/70 disabled:opacity-60";

function Note({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0">
      {icon}
      <span>{children}</span>
    </span>
  );
}

/**
 * "Notify me when it's ready". With Web Push this device is subscribed, so
 * the notification arrives even if the app is closed; without it (or before
 * the server has keys) the page asks for plain notifications, which work
 * while this page is open.
 */
function NotifyMe() {
  const push = usePushNotifications();
  const permission = usePermission();
  const [message, setMessage] = useState<string | null>(null);

  if (push.status === "loading") return null;
  if (push.status === "on") {
    return <Note icon={<BellRing aria-hidden="true" />}>We&apos;ll notify you when it&apos;s ready, even if you close the app.</Note>;
  }
  if (push.status === "denied" || (push.status === "unsupported" && permission === "denied")) {
    return <Note icon={<BellOff aria-hidden="true" />}>Notifications are blocked in your browser settings.</Note>;
  }
  if (push.status === "needs-install") {
    return (
      <Note icon={<Smartphone aria-hidden="true" />}>
        On iPhone, add Drincup to your Home Screen (iOS 16.4 or later) to get notified when it&apos;s ready.
      </Note>
    );
  }
  if (push.status === "off") {
    return (
      <>
        <button
          type="button"
          disabled={push.busy}
          onClick={async () => {
            unlockAudio();
            setMessage(null);
            const result = await push.turnOn();
            if (!result.ok && result.message) setMessage(result.message);
          }}
          className={NOTIFY_BUTTON}
        >
          <Bell className="size-4" aria-hidden="true" />
          Notify me when it&apos;s ready
        </button>
        {message ? (
          <span role="status" className="text-sm font-semibold text-destructive">
            {message}
          </span>
        ) : null}
      </>
    );
  }
  // No Web Push here: plain notifications while the page is open.
  if (permission === "default") {
    return (
      <button
        type="button"
        onClick={() => {
          unlockAudio();
          askPermission();
        }}
        className={NOTIFY_BUTTON}
      >
        <Bell className="size-4" aria-hidden="true" />
        Notify me when it&apos;s ready
      </button>
    );
  }
  if (permission === "granted") {
    return <Note icon={<BellRing aria-hidden="true" />}>We&apos;ll send a notification when it&apos;s ready (keep this page open).</Note>;
  }
  return null;
}
