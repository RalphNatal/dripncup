"use client";

/**
 * The Reports charts. One series each, in the brand teal (the mark's colour
 * clears 3:1 on the card surface in light and dark); text stays in text
 * colours. Every value a chart shows is also in a table on the page, so the
 * hover / focus tooltips add, never gate.
 *
 *   SalesColumns  net sales per Honolulu day; one column per day, columns
 *                 capped at 24px with a 2px gap and a rounded top
 *   PeakHeatmap   orders by weekday x hour, a single-hue sequential scale
 *                 (lighter = fewer), with a scale legend
 */
import { useId, useState } from "react";

import { formatCents } from "@/lib/money";
import { WEEKDAYS, hourLabel, type SalesDay } from "@/lib/reports/definitions";
import { cn } from "@/lib/utils";

const VIZ_STYLE = `
.viz { --viz-mark: #0e7c86; --viz-grid: oklch(0.5 0 0 / 14%);
  --viz-1: #c4e6e9; --viz-2: #8acdd3; --viz-3: #4fb0b9; --viz-4: #1a8f99; --viz-5: #0b5f67; }
.dark .viz { --viz-mark: #2aa9b5; --viz-grid: oklch(1 0 0 / 12%);
  --viz-1: #1d3c40; --viz-2: #1f5c63; --viz-3: #21808a; --viz-4: #2aa9b5; --viz-5: #7fd9e1; }
`;

function niceMax(value: number): number {
  if (value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) if (value <= step * magnitude) return step * magnitude;
  return 10 * magnitude;
}

const shortDate = (key: string) => {
  const [, m, d] = key.split("-").map(Number);
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${d}`;
};

export function SalesColumns({ days }: { days: SalesDay[] }) {
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(...days.map((d) => d.netSalesCents), 0));
  const ticks = [max, max / 2, 0];
  const every = Math.max(1, Math.ceil(days.length / 8));
  const current = active === null ? null : days[active];

  return (
    <div className="viz relative" data-testid="sales-chart">
      <style>{VIZ_STYLE}</style>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
        {/* Y axis: three clean ticks. */}
        <div className="tabular flex h-48 flex-col justify-between text-right text-xs text-muted-foreground" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
              {formatCents(t).replace(/\.00$/, "")}
            </span>
          ))}
        </div>
        <div className="relative h-48">
          {ticks.map((t) => (
            <div key={t} className="absolute inset-x-0 h-px bg-[var(--viz-grid)]" style={{ bottom: `${(t / max) * 100}%` }} aria-hidden="true" />
          ))}
          <ol className="absolute inset-0 flex items-end gap-[2px]" aria-label="Net sales by day">
            {days.map((day, i) => (
              <li key={day.businessDate} className="flex h-full min-w-0 flex-1 items-end justify-center">
                <button
                  type="button"
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  aria-describedby={active === i ? `${id}-tip` : undefined}
                  aria-label={`${shortDate(day.businessDate)}: net sales ${formatCents(day.netSalesCents)}, ${day.orders} orders`}
                  className="focus-ring flex h-full w-full max-w-6 items-end"
                >
                  <span
                    className={cn("block w-full rounded-t bg-[var(--viz-mark)] transition-opacity", active !== null && active !== i && "opacity-60")}
                    style={{ height: `${Math.max(day.netSalesCents > 0 ? 1 : 0, (day.netSalesCents / max) * 100)}%` }}
                  />
                </button>
              </li>
            ))}
          </ol>
        </div>
        <span />
        <div className="flex gap-[2px] text-[11px] text-muted-foreground" aria-hidden="true">
          {days.map((day, i) => (
            <span key={day.businessDate} className="min-w-0 flex-1 overflow-visible text-center whitespace-nowrap">
              {i % every === 0 ? shortDate(day.businessDate) : ""}
            </span>
          ))}
        </div>
      </div>
      {current ? (
        <div id={`${id}-tip`} role="tooltip" className="pointer-events-none absolute top-0 right-0 rounded-xl border bg-popover px-3 py-2 text-sm shadow-md">
          <p className="tabular font-bold">{formatCents(current.netSalesCents)}</p>
          <p className="text-muted-foreground">
            Net sales · {shortDate(current.businessDate)} · {current.orders} order{current.orders === 1 ? "" : "s"}
          </p>
        </div>
      ) : null}
    </div>
  );
}

const STEPS = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)", "var(--viz-5)"];

function step(count: number, max: number): string | null {
  if (count <= 0 || max <= 0) return null;
  return STEPS[Math.min(4, Math.floor((count / max) * 5 - 1e-9))];
}

export function PeakHeatmap({ grid, max, hours }: { grid: number[][]; max: number; hours: number[] }) {
  const [active, setActive] = useState<{ day: number; hour: number } | null>(null);
  // Monday first, as a week reads.
  const order = [1, 2, 3, 4, 5, 6, 0];

  return (
    <div className="viz space-y-3" data-testid="peak-heatmap">
      <style>{VIZ_STYLE}</style>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-[2px] text-xs">
          <caption className="sr-only">Orders by weekday and hour placed, Honolulu time</caption>
          <thead>
            <tr>
              <th scope="col" className="sr-only">
                Day
              </th>
              {hours.map((h) => (
                <th key={h} scope="col" className="w-9 min-w-9 px-0 font-normal text-muted-foreground">
                  {h % 3 === 0 ? hourLabel(h).replace(" ", "") : <span className="sr-only">{hourLabel(h)}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {order.map((day) => (
              <tr key={day}>
                <th scope="row" className="pr-2 text-left font-semibold">
                  {WEEKDAYS[day]}
                </th>
                {hours.map((hour) => {
                  const count = grid[day][hour];
                  const fill = step(count, max);
                  const on = active?.day === day && active.hour === hour;
                  return (
                    <td key={hour} className="p-0">
                      <span
                        tabIndex={0}
                        role="img"
                        aria-label={`${WEEKDAYS[day]} ${hourLabel(hour)}: ${count} order${count === 1 ? "" : "s"}`}
                        onPointerEnter={() => setActive({ day, hour })}
                        onPointerLeave={() => setActive(null)}
                        onFocus={() => setActive({ day, hour })}
                        onBlur={() => setActive(null)}
                        className={cn("focus-ring relative block h-8 w-9 rounded-[4px]", !fill && "bg-muted", on && "outline-2 outline-foreground")}
                        style={fill ? { backgroundColor: fill } : undefined}
                      >
                        {on ? (
                          <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 rounded-lg border bg-popover px-2 py-1 whitespace-nowrap shadow-md">
                            <span className="tabular block font-bold">{count} order{count === 1 ? "" : "s"}</span>
                            <span className="text-muted-foreground">
                              {WEEKDAYS[day]} {hourLabel(hour)}
                            </span>
                          </span>
                        ) : null}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-hidden="true">
        <span>Fewer</span>
        <span className="block h-3 w-5 rounded-sm bg-muted" />
        {STEPS.map((s) => (
          <span key={s} className="block h-3 w-5 rounded-sm" style={{ backgroundColor: s }} />
        ))}
        <span>More (busiest hour: {max})</span>
      </div>
    </div>
  );
}

/** A thin magnitude bar for a table cell (the number beside it carries the value). */
export function InlineBar({ value, max }: { value: number; max: number }) {
  return (
    <span className="block h-2 w-full max-w-40 overflow-hidden rounded-full bg-muted" aria-hidden="true">
      <span className="block h-full rounded-full bg-chart-1" style={{ width: `${max > 0 ? Math.max(2, (value / max) * 100) : 0}%` }} />
    </span>
  );
}
