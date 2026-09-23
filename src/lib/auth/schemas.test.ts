import { describe, expect, it } from "vitest";

import { echoValues } from "./form-state";
import {
  firstFieldErrors,
  newPasswordSchema,
  profileSchema,
  signInSchema,
  signUpSchema,
} from "./schemas";

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return Object.fromEntries(data);
}

describe("signUpSchema", () => {
  const valid = {
    fullName: "  Keala Kahananui ",
    email: " Keala@Example.COM ",
    password: "overflowing-cup",
  };

  it("trims names and normalises email", () => {
    const result = signUpSchema.parse(form(valid));
    expect(result.fullName).toBe("Keala Kahananui");
    expect(result.email).toBe("keala@example.com");
  });

  it("leaves marketing opt-in off unless ticked", () => {
    expect(signUpSchema.parse(form(valid)).marketingOptIn).toBe(false);
    expect(signUpSchema.parse(form({ ...valid, marketingOptIn: "on" })).marketingOptIn).toBe(true);
  });

  it("stores a blank phone as null", () => {
    expect(signUpSchema.parse(form({ ...valid, phone: "   " })).phone).toBeNull();
    expect(signUpSchema.parse(form({ ...valid, phone: "(808) 555-0123" })).phone).toBe(
      "(808) 555-0123",
    );
  });

  it("reports each bad field once", () => {
    const result = signUpSchema.safeParse(
      form({ fullName: "", email: "not-an-email", password: "short", phone: "call me" }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;

    const errors = firstFieldErrors(result.error);
    expect(Object.keys(errors).sort()).toEqual(["email", "fullName", "password", "phone"]);
    expect(errors.password).toMatch(/at least 8/);
  });

  it("rejects passwords beyond bcrypt's 72-byte limit", () => {
    expect(signUpSchema.safeParse(form({ ...valid, password: "a".repeat(73) })).success).toBe(false);
  });
});

describe("signInSchema", () => {
  it("does not apply new-password rules to an existing password", () => {
    expect(signInSchema.safeParse(form({ email: "a@b.co", password: "short" })).success).toBe(true);
  });

  it("treats a missing field as empty, not as a crash", () => {
    const result = signInSchema.safeParse(form({}));
    expect(result.success).toBe(false);
  });
});

describe("newPasswordSchema", () => {
  it("requires the confirmation to match", () => {
    const result = newPasswordSchema.safeParse(
      form({ password: "overflowing-cup", confirmPassword: "overflowing-mug" }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(firstFieldErrors(result.error).confirmPassword).toBe("Passwords do not match.");
  });
});

describe("profileSchema", () => {
  it("keeps the cup name short enough for a ticket", () => {
    const result = profileSchema.safeParse(form({ fullName: "Keala", firstName: "K".repeat(31) }));
    expect(result.success).toBe(false);
  });

  it("reads unticked checkboxes as false", () => {
    const result = profileSchema.parse(form({ fullName: "Keala", orderReadyEmail: "on" }));
    expect(result).toMatchObject({
      orderReadyEmail: true,
      marketingOptIn: false,
      smsOptIn: false,
      firstName: null,
    });
  });
});

describe("echoValues", () => {
  it("never echoes a password back to the browser", () => {
    const data = new FormData();
    data.set("email", "a@b.co");
    data.set("password", "secret-1");
    data.set("confirmPassword", "secret-1");
    data.set("$ACTION_ID_abc", "");
    expect(echoValues(data)).toEqual({ email: "a@b.co" });
  });
});
