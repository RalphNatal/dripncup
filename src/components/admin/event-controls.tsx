"use client";

/** Publish / unpublish an event, and duplicate it to another date. */
import { Copy, Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { inputClass } from "@/components/admin/form-layout";
import { duplicateEventAction, setEventPublishedAction } from "@/lib/events/admin-actions";

export function EventControls({ eventId, isPublished, menuCount, suggestedDate }: { eventId: string; isPublished: boolean; menuCount: number; suggestedDate: string }) {
  const id = useId();
  const router = useRouter();
  const [date, setDate] = useState(suggestedDate);

  async function publish(next: boolean) {
    const result = await setEventPublishedAction(eventId, next);
    if (!result.ok) {
      toast.error(result.message);
      return false;
    }
    toast.success(result.message);
    router.refresh();
    return true;
  }

  async function duplicate() {
    const result = await duplicateEventAction(eventId, date);
    if (!result.ok) {
      toast.error(result.message);
      return false;
    }
    toast.success("Copied. Check the details, then publish the copy.");
    router.push(`/admin/events/${result.id}`);
    return true;
  }

  return (
    <div className="flex flex-wrap gap-2">
      <ConfirmDialog
        trigger={
          <button type="button" className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold hover:bg-muted">
            <Copy className="size-4" aria-hidden="true" />
            Duplicate to another date
          </button>
        }
        title="Duplicate to another date"
        description="Same times, place, menu and staff on the new date. The copy starts unpublished."
        confirmLabel="Duplicate"
        pendingLabel="Copying…"
        confirmDisabled={!/^\d{4}-\d{2}-\d{2}$/.test(date)}
        onConfirm={duplicate}
      >
        <label htmlFor={`${id}-date`} className="block text-sm font-semibold">
          New date (Honolulu)
        </label>
        <input id={`${id}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
      </ConfirmDialog>

      {isPublished ? (
        <ConfirmDialog
          trigger={
            <button type="button" className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full border border-destructive/40 px-4 text-sm font-semibold text-destructive hover:bg-destructive/10">
              <EyeOff className="size-4" aria-hidden="true" />
              Unpublish
            </button>
          }
          title="Unpublish this event?"
          description="Customers will no longer see it on Events, Home or the pickup location switcher. Orders already placed are not affected."
          confirmLabel="Unpublish"
          tone="danger"
          onConfirm={() => publish(false)}
        />
      ) : (
        <ConfirmDialog
          trigger={
            <button type="button" className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-teal-deep px-4 text-sm font-semibold text-white hover:bg-brand-teal-deep/90">
              <Eye className="size-4" aria-hidden="true" />
              Publish
            </button>
          }
          title="Publish this event?"
          description={
            menuCount === 0
              ? "Add at least one menu item and save before publishing."
              : "Customers will see it on Events and Home, and can pre-order while it's running."
          }
          confirmLabel="Publish"
          confirmDisabled={menuCount === 0}
          onConfirm={() => publish(true)}
        />
      )}
    </div>
  );
}
