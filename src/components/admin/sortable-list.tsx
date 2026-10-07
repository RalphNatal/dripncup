"use client";

/**
 * Reorder a list by dragging, or with the Move up / Move down buttons (the
 * keyboard and touch way; native drag and drop is mouse-only). Each change
 * is saved straight away through `onSave`, and announced to screen readers.
 */
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

export interface SortableItem {
  id: string;
  label: string;
  /** Extra content on the row (status, links, buttons). */
  content?: ReactNode;
  muted?: boolean;
}

export function SortableList({
  label,
  items,
  onSave,
  testId,
}: {
  label: string;
  items: SortableItem[];
  onSave: (ids: string[]) => Promise<{ ok: boolean; message?: string }>;
  testId?: string;
}) {
  const router = useRouter();
  const [order, setOrder] = useState(items);
  const [dragging, setDragging] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [saving, setSaving] = useState(false);

  // A fresh list from the server (after a save elsewhere) replaces ours,
  // adjusted while rendering rather than in an effect.
  const signature = items.map((i) => `${i.id}:${i.label}:${i.muted}`).join("|");
  const [seen, setSeen] = useState(signature);
  if (seen !== signature) {
    setSeen(signature);
    setOrder(items);
  }

  async function commit(next: SortableItem[], moved: SortableItem) {
    const previous = order;
    setOrder(next);
    setSaving(true);
    try {
      const result = await onSave(next.map((i) => i.id));
      if (!result.ok) {
        setOrder(previous);
        toast.error(result.message ?? "Couldn't save the new order.");
        return;
      }
      setAnnouncement(`${moved.label} moved to position ${next.indexOf(moved) + 1} of ${next.length}. Saved.`);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  function move(index: number, by: -1 | 1) {
    const target = index + by;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    void commit(next, item);
  }

  function drop(targetId: string) {
    if (!dragging || dragging === targetId) return;
    const next = [...order];
    const from = next.findIndex((i) => i.id === dragging);
    const to = next.findIndex((i) => i.id === targetId);
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setDragging(null);
    void commit(next, item);
  }

  return (
    <div>
      <ol className="divide-y rounded-2xl border bg-card" aria-label={label} data-testid={testId} aria-busy={saving}>
        {order.map((item, index) => (
          <li
            key={item.id}
            draggable
            onDragStart={(e) => {
              setDragging(item.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => drop(item.id)}
            onDragEnd={() => setDragging(null)}
            className={cn("flex flex-wrap items-center gap-2 px-3 py-2", dragging === item.id && "opacity-50")}
            data-testid="sortable-item"
          >
            <GripVertical className="hidden size-5 cursor-grab text-muted-foreground sm:block" aria-hidden="true" />
            <span className={cn("min-w-0 flex-1 text-sm font-semibold", item.muted && "text-muted-foreground")}>{item.label}</span>
            {item.content}
            <span className="flex gap-1">
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0 || saving}
                className="focus-ring inline-flex size-11 items-center justify-center rounded-lg border disabled:opacity-40"
                aria-label={`Move ${item.label} up`}
              >
                <ArrowUp className="size-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === order.length - 1 || saving}
                className="focus-ring inline-flex size-11 items-center justify-center rounded-lg border disabled:opacity-40"
                aria-label={`Move ${item.label} down`}
              >
                <ArrowDown className="size-4" aria-hidden="true" />
              </button>
            </span>
          </li>
        ))}
      </ol>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
