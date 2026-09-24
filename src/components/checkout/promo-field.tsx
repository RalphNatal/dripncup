"use client";

/**
 * One promo code per order. The code is only ever judged on the server; this
 * shows what it said. Apart from a minimum spend, every refusal reads the
 * same, so the field cannot be used to learn which codes exist.
 */
import { LoaderCircle, Tag, X } from "lucide-react";
import { useId, useState } from "react";

import { formatCents } from "@/lib/money";

export function PromoField({
  applied,
  pending,
  message,
  onApply,
  onRemove,
}: {
  /** The code on the order and its discount, once the server accepted it. */
  applied: { code: string; discountCents: number } | null;
  /** A code waiting for the server's answer. */
  pending: string | null;
  message: string | null;
  onApply: (code: string) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const [text, setText] = useState("");

  if (applied) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-brand-teal-deep/40 bg-brand-teal-soft px-4 py-3">
        <Tag className="size-4 shrink-0 text-brand-teal-deep" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-bold">{applied.code}</span> applied ·{" "}
          <span className="tabular font-semibold">−{formatCents(applied.discountCents)}</span>
        </p>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove code ${applied.code}`}
          className="focus-ring inline-flex size-11 items-center justify-center rounded-full hover:bg-white/60"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const code = text.trim();
        if (code) onApply(code);
      }}
    >
      <label htmlFor={id} className="text-sm font-semibold">
        Promo code
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id={id}
          value={text}
          onChange={(event) => setText(event.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={40}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? `${id}-message` : undefined}
          className="focus-ring h-11 min-w-0 flex-1 rounded-xl border bg-card px-3 text-base uppercase placeholder:normal-case"
          placeholder="Enter a code"
        />
        <button
          type="submit"
          disabled={pending !== null || text.trim() === ""}
          className="focus-ring inline-flex h-11 min-w-20 items-center justify-center rounded-xl border bg-card px-4 text-sm font-semibold hover:bg-muted disabled:opacity-50"
        >
          {pending !== null ? <LoaderCircle className="size-4 animate-spin" aria-label="Checking code" /> : "Apply"}
        </button>
      </div>
      {message ? (
        <p id={`${id}-message`} role="alert" className="mt-2 text-sm font-semibold text-destructive">
          {message}
        </p>
      ) : null}
    </form>
  );
}
