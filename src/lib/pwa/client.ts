"use client";

/**
 * The browser side of the PWA: registering the service worker, noticing a
 * new version, and catching the install prompt. Small external stores read
 * with useSyncExternalStore, so any component can ask "is an update ready?"
 * and the server render (which can't know) always says no.
 *
 * Updates: a new worker installs in the background and waits. When one is
 * waiting -- or another tab has already switched to it -- `updateReady` turns
 * true and the page offers "Refresh"; the switch happens only when the
 * customer taps it (applyUpdate). Checkout calls checkForUpdate() on arrival
 * and won't take a payment from an old version (src/components/checkout).
 */
import { useSyncExternalStore } from "react";

export const SERVICE_WORKER_URL = "/serwist/sw.js";
/** How often an open page asks the server for a new worker. */
const UPDATE_INTERVAL_MS = 30 * 60_000;
/** At most this often from route changes and tab switches. */
const UPDATE_THROTTLE_MS = 60_000;

interface ServiceWorkerState {
  /** A worker controls (or is installing for) this page. */
  registered: boolean;
  /** A newer version is installed and waiting for this page to refresh. */
  updateReady: boolean;
}

const SERVER_STATE: ServiceWorkerState = { registered: false, updateReady: false };
let state: ServiceWorkerState = SERVER_STATE;
let registration: ServiceWorkerRegistration | null = null;
let lastCheck = 0;
let reloadOnTakeover = false;
const listeners = new Set<() => void>();

function setState(next: Partial<ServiceWorkerState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useServiceWorker(): ServiceWorkerState {
  return useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
}

/** Production builds register the worker; `npm run dev` only with NEXT_PUBLIC_SW_IN_DEV=true. */
export function serviceWorkerEnabled(): boolean {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
  return process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_SW_IN_DEV === "true";
}

/** Registers once per page load. Safe to call repeatedly. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (registration) return registration;
  if (!serviceWorkerEnabled()) return null;
  try {
    registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/", updateViaCache: "none" });
  } catch {
    return null;
  }
  const current = registration;
  setState({ registered: true });

  const markIfWaiting = () => {
    // No controller = the very first install, which takes over by itself.
    if (current.waiting && navigator.serviceWorker.controller) setState({ updateReady: true });
  };
  markIfWaiting();
  current.addEventListener("updatefound", () => {
    const installing = current.installing;
    installing?.addEventListener("statechange", () => {
      if (installing.state === "installed") markIfWaiting();
    });
  });

  let hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadOnTakeover) {
      reloadOnTakeover = false;
      window.location.reload();
      return;
    }
    // Another tab switched to the new version; this page's code is still the old one.
    if (hadController) setState({ updateReady: true });
    hadController = true;
  });

  window.setInterval(() => void checkForUpdate(true), UPDATE_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkForUpdate();
  });
  return current;
}

/** Asks the server whether a new worker (a new deploy) exists. */
export async function checkForUpdate(force = false): Promise<void> {
  if (!registration || !navigator.onLine) return;
  if (!force && Date.now() - lastCheck < UPDATE_THROTTLE_MS) return;
  lastCheck = Date.now();
  await registration.update().catch(() => undefined);
}

/** "Refresh": the waiting worker takes over, then the page reloads on the new version. */
export function applyUpdate() {
  const waiting = registration?.waiting;
  if (!waiting) {
    window.location.reload();
    return;
  }
  reloadOnTakeover = true;
  waiting.postMessage({ type: "SKIP_WAITING" });
  // If the worker never takes over (it was replaced meanwhile), reload anyway.
  window.setTimeout(() => window.location.reload(), 3000);
}

/** Drops pages kept for offline (they may greet the person signing out). */
export async function clearCachedPages(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const worker = navigator.serviceWorker.controller ?? (await navigator.serviceWorker.getRegistration())?.active;
  worker?.postMessage({ type: "CLEAR_PAGES" });
}

// ---------------------------------------------------------------------------
// Install prompt (Chrome, Edge, Samsung Internet; not Safari or Firefox).
// ---------------------------------------------------------------------------

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredInstall: BeforeInstallPromptEvent | null = null;
const installListeners = new Set<() => void>();
const notifyInstall = () => installListeners.forEach((listener) => listener());

/**
 * Holds on to the browser's install prompt instead of letting it show on a
 * first visit; the app offers it after a successful order
 * (src/components/pwa/install-prompt.tsx).
 */
export function captureInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstall = event as BeforeInstallPromptEvent;
    notifyInstall();
  });
  window.addEventListener("appinstalled", () => {
    deferredInstall = null;
    rememberInstallPrompt("installed");
    notifyInstall();
  });
}

/** True while the browser has an install prompt we can show. */
export function useCanPromptInstall(): boolean {
  return useSyncExternalStore(
    (listener) => {
      installListeners.add(listener);
      return () => installListeners.delete(listener);
    },
    () => deferredInstall !== null,
    () => false,
  );
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = deferredInstall;
  if (!event) return "unavailable";
  deferredInstall = null;
  notifyInstall();
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome;
}

const INSTALL_KEY = "drincup:install-prompt";

/** "dismissed" or "installed" once the customer has answered; never asked again. */
export function rememberInstallPrompt(answer: "dismissed" | "installed") {
  try {
    localStorage.setItem(INSTALL_KEY, answer);
  } catch {
    // Private mode: it just shows again next time.
  }
}

export function installPromptAnswered(): boolean {
  try {
    return localStorage.getItem(INSTALL_KEY) !== null;
  } catch {
    return false;
  }
}

/** Running as the installed app (home screen), on any platform. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** iPhone or iPad, in any browser (iPadOS reports itself as a Mac with touch). */
export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
