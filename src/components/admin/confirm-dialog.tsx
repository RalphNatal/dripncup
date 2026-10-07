"use client";

/**
 * "Are you sure?" for admin actions. The confirm button runs `onConfirm`
 * (usually a Server Action) and stays disabled until it finishes; the dialog
 * closes when it returns true. `children` can hold extra inputs (a reason, a
 * refund amount) the action reads.
 */
import { LoaderCircle } from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  pendingLabel = "Working…",
  tone = "primary",
  onConfirm,
  confirmDisabled,
  children,
}: {
  trigger: ReactNode;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  tone?: "primary" | "danger";
  /** Resolve true to close the dialog. */
  onConfirm: () => Promise<boolean>;
  confirmDisabled?: boolean;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function confirm() {
    setPending(true);
    try {
      if (await onConfirm()) setOpen(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="rounded-3xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl font-extrabold">{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children ? <div className="space-y-3">{children}</div> : null}
        <DialogFooter className="gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={pending}
            className="focus-ring min-h-11 rounded-full border px-5 text-sm font-semibold hover:bg-muted"
          >
            Keep it
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={pending || confirmDisabled}
            className={cn(
              "focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold text-white disabled:opacity-60",
              tone === "danger" ? "bg-destructive hover:bg-destructive/90" : "bg-brand-teal-deep hover:bg-brand-teal-deep/90",
            )}
          >
            {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
            {pending ? pendingLabel : confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
