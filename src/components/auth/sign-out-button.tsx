"use client";

import { LogOut } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";
import { clearCachedPages } from "@/lib/pwa/client";

/**
 * A real form post, so signing out works even before JavaScript loads.
 * With JavaScript it also tells the server this device's push endpoint
 * (deleted with the session, so the next person here never gets the last
 * person's "order ready"), and drops pages kept for offline, which may greet
 * the person signing out.
 */
export function SignOutButton() {
  const [pushEndpoint, setPushEndpoint] = useState("");

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;
    void navigator.serviceWorker
      .getRegistration()
      .then((registration) => registration?.pushManager?.getSubscription())
      .then((subscription) => {
        if (!cancelled && subscription) setPushEndpoint(subscription.endpoint);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <form
      action={signOut}
      onSubmit={() => {
        void clearCachedPages();
        // The server deletes the row; this stops the browser's side too.
        void navigator.serviceWorker
          ?.getRegistration()
          .then((registration) => registration?.pushManager?.getSubscription())
          .then((subscription) => subscription?.unsubscribe())
          .catch(() => undefined);
      }}
    >
      <input type="hidden" name="pushEndpoint" value={pushEndpoint} />
      <Button type="submit" variant="outline" className="h-11 w-full rounded-full text-base">
        <LogOut aria-hidden="true" />
        Sign out
      </Button>
    </form>
  );
}
