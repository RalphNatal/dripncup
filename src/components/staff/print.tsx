"use client";

/**
 * Printed tickets and cup labels.
 *
 * The print view is rendered into a portal on <body> only while printing.
 * The `staff-printing` class on <body> hides everything else (globals.css),
 * and an @page rule sized from the staff settings is added for that one
 * print: the label size for cup labels; for an 80 mm receipt printer just
 * zero margins and an 80 mm-wide column, because the roll length is the
 * printer's business.
 *
 * Browsers always show a print dialog unless Chrome runs with
 * --kiosk-printing on the counter device (README, "Kiosk printing").
 */
import { useEffect } from "react";
import { createPortal } from "react-dom";

import { ALLERGENS } from "@/components/menu/dietary";
import { formatCafeTimeOfDay } from "@/lib/time";

import type { StaffOrder } from "@/lib/staff/queue";
import { cupLabels, itemAllergens, shortSize, ticketLines, type CatalogMeta } from "@/lib/staff/ticket";
import type { StaffSettings } from "@/lib/staff/types";

export type PrintJob = { kind: "ticket" | "labels"; order: StaffOrder };

function pickupText(order: StaffOrder): string {
  return order.pickupType === "scheduled" && order.scheduledFor
    ? `Pickup ${formatCafeTimeOfDay(new Date(order.scheduledFor))}`
    : "ASAP";
}

export function PrintView({
  job,
  meta,
  settings,
  locationName,
  onDone,
}: {
  job: PrintJob | null;
  meta: CatalogMeta;
  settings: StaffSettings;
  locationName: string;
  onDone: () => void;
}) {
  useEffect(() => {
    if (!job) return;
    const style = document.createElement("style");
    style.dataset.staffPrint = "";
    style.textContent =
      job.kind === "labels"
        ? `@page { size: ${settings.labelWidthMm}mm ${settings.labelHeightMm}mm; margin: 0; }`
        : `@page { margin: 0; }`;
    document.head.appendChild(style);
    document.body.classList.add("staff-printing");

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      style.remove();
      document.body.classList.remove("staff-printing");
      window.removeEventListener("afterprint", finish);
      onDone();
    };
    window.addEventListener("afterprint", finish);
    // Let the portal paint before the dialog snapshots the page.
    const frame = requestAnimationFrame(() => {
      window.print();
      // Most browsers block in print(); some return at once and fire afterprint later.
      setTimeout(finish, 1000);
    });
    return () => {
      cancelAnimationFrame(frame);
      finish();
    };
  }, [job, settings.labelWidthMm, settings.labelHeightMm, onDone]);

  if (!job || typeof document === "undefined") return null;

  return createPortal(
    <div id="staff-print" data-kind={job.kind} data-testid="print-view">
      {job.kind === "ticket" ? (
        <PrintedTicket order={job.order} meta={meta} widthMm={settings.receiptWidthMm} locationName={locationName} />
      ) : (
        <PrintedLabels order={job.order} meta={meta} widthMm={settings.labelWidthMm} heightMm={settings.labelHeightMm} />
      )}
    </div>,
    document.body,
  );
}

function PrintedTicket({
  order,
  meta,
  widthMm,
  locationName,
}: {
  order: StaffOrder;
  meta: CatalogMeta;
  widthMm: number;
  locationName: string;
}) {
  return (
    <div className="print-ticket" style={{ width: `${widthMm}mm` }}>
      <p className="print-small">{locationName}</p>
      <p className="print-number">{order.orderNumber}</p>
      <p className="print-cup">{order.cupName ?? "No name"}</p>
      <p className="print-strong">{pickupText(order)}</p>
      {order.placedAt ? <p className="print-small">Placed {formatCafeTimeOfDay(new Date(order.placedAt))}</p> : null}
      {order.notes ? <p className="print-note">ORDER NOTE: {order.notes}</p> : null}
      <hr />
      {order.items.map((item) => {
        const allergens = itemAllergens(item, meta);
        return (
          <div key={item.id} className="print-item">
            <p className="print-strong">
              {item.quantity} × {item.name}
              {item.sizeName ? ` · ${item.sizeName}` : ""}
            </p>
            {ticketLines(item.modifiers, meta.groups).map((line, index) => (
              <p key={index} className="print-line">
                – {line}
              </p>
            ))}
            {item.specialInstructions ? <p className="print-note">NOTE: {item.specialInstructions}</p> : null}
            {allergens.length ? (
              <p className="print-line">ALLERGENS: {allergens.map((a) => ALLERGENS[a].label).join(", ")}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function PrintedLabels({
  order,
  meta,
  widthMm,
  heightMm,
}: {
  order: StaffOrder;
  meta: CatalogMeta;
  widthMm: number;
  heightMm: number;
}) {
  return (
    <>
      {cupLabels(order.items).map(({ item, index, total }) => (
        <div
          key={`${item.id}-${index}`}
          className="print-label"
          data-testid="cup-label"
          style={{ width: `${widthMm}mm`, height: `${heightMm}mm` }}
        >
          <div className="print-label-head">
            <span className="print-label-cup">{order.cupName ?? "—"}</span>
            <span>
              {order.orderNumber.slice(-4)} · {index}/{total}
            </span>
          </div>
          <p className="print-strong">
            {item.name}
            {item.sizeName ? ` (${shortSize(item.sizeName)})` : ""}
          </p>
          <p className="print-line">{ticketLines(item.modifiers, meta.groups).join(" · ")}</p>
          {item.specialInstructions ? <p className="print-line">* {item.specialInstructions}</p> : null}
        </div>
      ))}
    </>
  );
}
