/**
 * Realtime subscriptions don't pile up as a customer moves around the app:
 * the order tracker's channel is joined when the page opens and left when
 * the customer navigates away (client-side), while the channel behind the
 * Orders-tab dot, shared by the whole app, stays open. Read from the
 * Realtime websocket's own frames.
 */
import { expect, test } from "./support/test";

import { signIn } from "./support/checkout";
import { createCustomer } from "./support/db";
import { arrangePlacedOrder } from "./support/orders";

interface Frame {
  topic: string;
  event: string;
}

test("the tracker's Realtime channel is left on navigation; the app-wide one stays", async ({ page }) => {
  const user = await createCustomer("realtime-cleanup");
  const { orderId } = await arrangePlacedOrder({ userId: user.id, lines: [{ productSlug: "latte" }] });
  const sent: Frame[] = [];
  page.on("websocket", (socket) => {
    if (!socket.url().includes("/realtime/")) return;
    socket.on("framesent", ({ payload }) => {
      try {
        const parsed = JSON.parse(typeof payload === "string" ? payload : payload.toString("utf8")) as unknown;
        // Protocol 2.0 sends [join_ref, ref, topic, event, payload]; 1.0 sent an object.
        const message: Frame = Array.isArray(parsed)
          ? { topic: String(parsed[2]), event: String(parsed[3]) }
          : (parsed as Frame);
        if (message.event === "phx_join" || message.event === "phx_leave") sent.push({ topic: message.topic, event: message.event });
      } catch {
        // Not JSON (heartbeats are; anything else is not ours to read).
      }
    });
  });

  await signIn(page, user.email, user.password, `/orders/${orderId}`);
  const tracker = (frame: Frame) => frame.topic.includes(`id=eq.${orderId}`);
  const appWide = (frame: Frame) => frame.topic.includes(`user_id=eq.${user.id}`);
  await expect.poll(() => sent.filter((f) => tracker(f) && f.event === "phx_join").length, { timeout: 20_000 }).toBe(1);
  await expect.poll(() => sent.filter((f) => appWide(f) && f.event === "phx_join").length).toBeGreaterThan(0);

  // Leave by the tab bar: a client-side navigation, the page's components unmount.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Menu/ }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/menu$/);
  await expect.poll(() => sent.filter((f) => tracker(f) && f.event === "phx_leave").length, { timeout: 10_000 }).toBe(1);
  expect(sent.filter((f) => appWide(f) && f.event === "phx_leave")).toEqual([]);

  // Back and away again: one join and one leave each time, never more.
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/orders/${orderId}$`));
  await expect.poll(() => sent.filter((f) => tracker(f) && f.event === "phx_join").length, { timeout: 20_000 }).toBe(2);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Home/ }).filter({ visible: true }).click();
  await expect.poll(() => sent.filter((f) => tracker(f) && f.event === "phx_leave").length, { timeout: 10_000 }).toBe(2);
});
