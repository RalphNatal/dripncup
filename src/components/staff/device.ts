"use client";

/**
 * The counter device: sound, the screen wake lock, fullscreen, and a clock
 * that ticks. Everything here is per-device and remembered in localStorage
 * (volume, mute, fullscreen preference), never in the database.
 */
import { useEffect, useState, useSyncExternalStore } from "react";

// ---------------------------------------------------------------------------
// A clock for elapsed timers and scheduled orders falling due.
// ---------------------------------------------------------------------------

let tick: Date | null = null;
let ticker: ReturnType<typeof setInterval> | undefined;
const clockListeners = new Set<() => void>();

function subscribeClock(onChange: () => void) {
  clockListeners.add(onChange);
  ticker ??= setInterval(() => {
    tick = new Date();
    clockListeners.forEach((l) => l());
  }, 1000);
  return () => {
    clockListeners.delete(onChange);
    if (clockListeners.size === 0) {
      clearInterval(ticker);
      ticker = undefined;
    }
  };
}

/**
 * The current time, ticking once a second (one shared timer). On the server
 * render, and while hydrating, it is `serverNow` (null if not given): the
 * time the page was rendered, so the first render in the browser matches the
 * HTML. Pass a stable Date (state or memo), not a fresh one each render.
 */
export function useNow(serverNow: Date | null = null): Date | null {
  return useSyncExternalStore(
    subscribeClock,
    () => (tick ??= new Date()),
    () => serverNow,
  );
}

// ---------------------------------------------------------------------------
// Sound. Synthesised, so there is no file to load or cache. Browsers only
// allow audio after a tap, which is what "Start shift" is for.
// ---------------------------------------------------------------------------

let audio: AudioContext | null = null;

export function unlockAudio(): boolean {
  try {
    const Context =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return false;
    audio ??= new Context();
    if (audio.state === "suspended") void audio.resume();
    return true;
  } catch {
    audio = null;
    return false;
  }
}

/** A bright two-tone "ding-ding", repeated twice: hard to miss over a steam wand. */
export function playNewOrderChime(volume: number) {
  if (!audio || audio.state !== "running" || volume <= 0) return;
  const peak = Math.min(1, Math.max(0, volume)) * 0.6;
  const start = audio.currentTime + 0.05;
  [0, 0.7].forEach((offset) => {
    [1046.5, 1568].forEach((frequency, index) => {
      const at = start + offset + index * 0.18;
      const oscillator = audio!.createOscillator();
      const gain = audio!.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(peak, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
      oscillator.connect(gain).connect(audio!.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.55);
    });
  });
}

// ---------------------------------------------------------------------------
// Volume and mute, remembered on this device.
// ---------------------------------------------------------------------------

const VOLUME_KEY = "drincup:staff:volume";
const MUTED_KEY = "drincup:staff:muted";
const soundListeners = new Set<() => void>();
let fallback = { volume: 0.8, muted: false };

function readStored<T>(key: string, parse: (raw: string) => T | null, otherwise: T): T {
  try {
    const raw = localStorage.getItem(key);
    const value = raw === null ? null : parse(raw);
    return value ?? otherwise;
  } catch {
    return otherwise;
  }
}

function soundSnapshot() {
  const volume = readStored(VOLUME_KEY, (raw) => {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
  }, fallback.volume);
  const muted = readStored(MUTED_KEY, (raw) => raw === "1", fallback.muted);
  return `${volume}|${muted ? 1 : 0}`;
}

function writeSound(next: { volume?: number; muted?: boolean }) {
  try {
    if (next.volume !== undefined) localStorage.setItem(VOLUME_KEY, String(next.volume));
    if (next.muted !== undefined) localStorage.setItem(MUTED_KEY, next.muted ? "1" : "0");
  } catch {
    // Private mode: still works for this visit.
  }
  fallback = { ...fallback, ...next };
  soundListeners.forEach((l) => l());
}

export function useSoundSettings() {
  const snapshot = useSyncExternalStore(
    (onChange) => {
      soundListeners.add(onChange);
      return () => soundListeners.delete(onChange);
    },
    soundSnapshot,
    () => "0.8|0",
  );
  const [volume, muted] = snapshot.split("|");
  return {
    volume: Number(volume),
    muted: muted === "1",
    setVolume: (value: number) => writeSound({ volume: Math.min(1, Math.max(0, value)), muted: false }),
    setMuted: (value: boolean) => writeSound({ muted: value }),
  };
}

// ---------------------------------------------------------------------------
// Screen wake lock: keep the tablet awake while the shift runs. The browser
// drops the lock whenever the tab is hidden, so it is asked for again each
// time the tab becomes visible.
// ---------------------------------------------------------------------------

export type WakeLockState = "idle" | "active" | "unsupported" | "failed";

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
}

export function useWakeLock(enabled: boolean): WakeLockState {
  const [state, setState] = useState<WakeLockState>("idle");

  useEffect(() => {
    if (!enabled) return;
    let sentinel: WakeLockSentinelLike | null = null;
    let stopped = false;

    const request = async () => {
      const wakeLock = (navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> } })
        .wakeLock;
      if (!wakeLock) {
        setState("unsupported");
        return;
      }
      if (sentinel && !sentinel.released) return;
      try {
        const lock = await wakeLock.request("screen");
        if (stopped) {
          void lock.release().catch(() => undefined);
          return;
        }
        sentinel = lock;
        setState("active");
        lock.addEventListener("release", () => {
          if (sentinel === lock && !stopped) setState("idle");
        });
      } catch {
        // Refused (battery saver, not visible, not allowed): tried again on the next visibility change.
        setState("failed");
      }
    };

    void request();
    const onVisible = () => {
      if (document.visibilityState === "visible") void request();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, [enabled]);

  return state;
}

// ---------------------------------------------------------------------------
// Fullscreen.
// ---------------------------------------------------------------------------

const FULLSCREEN_KEY = "drincup:staff:fullscreen";

export function rememberedFullscreen(): boolean {
  return readStored(FULLSCREEN_KEY, (raw) => raw === "1", false);
}

export function rememberFullscreen(value: boolean) {
  try {
    localStorage.setItem(FULLSCREEN_KEY, value ? "1" : "0");
  } catch {
    // Ignore.
  }
}

/** Must run inside a tap. Quietly does nothing where fullscreen is unavailable (iPhone Safari). */
export function enterFullscreen() {
  const element = document.documentElement;
  if (document.fullscreenElement || !element.requestFullscreen) return;
  void element.requestFullscreen({ navigationUI: "hide" }).catch(() => undefined);
}

export function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  else enterFullscreen();
}

/** Online according to the browser, kept current. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("online", onChange);
      window.addEventListener("offline", onChange);
      return () => {
        window.removeEventListener("online", onChange);
        window.removeEventListener("offline", onChange);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

const noSubscription = () => () => undefined;

/** The remembered "go fullscreen" choice; false on the server render. */
export function useRememberedFullscreen(): boolean {
  return useSyncExternalStore(noSubscription, rememberedFullscreen, () => false);
}

/** Whether a CSS media query matches, kept current. False on the server render. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
