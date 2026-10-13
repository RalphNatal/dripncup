/**
 * Web Push without a real push service.
 *
 * - `startPushService()` runs a stand-in push service on E2E_PUSH_PORT
 *   (playwright.config.ts). The test server accepts that origin as a push
 *   endpoint only because E2E_RUN_ID is set and the database is local
 *   (src/lib/push/config.ts). It records every request; an endpoint path
 *   starting /push/dead- answers 410 Gone, like a real service for an
 *   uninstalled app, everything else 201 Created.
 * - `fakeSubscription()` makes a real P-256 key pair and auth secret, so the
 *   server's encryption is real and the test can decrypt what arrives.
 * - `stubPushManager()` replaces PushManager.subscribe/getSubscription in
 *   the browser with that subscription (headless browsers can't reach the
 *   real push services), kept in localStorage across page loads.
 */
import { createDecipheriv, createECDH, hkdfSync, randomBytes, type ECDH } from "node:crypto";
import { createServer, type Server } from "node:http";

import type { BrowserContext } from "./test";

export interface ReceivedPush {
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

export interface PushService {
  origin: string;
  received: ReceivedPush[];
  /** Pushes that reached this endpoint path. */
  to(path: string): ReceivedPush[];
  close(): Promise<void>;
}

export async function startPushService(): Promise<PushService> {
  const port = Number(process.env.E2E_PUSH_PORT ?? 3199);
  const received: ReceivedPush[] = [];
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const path = request.url ?? "/";
      received.push({ path, headers: request.headers, body: Buffer.concat(chunks) });
      response.statusCode = path.startsWith("/push/dead-") ? 410 : 201;
      response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  return {
    origin: `http://127.0.0.1:${port}`,
    received,
    to: (path) => received.filter((push) => push.path === path),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export interface FakeSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
  receiver: ECDH;
  authSecret: Buffer;
}

export function fakeSubscription(origin: string, name: string): FakeSubscription {
  const receiver = createECDH("prime256v1");
  receiver.generateKeys();
  const authSecret = randomBytes(16);
  return {
    endpoint: `${origin}/push/${name}`,
    p256dh: receiver.getPublicKey().toString("base64url"),
    auth: authSecret.toString("base64url"),
    receiver,
    authSecret,
  };
}

/** Decrypts an aes128gcm push body for `subscription` (RFC 8188, RFC 8291). */
export function decryptPush(body: Buffer, subscription: FakeSubscription): unknown {
  const salt = body.subarray(0, 16);
  const idLength = body.readUInt8(20);
  const senderKey = body.subarray(21, 21 + idLength);
  const ciphertext = body.subarray(21 + idLength);
  const secret = subscription.receiver.computeSecret(senderKey);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), subscription.receiver.getPublicKey(), senderKey]);
  const ikm = Buffer.from(hkdfSync("sha256", secret, subscription.authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const padded = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  let end = padded.length - 1;
  while (end > 0 && padded[end] === 0) end -= 1;
  return JSON.parse(padded.subarray(0, end).toString("utf8"));
}

/** Makes this context's PushManager hand out `subscription`. Notifications are granted. */
export async function stubPushManager(context: BrowserContext, subscription: FakeSubscription, baseURL = "http://localhost:3100") {
  await context.grantPermissions(["notifications"], { origin: baseURL });
  await context.addInitScript(
    ({ endpoint, p256dh, auth }) => {
      const KEY = "e2e:push-subscription";
      const make = () => ({
        endpoint,
        expirationTime: null,
        options: { userVisibleOnly: true, applicationServerKey: null },
        getKey: () => null,
        toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh, auth } }),
        unsubscribe: async () => {
          localStorage.removeItem(KEY);
          return true;
        },
      });
      if (typeof PushManager === "undefined") return;
      PushManager.prototype.subscribe = async function subscribe() {
        localStorage.setItem(KEY, "1");
        return make() as unknown as PushSubscription;
      };
      PushManager.prototype.getSubscription = async function getSubscription() {
        return (localStorage.getItem(KEY) ? make() : null) as unknown as PushSubscription | null;
      };
    },
    { endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth: subscription.auth },
  );
}
