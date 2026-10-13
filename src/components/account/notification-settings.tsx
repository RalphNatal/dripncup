"use client";

/**
 * Account → Notifications: "order ready" notifications on this device (on,
 * off, or why not), and every other device they are on, each removable.
 * The email version of the same alert stays in the preferences form below.
 */
import { Bell, BellOff, BellRing, Share, Smartphone, SquarePlus } from "lucide-react";
import { useState, useTransition } from "react";

import { removePushDeviceAction } from "@/lib/push/actions";
import { usePushNotifications } from "@/lib/push/client";
import type { PushDevice } from "@/lib/push/subscriptions";
import { formatCafeDate } from "@/lib/time";

const BUTTON =
  "focus-ring inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60";

export function NotificationSettings({ devices }: { devices: PushDevice[] }) {
  const push = usePushNotifications();
  const [message, setMessage] = useState<string | null>(null);
  const [removing, startRemoving] = useTransition();
  const [removed, setRemoved] = useState<string[]>([]);
  const others = devices.filter((device) => device.endpointHash !== push.endpointHash && !removed.includes(device.id));

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-card p-4">
        <p className="font-semibold">Order ready on this device</p>
        {push.status === "loading" ? (
          <p className="mt-1 text-sm text-muted-foreground">Checking this browser…</p>
        ) : push.status === "on" ? (
          <>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-success">
              <BellRing className="size-4 shrink-0" aria-hidden="true" />
              On. We&apos;ll tell you when your order is ready, even with the app closed.
            </p>
            <button
              type="button"
              disabled={push.busy}
              onClick={() => void push.turnOff()}
              className={`${BUTTON} mt-3 border bg-card hover:bg-muted`}
            >
              <BellOff className="size-4" aria-hidden="true" />
              Turn off
            </button>
          </>
        ) : push.status === "off" ? (
          <>
            <p className="mt-1 text-sm text-muted-foreground">Get a notification the moment your order is ready for pickup.</p>
            <button
              type="button"
              disabled={push.busy}
              onClick={async () => {
                setMessage(null);
                const result = await push.turnOn();
                if (!result.ok && result.message) setMessage(result.message);
              }}
              className={`${BUTTON} mt-3 bg-brand-teal-deep text-white hover:bg-brand-teal-deep/90`}
            >
              <Bell className="size-4" aria-hidden="true" />
              Turn on notifications
            </button>
          </>
        ) : push.status === "denied" ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Notifications are blocked for this site. To turn them on, allow notifications for Drincup in your browser&apos;s
            site settings, then come back here.
          </p>
        ) : push.status === "needs-install" ? (
          <div className="mt-1 text-sm text-muted-foreground" data-testid="push-needs-install">
            <p>On iPhone and iPad, notifications work once Drincup is on your Home Screen (iOS 16.4 or later):</p>
            <ol className="mt-2 space-y-1.5 text-foreground">
              <li className="flex items-center gap-2">
                <Share className="size-4 shrink-0 text-brand-teal-deep" aria-hidden="true" />
                Tap <strong>Share</strong> in Safari, then <strong>Add to Home Screen</strong>.
              </li>
              <li className="flex items-center gap-2">
                <SquarePlus className="size-4 shrink-0 text-brand-teal-deep" aria-hidden="true" />
                Open Drincup from your Home Screen and turn notifications on here.
              </li>
            </ol>
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            This browser can&apos;t show notifications. You&apos;ll still see and hear the Ready alert while the order page is
            open, and you can get an email instead (below).
          </p>
        )}
        {message ? (
          <p role="status" className="mt-2 text-sm font-semibold text-destructive">
            {message}
          </p>
        ) : null}
      </div>

      {others.length > 0 ? (
        <div>
          <p className="text-sm font-semibold">Also on</p>
          <ul className="mt-2 divide-y rounded-2xl border bg-card" data-testid="push-devices">
            {others.map((device) => (
              <li key={device.id} className="flex items-center gap-3 px-4 py-2">
                <Smartphone className="size-5 shrink-0 text-brand-teal-deep" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{device.label}</p>
                  <p className="text-xs text-muted-foreground">Added {formatCafeDate(new Date(device.addedAt))}</p>
                </div>
                <button
                  type="button"
                  disabled={removing}
                  onClick={() =>
                    startRemoving(async () => {
                      const result = await removePushDeviceAction(device.id);
                      if (result.ok) setRemoved((ids) => [...ids, device.id]);
                    })
                  }
                  className={`${BUTTON} border bg-card px-4 hover:bg-muted`}
                  aria-label={`Remove ${device.label}, added ${formatCafeDate(new Date(device.addedAt))}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
