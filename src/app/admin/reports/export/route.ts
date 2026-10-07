/**
 * CSV exports for the Reports page, generated on the server for admins only
 * (the admin_report_* functions check the role again). Every text cell goes
 * through toCsv, which defuses anything a spreadsheet would run as a formula.
 *
 *   ?report=sales|orders|products|modifiers|peak|discounts|catering
 *   &from=YYYY-MM-DD&to=YYYY-MM-DD (Honolulu dates)&location=<uuid>
 */
import { getCurrentProfile } from "@/lib/auth/dal";
import { csvDollars, toCsv, type CsvCell } from "@/lib/csv";
import { isUuid } from "@/lib/admin/guard";
import { WEEKDAYS, hourLabel, ordersCsvRows, parseReportRange, salesCsvRows } from "@/lib/reports/definitions";
import { getCateringRevenue, getDiscountUsage, getOrderExport, getPeakHours, getSalesDays, getTopModifiers, getTopProducts } from "@/lib/reports/queries";
import { formatCafeDateTime } from "@/lib/time";

const REPORTS = ["sales", "orders", "products", "modifiers", "peak", "discounts", "catering"] as const;
type Report = (typeof REPORTS)[number];

async function rowsFor(report: Report, range: { from: string; to: string }, location: string | null): Promise<CsvCell[][]> {
  switch (report) {
    case "sales":
      return salesCsvRows(await getSalesDays(range, location));
    case "orders":
      return ordersCsvRows(await getOrderExport(range, location), (iso) => formatCafeDateTime(new Date(iso)));
    case "products":
      return [["Product", "Units sold", "Revenue", "Orders"], ...(await getTopProducts(range, location, 200)).map((p) => [p.name, p.quantity, csvDollars(p.revenueCents), p.orders])];
    case "modifiers":
      return [["Group", "Option", "Times chosen", "Revenue"], ...(await getTopModifiers(range, location, 200)).map((m) => [m.groupName, m.optionName, m.quantity, csvDollars(m.revenueCents)])];
    case "peak":
      return [["Weekday", "Hour (Honolulu)", "Orders"], ...(await getPeakHours(range, location)).map((c) => [WEEKDAYS[c.weekday], hourLabel(c.hour), c.orders])];
    case "discounts":
      return [["Kind", "Code or reward", "Uses", "Discount", "Points"], ...(await getDiscountUsage(range, location)).map((d) => [d.kind, d.name, d.uses, csvDollars(d.discountCents), d.points])];
    case "catering":
      return [
        ["Request", "Paid date", "Event (Honolulu)", "Status", "Contact", "Headcount", "Items", "Discount", "Delivery", "Tax (GET)", "Gratuity", "Total", "Refunded", "Net"],
        ...(await getCateringRevenue(range, location)).map((c) => [
          c.requestNumber, c.paidDate, formatCafeDateTime(new Date(c.eventAt)), c.status, c.contactName, c.headcount, csvDollars(c.itemsCents),
          csvDollars(c.discountCents), csvDollars(c.deliveryFeeCents), csvDollars(c.taxCents), csvDollars(c.gratuityCents), csvDollars(c.totalCents),
          csvDollars(c.refundedCents), csvDollars(c.netCents),
        ]),
      ];
  }
}

export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") return new Response("Not found", { status: 404 });
  const params = new URL(request.url).searchParams;
  const report = params.get("report") as Report;
  if (!REPORTS.includes(report)) return new Response("Unknown report", { status: 400 });
  const { range, problem } = parseReportRange({ preset: "custom", from: params.get("from") ?? "", to: params.get("to") ?? "" }, new Date());
  if (problem) return new Response(problem, { status: 400 });
  const location = isUuid(params.get("location")) ? params.get("location") : null;

  const csv = toCsv(await rowsFor(report, range, location));
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="drincup-${report}-${range.from}-to-${range.to}.csv"`,
      "cache-control": "no-store",
    },
  });
}
