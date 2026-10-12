import { describe, expect, it } from "vitest";

import { formatErrorLog, redact } from "./log";

describe("redact", () => {
  it("masks emails, phone numbers and card-like numbers", () => {
    expect(redact('duplicate key value: Key (email)=(kai.aloha@example.com) already exists')).toBe(
      "duplicate key value: Key (email)=([email]) already exists",
    );
    expect(redact("call (808) 555-0123 or 808-555-0199")).toBe("call [phone] or [phone]");
    expect(redact("card 4242 4242 4242 4242 declined")).toBe("card [number] declined");
  });

  it("masks tokens and keys", () => {
    expect(redact("Bearer abc.def-ghi")).toBe("[credentials]");
    expect(redact("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl here")).toBe("token [token] here");
    expect(redact("used sk_test_51Habc and whsec_xyz")).toBe("used [key] and [key]");
    expect(redact("secret pi_3Abc_secret_Def")).toBe("secret [client-secret]");
  });

  it("leaves ordinary text, ids and order numbers alone", () => {
    const text = "Order DC-261012-0042 (0b0c3a8e-6b1e-4f9e-a1f3-2d4c5e6f7a8b) failed: timeout after 30s";
    expect(redact(text)).toBe(text);
  });
});

describe("formatErrorLog", () => {
  it("writes one JSON line with the request id, viewer, route and a redacted error", () => {
    const line = JSON.parse(
      formatErrorLog({
        event: "checkout.create_failed",
        error: Object.assign(new Error("insert failed for kai@example.com"), { code: "23505" }),
        requestId: "req-1",
        viewer: "signed-in",
        route: "/checkout",
        context: { orderId: "o-1", note: "phone 808 555 0123", skipped: undefined },
      }),
    );
    expect(line).toMatchObject({
      level: "error",
      event: "checkout.create_failed",
      requestId: "req-1",
      viewer: "signed-in",
      route: "/checkout",
      orderId: "o-1",
      note: "phone [phone]",
      error: { name: "Error", message: "insert failed for [email]", code: "23505" },
    });
    expect(line).not.toHaveProperty("skipped");
  });

  it("handles Supabase's plain-object errors and non-errors", () => {
    expect(JSON.parse(formatErrorLog({ event: "x", error: { message: "permission denied", code: "42501" } })).error).toEqual({
      name: "Error",
      message: "permission denied",
      code: "42501",
    });
    expect(JSON.parse(formatErrorLog({ event: "x", error: "plain" })).error.message).toBe("plain");
  });
});
