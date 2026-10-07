import { quoteRows } from "@/lib/catering/format";
import type { CateringQuoteView } from "@/lib/catering/queries";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

/** A quote's lines and totals. Server-rendered on the request page, the admin screen and the pay page. */
export function QuoteSummary({ quote, className }: { quote: CateringQuoteView; className?: string }) {
  return (
    <div className={cn("space-y-3", className)} data-testid="quote-summary">
      <ul className="divide-y">
        {quote.lines.map((line, index) => (
          <li key={index} className="flex items-start justify-between gap-3 py-2 text-sm">
            <span className="min-w-0">
              <span className="tabular font-bold">{line.quantity}×</span> {line.description}
              {line.sizeName ? <span className="text-muted-foreground"> ({line.sizeName})</span> : null}
              <span className="block text-xs text-muted-foreground">{formatCents(line.unitPriceCents)} each</span>
            </span>
            <span className="tabular shrink-0 font-semibold">{formatCents(line.lineTotalCents)}</span>
          </li>
        ))}
      </ul>
      <dl className="space-y-1 border-t pt-3 text-sm">
        {quoteRows(quote).map((row) => (
          <div key={row.label} className={cn("flex justify-between gap-3", row.strong ? "text-base font-extrabold" : "text-muted-foreground")}>
            <dt>{row.label}</dt>
            <dd className="tabular" data-testid={row.strong ? "quote-total" : undefined}>
              {row.amount}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
