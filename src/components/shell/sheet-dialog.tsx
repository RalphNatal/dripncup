"use client";

/**
 * One dialog that is a bottom sheet on phones and a centred dialog from the
 * `md` breakpoint up. Pure CSS, so the server and client render the same
 * markup at every width -- no JS media query, no hydration flicker.
 *
 * Built on Radix Dialog, which supplies the accessibility: focus is trapped
 * inside while open, Escape closes, the page behind is inert to screen
 * readers, and focus returns to whatever opened it.
 */
import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useState, type ComponentProps, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Focus handling for a dialog opened by navigating to a route rather than by
 * a `Dialog.Trigger` (the product sheet). Radix returns focus to its trigger
 * on close; with no trigger, focus would fall to <body>. This remembers the
 * element that had focus when the dialog mounted -- the product card link --
 * and puts focus back there.
 *
 * On open it focuses the dialog itself rather than its first control, so the
 * sheet starts at the top (not scrolled to a radio button) and a screen
 * reader announces the dialog's title first.
 */
export function useRouteDialogFocus() {
  const [opener] = useState(() =>
    typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null),
  );

  return {
    onOpenAutoFocus: (event: Event) => {
      event.preventDefault();
      (event.target as HTMLElement | null)?.focus({ preventScroll: true });
    },
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    },
  };
}

export const SheetDialog = DialogPrimitive.Root;
export const SheetDialogTrigger = DialogPrimitive.Trigger;
export const SheetDialogTitle = DialogPrimitive.Title;
export const SheetDialogDescription = DialogPrimitive.Description;
export const SheetDialogClose = DialogPrimitive.Close;

export function SheetDialogContent({
  children,
  className,
  closeLabel = "Close",
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { children: ReactNode; closeLabel?: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-brand-ink/45 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 flex flex-col overflow-hidden bg-background text-foreground shadow-2xl outline-none",
          // Phone: a sheet rising from the bottom edge.
          "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-[1.75rem]",
          "data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-10 data-[state=open]:fade-in-0",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          // Desktop: a centred dialog.
          "md:inset-auto md:top-1/2 md:left-1/2 md:max-h-[85vh] md:w-[min(42rem,calc(100vw-4rem))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[1.75rem]",
          className,
        )}
        {...props}
      >
        {/* Grab handle: a visual cue that this is a sheet. Decorative. */}
        <div aria-hidden="true" className="mx-auto mt-2.5 h-1.5 w-12 shrink-0 rounded-full bg-foreground/15 md:hidden" />
        {children}
        <DialogPrimitive.Close
          className="focus-ring absolute top-3 right-3 z-10 inline-flex size-11 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm ring-1 ring-foreground/10 hover:bg-muted"
          aria-label={closeLabel}
        >
          <XIcon className="size-5" aria-hidden="true" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
