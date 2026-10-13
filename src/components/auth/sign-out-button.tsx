"use client";

import { LogOut } from "lucide-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";
import { clearCachedPages } from "@/lib/pwa/client";

/** This browser's push subscription, if it has one; never waits more than a moment. */
function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) return Promise.resolve(null);
  const lookup = navigator.serviceWorker
    .getRegistration()
    .then((registration) => registration?.pushManager?.getSubscription() ?? null)
    .catch(() => null);
  const giveUp = new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 1500));
  return Promise.race([lookup, giveUp]);
}

/**
 * A real form post, so signing out works even before JavaScript loads.
 * With JavaScript it also tells the server this device's push endpoint
 * (deleted with the session, so the next person here never gets the last
 * person's "order ready"), and drops pages kept for offline, which may greet
 * the person signing out. The endpoint is looked up when the button is
 * pressed, not when the page loads, so a quick sign-out can't go without it.
 */
export function SignOutButton() {
  const lookedUp = useRef(false);

  return (
    <form
      action={signOut}
      onSubmit={(event) => {
        const form = event.currentTarget;
        if (!lookedUp.current) {
          // Find this device's endpoint first, then send the form for real.
          event.preventDefault();
          lookedUp.current = true;
          void currentPushSubscription().then((subscription) => {
            const field = form.elements.namedItem("pushEndpoint");
            if (subscription && field instanceof HTMLInputElement) field.value = subscription.endpoint;
            form.requestSubmit();
          });
          return;
        }
        void clearCachedPages();
        // The server deletes the row; this stops the browser's side too.
        void currentPushSubscription().then((subscription) => subscription?.unsubscribe());
      }}
    >
      <input type="hidden" name="pushEndpoint" defaultValue="" />
      <Button type="submit" variant="outline" className="h-11 w-full rounded-full text-base">
        <LogOut aria-hidden="true" />
        Sign out
      </Button>
    </form>
  );
}
