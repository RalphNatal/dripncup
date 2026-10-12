/**
 * `npm run lighthouse [-- options]`: Lighthouse (mobile) on the customer
 * pages that matter most, against a production build.
 *
 *   1. `next build` (skip with --skip-build to reuse the last one)
 *   2. `next start` on port 3200 (or --url <base> to test a server you run)
 *   3. Lighthouse, mobile emulation with its default simulated throttling,
 *      on Home, Menu, a product page, Cart, Rewards, Events and Catering;
 *      each page --runs times (default 3), keeping the median per category
 *   4. Prints the scores and exits 1 if any is below --min (default 90)
 *
 * Pages are opened signed out, so nothing is written to the database. The
 * server uses .env.local like `npm run start` does, so it reads your local
 * dev stack. Reports (HTML and JSON) land in .lighthouse/ (gitignored).
 *
 * The browser is Chrome if installed, else Microsoft Edge (Windows ships it);
 * CHROME_PATH overrides both.
 *
 * Options:
 *   --skip-build          reuse .next from the last build
 *   --url <base>          test a running server instead of starting one
 *   --runs <n>            runs per page; the median counts (default 3)
 *   --min <score>         fail below this, 0-100 (default 90)
 *   --only <name,...>     a subset of pages, by name (home, menu, product, ...)
 *   --port <n>            port for the server this script starts (default 3200)
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";

const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"];
const LABELS = { performance: "Perf", accessibility: "A11y", "best-practices": "Best", seo: "SEO" };
const OUT_DIR = ".lighthouse";
const isWindows = process.platform === "win32";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : true;
}

const skipBuild = option("skip-build", false) === true;
const externalUrl = option("url", null);
const runs = Math.max(1, Number(option("runs", 3)));
const minScore = Number(option("min", 90));
const only = option("only", null);
const port = Number(option("port", 3200));
const base = (typeof externalUrl === "string" ? externalUrl : `http://localhost:${port}`).replace(/\/$/, "");

function log(message) {
  console.log(`[lighthouse] ${message}`);
}

function browserPath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  try {
    const found = chromeLauncher.Launcher.getInstallations();
    if (found.length) return found[0];
  } catch {
    // No Chrome; try Edge below.
  }
  const edge = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/microsoft-edge",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ].find((path) => existsSync(path));
  if (edge) return edge;
  throw new Error("No Chrome or Edge found. Set CHROME_PATH to a Chromium-based browser.");
}

async function waitForServer(url, child, timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child && child.exitCode !== null) throw new Error(`next start exited with code ${child.exitCode}`);
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${url} did not answer within ${timeoutMs / 1000} s`);
}

async function portInUse(target) {
  try {
    await fetch(target, { redirect: "manual", signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

/** The first product link on the menu, so the product page tested is one that exists. */
async function findProductPath() {
  const html = await (await fetch(`${base}/menu`)).text();
  const match = html.match(/href="(\/menu\/[a-z0-9-]+)"/);
  if (!match) throw new Error("No product link found on /menu. Is the menu seeded (npm run db:seed)?");
  return match[1];
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function main() {
  let server = null;

  if (!externalUrl) {
    if (await portInUse(base)) {
      throw new Error(
        `Port ${port} is already in use. Stop that server (Get-NetTCPConnection -LocalPort ${port} -State Listen) or pass --port.`,
      );
    }
    if (!skipBuild) {
      log("Building (next build)...");
      const build = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build"], { stdio: "inherit" });
      if (build.status !== 0) process.exit(build.status ?? 1);
    }
    log(`Starting next start on port ${port}...`);
    // node runs next directly (no npx wrapper), so killing this child stops the server.
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", String(port)], {
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, NODE_ENV: "production" },
    });
  }

  const stopServer = () => {
    if (!server || server.exitCode !== null) return;
    if (isWindows) spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    else server.kill("SIGTERM");
  };
  process.on("exit", stopServer);
  process.on("SIGINT", () => process.exit(130));

  let chrome = null;
  try {
    await waitForServer(base, server);

    const pages = [
      { name: "home", path: "/" },
      { name: "menu", path: "/menu" },
      { name: "product", path: await findProductPath() },
      { name: "cart", path: "/cart" },
      { name: "rewards", path: "/rewards" },
      { name: "events", path: "/events" },
      { name: "catering", path: "/catering" },
    ].filter((page) => !only || String(only).split(",").includes(page.name));

    // Warm each route once so the first measured run is not a cold compile of the server's caches.
    for (const page of pages) await fetch(`${base}${page.path}`).catch(() => undefined);

    chrome = await chromeLauncher.launch({
      chromePath: browserPath(),
      chromeFlags: ["--headless=new", "--no-first-run", "--disable-extensions", "--no-default-browser-check"],
    });
    mkdirSync(OUT_DIR, { recursive: true });

    const results = [];
    for (const page of pages) {
      const scores = Object.fromEntries(CATEGORIES.map((c) => [c, []]));
      let lastAudits = null;
      for (let run = 1; run <= runs; run += 1) {
        log(`${page.name} (${page.path}) run ${run}/${runs}`);
        const result = await lighthouse(`${base}${page.path}`, {
          port: chrome.port,
          output: ["html", "json"],
          onlyCategories: CATEGORIES,
          logLevel: "error",
        });
        if (!result) throw new Error(`Lighthouse returned nothing for ${page.path}`);
        const { lhr, report } = result;
        if (lhr.runtimeError) throw new Error(`${page.path}: ${lhr.runtimeError.message}`);
        for (const category of CATEGORIES) scores[category].push(Math.round((lhr.categories[category]?.score ?? 0) * 100));
        lastAudits = lhr;
        if (run === runs) {
          writeFileSync(join(OUT_DIR, `${page.name}.html`), report[0]);
          writeFileSync(join(OUT_DIR, `${page.name}.json`), report[1]);
        }
      }
      const summary = Object.fromEntries(CATEGORIES.map((c) => [c, median(scores[c])]));
      const metrics = lastAudits?.audits ?? {};
      results.push({
        ...page,
        scores: summary,
        lcp: metrics["largest-contentful-paint"]?.displayValue,
        tbt: metrics["total-blocking-time"]?.displayValue,
        cls: metrics["cumulative-layout-shift"]?.displayValue,
      });
    }

    console.log("");
    console.log(`Lighthouse, mobile, median of ${runs} run(s); target ${minScore}+`);
    console.log("");
    const header = ["Page".padEnd(10), ...CATEGORIES.map((c) => LABELS[c].padStart(5)), "  LCP".padEnd(9), "TBT".padEnd(9), "CLS"].join(" ");
    console.log(header);
    console.log("-".repeat(header.length));
    const failures = [];
    for (const result of results) {
      const cells = CATEGORIES.map((category) => {
        const score = result.scores[category];
        if (score < minScore) failures.push(`${result.name} ${LABELS[category]} ${score}`);
        return `${score < minScore ? "!" : " "}${String(score).padStart(4)}`;
      });
      console.log([result.name.padEnd(10), ...cells, `  ${(result.lcp ?? "").padEnd(7)}`, (result.tbt ?? "").padEnd(9), result.cls ?? ""].join(" "));
    }
    writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify({ runs, minScore, results }, null, 2));
    console.log("");
    console.log(`Reports: ${OUT_DIR}/<page>.html`);

    if (failures.length) {
      console.error(`\nBelow ${minScore}: ${failures.join(", ")}`);
      process.exitCode = 1;
    } else {
      console.log(`\nEvery page scores ${minScore}+ in every category.`);
    }
  } finally {
    if (chrome) await chrome.kill();
    stopServer();
  }
}

main().catch((error) => {
  console.error(`[lighthouse] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
