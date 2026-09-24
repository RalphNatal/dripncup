/**
 * A shared product link opened on a server that has never served anything.
 *
 * Starts its own `next start` from the build the suite just made, waits for
 * the port to accept connections (no HTTP request), and makes the product
 * page the server's very first request. Guards against anything in the page
 * that only works once something else has warmed up.
 *
 * Background: a one-off 500 on this URL was seen under `npm run dev`, thrown
 * from Next's dev route matcher (`matchAll.next`) while it compiled the route
 * on demand. It reproduces only when that on-demand compile runs against a
 * source file that is being written, and cannot occur in a production build,
 * which compiles everything ahead of time. See ARCHITECTURE.md, "Dev server:
 * the one-off 500".
 */
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

const PORT = 3101;

function waitForPort(port: number, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = connect(port, "127.0.0.1");
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error(`Nothing listening on ${port}`));
        else setTimeout(attempt, 200);
      });
    };
    attempt();
  });
}

test("a product URL opened first on a cold production server renders", async ({ page }) => {
  // `node .../next start` rather than npx, so killing it stops the server too.
  const server = spawn(process.execPath, [join("node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT)], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout?.on("data", (chunk) => (log += chunk));
  server.stderr?.on("data", (chunk) => (log += chunk));

  try {
    await waitForPort(PORT);

    const response = await page.goto(`http://localhost:${PORT}/menu/kona-drip-coffee`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Kona Blend Drip", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: /Add to Cart|Sold out/ })).toBeVisible();

    expect(log, "the server logged an error").not.toMatch(/⨯|Error:/);
  } finally {
    server.kill();
  }
});
