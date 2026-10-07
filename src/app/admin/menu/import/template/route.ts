/**
 * The menu spreadsheet downloads: ?file=template.csv | template.xlsx |
 * example.csv | example.xlsx. Admins only (the proxy gates /admin; this
 * checks again, since a route handler has no layout).
 */
import { toCsv } from "@/lib/csv";
import { getCurrentProfile } from "@/lib/auth/dal";
import { templateCsvRows, templateXlsx, type TemplateKind } from "@/lib/menu-import/file";

const FILES: Record<string, { kind: TemplateKind; format: "csv" | "xlsx" }> = {
  "template.csv": { kind: "template", format: "csv" },
  "template.xlsx": { kind: "template", format: "xlsx" },
  "example.csv": { kind: "example", format: "csv" },
  "example.xlsx": { kind: "example", format: "xlsx" },
};

export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") return new Response("Not found", { status: 404 });
  const name = new URL(request.url).searchParams.get("file") ?? "";
  const file = FILES[name];
  if (!file) return new Response("Not found", { status: 404 });

  const body = file.format === "csv" ? toCsv(templateCsvRows(file.kind)) : templateXlsx(file.kind);
  return new Response(body as BodyInit, {
    headers: {
      "content-type": file.format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="drincup-menu-${name}"`,
      "cache-control": "no-store",
    },
  });
}
