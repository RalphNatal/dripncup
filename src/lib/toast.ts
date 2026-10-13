"use client";

/**
 * Toasts for the customer app, with Sonner loaded only when it is wanted:
 * when the browser is idle after the page loads, or the moment a toast is
 * shown, whichever comes first. Nothing in a first paint needs it (~20 KB of
 * JavaScript). Same API as Sonner's `toast` for what we use.
 *
 * <LazyToaster /> (src/components/lazy-toaster.tsx) mounts Sonner's Toaster
 * when asked; a toast waits until that Toaster is listening, so one shown in
 * the first moments is never lost. The staff screen and admin import Sonner
 * directly.
 */
import { useSyncExternalStore } from "react";

type Sonner = typeof import("sonner");
type Message = Parameters<Sonner["toast"]["success"]>[0];
type Options = Parameters<Sonner["toast"]["success"]>[1];

let sonner: Promise<Sonner> | null = null;
export function loadSonner(): Promise<Sonner> {
  sonner ??= import("sonner");
  return sonner;
}

// Whether the Toaster should be mounted, and a promise for when it is.
let wanted = false;
const listeners = new Set<() => void>();
let markReady: () => void = () => undefined;
const ready = new Promise<void>((resolve) => {
  markReady = resolve;
});

export function requestToaster(): Promise<void> {
  if (!wanted) {
    wanted = true;
    listeners.forEach((listener) => listener());
  }
  return ready;
}

/** Called by the Toaster once it is subscribed to Sonner's store. */
export function toasterMounted() {
  markReady();
}

export function useToasterWanted(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => wanted,
    () => false,
  );
}

function show(kind: "message" | "success" | "error" | "info", message: Message, options?: Options) {
  void Promise.all([loadSonner(), requestToaster()]).then(([{ toast: sonnerToast }]) => {
    if (kind === "message") sonnerToast(message, options);
    else sonnerToast[kind](message, options);
  });
}

export const toast = Object.assign((message: Message, options?: Options) => show("message", message, options), {
  success: (message: Message, options?: Options) => show("success", message, options),
  error: (message: Message, options?: Options) => show("error", message, options),
  info: (message: Message, options?: Options) => show("info", message, options),
});
