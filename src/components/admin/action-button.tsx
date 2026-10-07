"use client";

/**
 * A button that runs one admin Server Action, then refreshes the page.
 *
 *   - plain: runs at once
 *   - `confirm`: asks first, saying exactly what will happen
 *   - `note`: asks for a note (required, 3+ characters) and passes it on
 *
 * The action returns `{ ok, message }`; the message is shown as a toast.
 */
import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

import { ConfirmDialog } from "./confirm-dialog";
import { textareaClass } from "./form-layout";

type Result = { ok: boolean; message?: string };

export const buttonClass = {
  primary: "bg-brand-teal-deep text-white hover:bg-brand-teal-deep/90",
  outline: "border bg-card hover:bg-muted",
  danger: "border border-destructive/40 bg-card text-destructive hover:bg-destructive/10",
  dangerSolid: "bg-destructive text-white hover:bg-destructive/90",
} as const;

export function ActionButton({
  action,
  children,
  variant = "outline",
  size = "md",
  confirm,
  note,
  successMessage,
  className,
  disabled,
  testId,
}: {
  action: (note: string) => Promise<Result>;
  children: ReactNode;
  variant?: keyof typeof buttonClass;
  size?: "sm" | "md";
  confirm?: { title: string; description: ReactNode; confirmLabel: string; tone?: "primary" | "danger" };
  note?: { title: string; description?: ReactNode; label: string; placeholder?: string; confirmLabel: string; tone?: "primary" | "danger" };
  successMessage?: string;
  className?: string;
  disabled?: boolean;
  testId?: string;
}) {
  const router = useRouter();
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [text, setText] = useState("");

  async function run(value: string): Promise<boolean> {
    setRunning(true);
    try {
      const result = await action(value);
      if (!result.ok) {
        toast.error(result.message ?? "That didn't work. Please try again.");
        return false;
      }
      toast.success(result.message ?? successMessage ?? "Done.");
      setText("");
      startTransition(() => router.refresh());
      return true;
    } catch {
      toast.error("That didn't work. Please try again.");
      return false;
    } finally {
      setRunning(false);
    }
  }

  const busy = running || pending;
  const classes = cn(
    "focus-ring inline-flex items-center justify-center gap-2 rounded-full font-semibold disabled:opacity-60",
    size === "sm" ? "min-h-11 px-3 text-sm" : "min-h-11 px-5 text-sm",
    buttonClass[variant],
    className,
  );
  const button = (
    <button type="button" className={classes} disabled={disabled || busy} data-testid={testId} onClick={confirm || note ? undefined : () => void run("")}>
      {busy && !confirm && !note ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );

  if (note) {
    const trimmed = text.trim();
    return (
      <ConfirmDialog
        trigger={button}
        title={note.title}
        description={note.description}
        confirmLabel={note.confirmLabel}
        tone={note.tone}
        confirmDisabled={trimmed.length < 3}
        onConfirm={() => run(trimmed)}
      >
        <div className="space-y-1.5">
          <label htmlFor={`${id}-note`} className="block text-sm font-semibold">
            {note.label}
          </label>
          <textarea
            id={`${id}-note`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={1000}
            placeholder={note.placeholder}
            className={textareaClass}
            aria-describedby={`${id}-note-hint`}
          />
          <p id={`${id}-note-hint`} className="text-xs text-muted-foreground">
            Required. Saved with the change, so others can see why.
          </p>
        </div>
      </ConfirmDialog>
    );
  }
  if (confirm) {
    return (
      <ConfirmDialog trigger={button} title={confirm.title} description={confirm.description} confirmLabel={confirm.confirmLabel} tone={confirm.tone} onConfirm={() => run("")} />
    );
  }
  return button;
}
