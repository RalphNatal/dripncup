"use client";

/**
 * A field's draft that follows the saved value. When the page refreshes
 * with a new saved version (`version`, e.g. the row's updated_at), the draft
 * takes the new value -- unless the admin has typed something since, which
 * is kept. (Keying the component by version would remount it and wipe
 * whatever was typed while the refresh was on its way.)
 */
import { useState } from "react";

export function useSyncedDraft<T>(initial: T, version: string) {
  const [value, setValue] = useState(initial);
  const [seen, setSeen] = useState({ version, initial });
  const [saved, setSaved] = useState<{ value: T } | null>(null);

  if (version !== seen.version) {
    setSeen({ version, initial });
    if (Object.is(value, seen.initial) || (saved && Object.is(value, saved.value))) setValue(initial);
    setSaved(null);
  }

  return {
    value,
    setValue,
    dirty: !Object.is(value, initial),
    /** Call after a successful save with the value that was saved. */
    markSaved: (savedValue: T) => setSaved({ value: savedValue }),
  };
}
