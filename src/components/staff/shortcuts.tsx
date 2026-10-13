"use client";

/**
 * Keyboard shortcuts for staff on a laptop.
 *
 *   ← ↑ → ↓      move between tickets (within a column, then across)
 *   Enter        the focused ticket's forward action (Accept, Start, Ready, Picked up)
 *   Space or O   open the focused ticket's details
 *   A            acknowledge new orders
 *   Esc          close the details panel
 *   ?            this list
 *
 * Nothing fires while typing in a field, with a modifier held, or while a
 * dialog, sheet or menu is open (they have their own keys). The arrows move
 * real focus onto the ticket (the article, tabIndex -1), so the focus ring
 * shows where you are and a screen reader reads the order; Enter and Space
 * only act on a ticket that has focus itself, never on a button inside it,
 * which keeps its own native keys.
 */
import { useEffect, useRef } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

const TICKET = "[data-testid=ticket]";

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** A Radix dialog, sheet, popover or menu is open (the docked detail panel is not one of them). */
function overlayOpen(): boolean {
  return Boolean(document.querySelector('[role="dialog"][data-state="open"], [role="menu"][data-state="open"]'));
}

function visible(element: HTMLElement): boolean {
  return element.offsetParent !== null || element.getClientRects().length > 0;
}

/** The ticket lists on screen, left to right, each with its tickets top to bottom. */
function ticketColumns(): { id: string; tickets: HTMLElement[] }[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-testid^=column-]"))
    .filter(visible)
    .map((column) => ({ id: column.dataset.testid!, tickets: Array.from(column.querySelectorAll<HTMLElement>(TICKET)) }));
}

function focusTicket(ticket: HTMLElement | undefined) {
  if (!ticket) return;
  ticket.focus({ preventScroll: true });
  ticket.scrollIntoView({ block: "nearest" });
}

function move(key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight") {
  const all = ticketColumns();
  const columns = all.map((column) => column.tickets);
  const current = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(TICKET) ?? null;
  const c = current ? columns.findIndex((tickets) => tickets.includes(current)) : -1;
  if (c < 0) {
    // Nothing focused yet: start at the top of New, else the first column with tickets.
    const start = all.find((column) => column.id === "column-new" && column.tickets.length) ?? all.find((column) => column.tickets.length);
    focusTicket(start?.tickets[0]);
    return;
  }
  const r = columns[c].indexOf(current!);
  if (key === "ArrowUp") return focusTicket(columns[c][Math.max(0, r - 1)]);
  if (key === "ArrowDown") return focusTicket(columns[c][Math.min(columns[c].length - 1, r + 1)]);
  const step = key === "ArrowLeft" ? -1 : 1;
  for (let next = c + step; next >= 0 && next < columns.length; next += step) {
    if (columns[next].length) return focusTicket(columns[next][Math.min(r, columns[next].length - 1)]);
  }
}

export function useStaffShortcuts({
  enabled,
  onAcknowledge,
  onEscape,
  onHelp,
}: {
  enabled: boolean;
  onAcknowledge: () => void;
  /** Escape outside a dialog: close the docked detail panel. */
  onEscape: () => void;
  onHelp: () => void;
}) {
  const handlers = useRef({ onAcknowledge, onEscape, onHelp });
  useEffect(() => {
    handlers.current = { onAcknowledge, onEscape, onHelp };
  });

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTyping(event.target) || overlayOpen()) return;
      const active = document.activeElement as HTMLElement | null;
      const onTicket = active?.matches(TICKET) ? active : null;

      switch (event.key) {
        case "ArrowUp":
        case "ArrowDown":
        case "ArrowLeft":
        case "ArrowRight":
          // Not inside the details panel, which scrolls with them.
          if (active?.closest("[data-testid=ticket-detail]")) return;
          event.preventDefault();
          move(event.key);
          return;
        case "Enter":
          if (!onTicket) return;
          event.preventDefault();
          onTicket.querySelector<HTMLButtonElement>("button[data-action]:not(:disabled)")?.click();
          return;
        case " ":
        case "o":
        case "O":
          if (!onTicket) return;
          event.preventDefault();
          onTicket.querySelector<HTMLButtonElement>("button[aria-label^='Open order']")?.click();
          return;
        case "a":
        case "A":
          event.preventDefault();
          handlers.current.onAcknowledge();
          return;
        case "Escape":
          handlers.current.onEscape();
          return;
        case "?":
          event.preventDefault();
          handlers.current.onHelp();
          return;
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}

const SHORTCUTS: [string[], string][] = [
  [["←", "↑", "→", "↓"], "Move between tickets"],
  [["Enter"], "The ticket's main action: Accept, Start, Ready or Picked up"],
  [["Space", "O"], "Open the ticket's details"],
  [["A"], "Acknowledge new orders"],
  [["Esc"], "Close the details panel"],
  [["?"], "Show this list"],
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg [&_[data-slot=dialog-close]]:size-14 [&_[data-slot=dialog-close]_svg]:size-7">
        <DialogTitle className="font-heading text-3xl font-extrabold">Keyboard shortcuts</DialogTitle>
        <DialogDescription className="text-base">They work whenever you&apos;re not typing in a box.</DialogDescription>
        <dl className="divide-y divide-border" data-testid="shortcut-list">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={what} className="flex items-center gap-4 py-2.5">
              <dt className="flex w-36 shrink-0 flex-wrap gap-1">
                {keys.map((key) => (
                  <kbd key={key} className="min-w-8 rounded-md border border-b-2 bg-muted px-2 py-0.5 text-center font-mono text-base font-bold">
                    {key}
                  </kbd>
                ))}
              </dt>
              <dd className="text-base">{what}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
