"use client";

/**
 * One setting: its label and help, the input for its type, Save, and its
 * recent history from the audit log. Each setting saves on its own, so a
 * mistake in one never blocks another and the log reads one change at a time.
 */
import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { updateSettingAction } from "@/lib/settings/actions";
import { formatSettingValue, type SettingDefinition } from "@/lib/settings/registry";
import { cn } from "@/lib/utils";

import { inputClass, textareaClass } from "./form-layout";
import { StatusPill } from "./status-pill";
import { useSyncedDraft } from "./use-synced-draft";

export interface SettingHistoryEntry {
  id: number;
  at: string;
  who: string;
  from: unknown;
  to: unknown;
}

function suffix(def: SettingDefinition): string | null {
  switch (def.type) {
    case "percent":
      return "%";
    case "minutes":
    case "hours":
    case "days":
    case "seconds":
      return def.type;
    case "number":
      return def.unit ?? null;
    default:
      return null;
  }
}

export function SettingField({
  def,
  initial,
  history,
  confirmed,
  version,
}: {
  def: SettingDefinition;
  initial: string | boolean;
  /** The saved row's updated_at: a new one means the saved value changed. */
  version: string;
  history: SettingHistoryEntry[];
  confirmed: boolean;
}) {
  const id = useId();
  const router = useRouter();
  const { value, setValue, dirty, markSaved } = useSyncedDraft(initial, version);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();
  const unit = suffix(def);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await updateSettingAction(def.key, value);
      if (!result.ok) {
        setError(result.message);
        toast.error(result.message);
        return;
      }
      markSaved(value);
      toast.success(result.message ?? "Saved.");
      startTransition(() => router.refresh());
    } finally {
      setSaving(false);
    }
  }

  const described = [`${id}-help`, error ? `${id}-error` : null].filter(Boolean).join(" ");
  const common = {
    id: `${id}-input`,
    name: def.key,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": described,
  } as const;

  let input: React.ReactNode;
  if (def.type === "boolean") {
    input = (
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input
          {...common}
          type="checkbox"
          checked={value === true}
          onChange={(e) => setValue(e.target.checked)}
          className="size-5 accent-[var(--brand-teal-deep)]"
        />
        <span>{value === true ? def.onLabel : def.offLabel}</span>
      </label>
    );
  } else if ((def.type === "text" && def.multiline) || (def.type === "list" && def.item === "zip")) {
    input = (
      <textarea
        {...common}
        value={String(value)}
        onChange={(e) => setValue(e.target.value)}
        rows={def.type === "list" ? 4 : 3}
        className={textareaClass}
      />
    );
  } else {
    input = (
      <div className="flex items-center gap-2">
        {def.type === "money" ? <span className="text-sm font-semibold text-muted-foreground" aria-hidden="true">$</span> : null}
        <input
          {...common}
          type={def.type === "email" ? "email" : "text"}
          inputMode={["money", "percent", "minutes", "hours", "days", "seconds", "number"].includes(def.type) ? "decimal" : undefined}
          value={String(value)}
          onChange={(e) => setValue(e.target.value)}
          className={cn(inputClass, ["money", "percent", "minutes", "hours", "days", "seconds", "number"].includes(def.type) && "max-w-40")}
        />
        {unit ? <span className="text-sm text-muted-foreground">{unit}</span> : null}
      </div>
    );
  }

  return (
    <form onSubmit={save} id={def.key} className="scroll-mt-24 space-y-2 border-t py-5 first:border-t-0 first:pt-0" data-testid={`setting-${def.key}`} noValidate>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-input`} className="font-semibold">
          {def.label}
        </label>
        {def.needsConfirmation ? (
          confirmed ? <StatusPill tone="good">Confirmed</StatusPill> : <StatusPill tone="warn">Needs owner confirmation</StatusPill>
        ) : null}
      </div>
      <p id={`${id}-help`} className="text-sm text-muted-foreground">
        {def.help}
      </p>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 basis-64">{input}</div>
        <button
          type="submit"
          disabled={!dirty || saving}
          className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-teal-deep px-5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
          Save
        </button>
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
      {history.length ? (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-brand-teal-deep">Change history</summary>
          <ul className="mt-2 space-y-1 text-muted-foreground" data-testid="setting-history">
            {history.map((h) => (
              <li key={h.id}>
                {h.at} · {h.who}: {formatSettingValue(def, h.from)} → <span className="text-foreground">{formatSettingValue(def, h.to)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </form>
  );
}
