"use client";

/**
 * Editing one piece of site content: a text area for the long pieces, a
 * field for contact details, the uploader for the logo. Saves on its own.
 */
import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { saveContentAction } from "@/lib/content/actions";
import type { ContentItem } from "@/lib/content/registry";

import { inputClass, textareaClass } from "./form-layout";
import { ImageUploadField } from "./image-upload-field";
import { StatusPill } from "./status-pill";

export function ContentEditor({ item, initial, confirmed, supabaseUrl }: { item: ContentItem; initial: string; confirmed: boolean; supabaseUrl: string }) {
  const id = useId();
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();

  async function save(next = value) {
    setSaving(true);
    setError(null);
    try {
      const result = await saveContentAction(item.key, next);
      if (!result.ok) {
        setError(result.message);
        toast.error(result.message);
        return;
      }
      toast.success(result.message ?? "Saved.");
      startTransition(() => router.refresh());
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id={item.key} aria-labelledby={`${id}-label`} className="scroll-mt-20 space-y-2 rounded-3xl border bg-card p-5 md:p-6" data-testid={`content-${item.key}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={`${id}-label`} className="text-lg font-bold">
          <label htmlFor={`${id}-input`}>{item.label}</label>
        </h2>
        {confirmed ? <StatusPill tone="good">Confirmed</StatusPill> : <StatusPill tone="warn">Needs owner confirmation</StatusPill>}
      </div>
      <p id={`${id}-help`} className="text-sm text-muted-foreground">
        {item.help} Shown on {item.shownOn}.
      </p>
      {item.kind === "image" ? (
        <ImageUploadField
          label="Logo image"
          bucket="brand-assets"
          supabaseUrl={supabaseUrl}
          value={value || null}
          onChange={(path) => {
            setValue(path ?? "");
            void save(path ?? "");
          }}
          aspect="aspect-[4/1]"
          previewAlt="The cafe's logo"
        />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="space-y-2"
          noValidate
        >
          {item.kind === "long" ? (
            <textarea
              id={`${id}-input`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              rows={item.maxLength > 2000 ? 12 : 4}
              maxLength={item.maxLength}
              aria-describedby={`${id}-help`}
              aria-invalid={error ? true : undefined}
              className={textareaClass}
            />
          ) : (
            <input
              id={`${id}-input`}
              type={item.kind === "email" ? "email" : item.kind === "phone" ? "tel" : "url"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={item.maxLength}
              aria-describedby={`${id}-help`}
              aria-invalid={error ? true : undefined}
              className={inputClass}
            />
          )}
          {error ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={saving || value === initial}
            className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-teal-deep px-5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
            Save {item.label.toLowerCase()}
          </button>
        </form>
      )}
    </section>
  );
}
