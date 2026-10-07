/**
 * Phase 9: reports on the reports demo data (npm run db:seed:reports-demo,
 * run here against the e2e stack): the page shows it, and the CSV exports
 * add up to what the page says.
 */
import { execFileSync } from "node:child_process";

import { parseCsv } from "../src/lib/csv";
import { expect, test } from "./support/test";

import { signInAdmin } from "./support/admin";
import { honoluluDate } from "./support/catering";

test.describe.configure({ timeout: 120_000 });

const seed = (...args: string[]) => execFileSync("node", ["scripts/seed-reports-demo.mjs", "--e2e", ...args], { stdio: "pipe" });

test.beforeAll(() => {
  seed();
});

test.afterAll(() => {
  seed("--remove");
});

const dollars = (text: string) => Math.round(Number(text.replace(/[$,]/g, "")) * 100);

test("reports show the demo data and the exports match the totals @desktop", async ({ page }) => {
  const from = honoluluDate(-42);
  const to = honoluluDate(-1);
  await signInAdmin(page, `/admin/reports?preset=custom&from=${from}&to=${to}`);

  await expect(page.getByTestId("sales-chart")).toBeVisible();
  await expect(page.getByTestId("peak-heatmap")).toBeVisible();
  await expect(page.getByTestId("products-card").locator("tbody tr").first()).toBeVisible();
  await expect(page.getByTestId("discounts-card")).toContainText("DEMO-WELCOME10");
  await expect(page.getByTestId("catering-card")).toContainText(/CAT-\d{6}-9\d\d/);

  const netSales = dollars((await page.getByTestId("report-net-sales").locator("p").last().innerText()).trim());
  const orders = Number((await page.getByTestId("report-orders").locator("p").last().innerText()).trim());
  expect(orders).toBeGreaterThan(300);

  // The sales export: its total row is the page's.
  const salesCsv = await page.request.get(`/admin/reports/export?report=sales&from=${from}&to=${to}`);
  expect(salesCsv.headers()["content-type"]).toContain("text/csv");
  expect(salesCsv.headers()["content-disposition"]).toContain("attachment");
  const sales = parseCsv(await salesCsv.text());
  const total = sales.at(-1)!;
  expect(total[0]).toBe("Total");
  expect(Number(total[sales[0].indexOf("Orders")])).toBe(orders);
  expect(dollars(total[sales[0].indexOf("Net sales")])).toBe(netSales);

  // The accountant's orders export adds up to the same figures.
  const orderRows = parseCsv(await (await page.request.get(`/admin/reports/export?report=orders&from=${from}&to=${to}`)).text());
  const header = orderRows[0];
  const body = orderRows.slice(1);
  expect(body).toHaveLength(orders);
  const sum = (column: string) => body.reduce((s, row) => s + dollars(row[header.indexOf(column)]), 0);
  expect(sum("Net sales")).toBe(netSales);
  expect(sum("Net tax (GET)")).toBe(dollars(total[sales[0].indexOf("Tax (GET)")]));
  expect(sum("Net tips")).toBe(dollars(total[sales[0].indexOf("Tips")]));
  expect(sum("Refunded")).toBe(dollars(total[sales[0].indexOf("Refunds")]));

  // The demo's two attention items are on the home page.
  await page.goto("/admin");
  await expect(page.getByTestId("attention-item").filter({ hasText: "Reports demo: the mail server refused" })).toBeVisible();
  await expect(page.getByTestId("attention-item").filter({ hasText: "Reports demo: the card was closed" })).toBeVisible();
});
