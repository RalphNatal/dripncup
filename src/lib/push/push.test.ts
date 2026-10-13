import { createECDH, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

import webpush from "web-push";
import { describe, expect, it } from "vitest";

import { PUSH_TTL_SECONDS, classifyPushResponse, rowOutcome } from "./delivery";
import { deviceLabel, isAllowedPushEndpoint } from "./endpoints";
import { orderReadyPayload, parsePushPayload, safeNotificationPath } from "./payload";
import { buildPushRequest } from "./request";

describe("push endpoints", () => {
  it("accepts the push services browsers use", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/abc:def",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
      "https://web.push.apple.com/QGuQ-abc",
      "https://wns2-par02p.notify.windows.com/w/?token=abc",
    ]) {
      expect(isAllowedPushEndpoint(endpoint), endpoint).toBe(true);
    }
  });

  it("refuses anything else: our server would POST to it", () => {
    for (const endpoint of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com:8443/fcm/send/abc",
      "https://evil.example/fcm.googleapis.com",
      "https://fcm.googleapis.com.evil.example/x",
      "https://user:pass@fcm.googleapis.com/x",
      "http://127.0.0.1:54321/rest/v1/",
      "http://169.254.169.254/latest/meta-data",
      "https://localhost/push",
      "not a url",
      `https://fcm.googleapis.com/${"a".repeat(2100)}`,
    ]) {
      expect(isAllowedPushEndpoint(endpoint), endpoint).toBe(false);
    }
  });

  it("allows an extra origin only when the caller passes one (the e2e stand-in)", () => {
    expect(isAllowedPushEndpoint("http://127.0.0.1:3199/push/abc")).toBe(false);
    expect(isAllowedPushEndpoint("http://127.0.0.1:3199/push/abc", ["http://127.0.0.1:3199"])).toBe(true);
    expect(isAllowedPushEndpoint("http://127.0.0.1:3200/push/abc", ["http://127.0.0.1:3199"])).toBe(false);
  });

  it("names a device by browser and platform only", () => {
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36")).toBe("Chrome on Android");
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iPhone");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0")).toBe("Edge on Windows");
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0")).toBe("Firefox on Mac");
    expect(deviceLabel(null)).toBe("This device");
  });
});

describe("push payload", () => {
  it("says the order is ready, with the number and place only", () => {
    const payload = orderReadyPayload({ orderId: "o-1", orderNumber: "DC-261012-0042", locationName: "Kapiolani" });
    expect(payload).toEqual({
      title: "Your order is ready! 🎉",
      body: "DC-261012-0042 is waiting for you at Kapiolani. Mahalo!",
      tag: "order-ready-o-1",
      url: "/orders/o-1",
    });
  });

  it("the worker only ever opens a path on this site", () => {
    expect(safeNotificationPath("/orders/abc")).toBe("/orders/abc");
    expect(safeNotificationPath("https://evil.example")).toBe("/");
    expect(safeNotificationPath("//evil.example/x")).toBe("/");
    expect(safeNotificationPath("/\\evil.example")).toBe("/");
    expect(parsePushPayload({ title: "Hi", body: "B", tag: "t", url: "javascript:alert(1)" })?.url).toBe("/");
    expect(parsePushPayload({ body: "no title" })).toBeNull();
    expect(parsePushPayload("text")).toBeNull();
  });
});

describe("push delivery rules", () => {
  it("reads push service answers", () => {
    expect(classifyPushResponse(201)).toBe("delivered");
    expect(classifyPushResponse(404)).toBe("gone");
    expect(classifyPushResponse(410)).toBe("gone");
    expect(classifyPushResponse(429)).toBe("retry");
    expect(classifyPushResponse(503)).toBe("retry");
    expect(classifyPushResponse(null)).toBe("retry");
    expect(classifyPushResponse(400)).toBe("rejected");
    expect(classifyPushResponse(403)).toBe("rejected");
    expect(classifyPushResponse(413)).toBe("rejected");
  });

  it("decides what happens to the outbox row", () => {
    expect(rowOutcome({ deliveredBefore: 0, results: ["delivered", "gone"], attempts: 1, maxAttempts: 4 })).toEqual({ status: "sent" });
    expect(rowOutcome({ deliveredBefore: 0, results: ["gone"], attempts: 1, maxAttempts: 4 })).toEqual({ status: "skipped" });
    expect(rowOutcome({ deliveredBefore: 0, results: [], attempts: 1, maxAttempts: 4 })).toEqual({ status: "skipped" });
    // A busy service: retried quickly, only for the devices not reached.
    expect(rowOutcome({ deliveredBefore: 0, results: ["delivered", "retry"], attempts: 1, maxAttempts: 4 })).toEqual({ status: "pending", retryInSeconds: 30 });
    expect(rowOutcome({ deliveredBefore: 1, results: ["retry"], attempts: 3, maxAttempts: 4 })).toEqual({ status: "pending", retryInSeconds: 300 });
    // Out of attempts.
    expect(rowOutcome({ deliveredBefore: 1, results: ["retry"], attempts: 4, maxAttempts: 4 })).toEqual({ status: "sent" });
    expect(rowOutcome({ deliveredBefore: 0, results: ["retry"], attempts: 4, maxAttempts: 4 })).toEqual({ status: "failed" });
  });
});

/** Decrypts an aes128gcm Web Push body as the browser would (RFC 8188 + RFC 8291). */
function decryptPushBody(body: Uint8Array, receiver: ReturnType<typeof createECDH>, authSecret: Buffer): string {
  const data = Buffer.from(body);
  const salt = data.subarray(0, 16);
  const idLength = data.readUInt8(20);
  const senderPublicKey = data.subarray(21, 21 + idLength);
  const ciphertext = data.subarray(21 + idLength);

  const sharedSecret = receiver.computeSecret(senderPublicKey);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), receiver.getPublicKey(), senderPublicKey]);
  const ikm = Buffer.from(hkdfSync("sha256", sharedSecret, authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));

  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const padded = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  // The last record ends with a 0x02 delimiter, then zero padding.
  let end = padded.length - 1;
  while (end > 0 && padded[end] === 0) end -= 1;
  expect(padded[end]).toBe(2);
  return padded.subarray(0, end).toString("utf8");
}

describe("push request", () => {
  it("is encrypted to the device, signed with our VAPID key, and short-lived", () => {
    const receiver = createECDH("prime256v1");
    receiver.generateKeys();
    const authSecret = randomBytes(16);
    const vapid = webpush.generateVAPIDKeys();
    const payload = orderReadyPayload({ orderId: "o-1", orderNumber: "DC-261012-0042", locationName: "Kakaʻako" });

    const request = buildPushRequest(
      {
        endpoint: "https://fcm.googleapis.com/fcm/send/device-1",
        p256dh: receiver.getPublicKey().toString("base64url"),
        auth: authSecret.toString("base64url"),
      },
      payload,
      { publicKey: vapid.publicKey, privateKey: vapid.privateKey, subject: "mailto:test@drincup.test" },
    );

    expect(request.method).toBe("POST");
    expect(request.endpoint).toBe("https://fcm.googleapis.com/fcm/send/device-1");
    expect(request.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(request.headers.TTL).toBe(String(PUSH_TTL_SECONDS));
    expect(request.headers.Urgency).toBe("high");
    expect(request.headers.Authorization).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${vapid.publicKey}$`));
    // Nothing readable on the wire...
    expect(Buffer.from(request.body!).toString("utf8")).not.toContain("DC-261012-0042");
    // ...but the device gets exactly the payload, ʻokina and all.
    expect(JSON.parse(decryptPushBody(request.body!, receiver, authSecret))).toEqual(payload);
  });
});
