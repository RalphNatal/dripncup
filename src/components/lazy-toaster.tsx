"use client";

/**
 * Sonner's Toaster, mounted when the browser is first idle after loading or
 * when a toast is wanted (src/lib/toast.ts), so it costs no first paint.
 * The staff screen and admin, which import Sonner's `toast` directly, get it
 * the same way: on idle, long before anyone taps a button.
 */
import { useEffect, useState, type ComponentType } from "react";

import { requestToaster, toasterMounted, useToasterWanted } from "@/lib/toast";

type ToasterComponent = ComponentType<{ position: "top-center"; richColors: boolean; closeButton: boolean }>;

function Ready() {
  // Effects run child first, siblings in order: the Toaster before us has subscribed by now.
  useEffect(() => {
    toasterMounted();
  }, []);
  return null;
}

export function LazyToaster() {
  const wanted = useToasterWanted();
  const [Toaster, setToaster] = useState<ToasterComponent | null>(null);

  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((callback: () => void) => window.setTimeout(callback, 1500));
    idle(() => void requestToaster(), { timeout: 4000 });
  }, []);

  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    void import("@/components/ui/sonner").then((module) => {
      if (!cancelled) setToaster(() => module.Toaster);
    });
    return () => {
      cancelled = true;
    };
  }, [wanted]);

  if (!Toaster) return null;
  return (
    <>
      <Toaster position="top-center" richColors closeButton />
      <Ready />
    </>
  );
}

/** For the staff screen and admin, which toast straight away: mount the Toaster now, not on idle. */
export function ToasterNow() {
  useEffect(() => {
    void requestToaster();
  }, []);
  return null;
}
