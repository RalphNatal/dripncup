/**
 * Site content the owner edits from /admin/content: what each item is and
 * how it is checked. Pure; admin_save_content() checks the same rules.
 */
export type ContentKey =
  | "about"
  | "contact_phone"
  | "contact_email"
  | "instagram_url"
  | "facebook_url"
  | "logo_path"
  | "privacy_policy"
  | "terms"
  | "refund_policy";

export interface ContentItem {
  key: ContentKey;
  label: string;
  help: string;
  kind: "long" | "phone" | "email" | "url" | "image";
  maxLength: number;
  /** Where customers see it. */
  shownOn: string;
}

export const CONTENT_ITEMS: readonly ContentItem[] = [
  { key: "about", label: "About page", kind: "long", maxLength: 20000, shownOn: "/about",
    help: "The cafe's story, in plain paragraphs (a blank line starts a new one). Replace the placeholder with the copy from the current website." },
  { key: "contact_phone", label: "Phone number", kind: "phone", maxLength: 14, shownOn: "/about",
    help: "US format, like (808) 555-0123. Leave blank to hide it." },
  { key: "contact_email", label: "Contact email", kind: "email", maxLength: 254, shownOn: "/about",
    help: "Where customers can write to the cafe. Leave blank to hide it." },
  { key: "instagram_url", label: "Instagram", kind: "url", maxLength: 200, shownOn: "/about",
    help: "The profile link, like https://www.instagram.com/drincupcafe. Leave blank to hide it." },
  { key: "facebook_url", label: "Facebook", kind: "url", maxLength: 200, shownOn: "/about",
    help: "The page link, like https://www.facebook.com/drincupcafe. Leave blank to hide it." },
  { key: "logo_path", label: "Logo", kind: "image", maxLength: 200, shownOn: "the header and sign-in pages",
    help: "A JPEG, PNG or WebP, ideally wide and transparent-free. Until one is uploaded, the wordmark is typeset." },
  { key: "privacy_policy", label: "Privacy policy", kind: "long", maxLength: 20000, shownOn: "/privacy",
    help: "Placeholder text until the cafe's reviewed policy is pasted in." },
  { key: "terms", label: "Terms", kind: "long", maxLength: 20000, shownOn: "/terms",
    help: "Placeholder text until the cafe's reviewed terms are pasted in." },
  { key: "refund_policy", label: "Refund & cancellation policy", kind: "long", maxLength: 2000, shownOn: "catering pages and /terms",
    help: "Shown to catering customers before they pay and when they ask to cancel." },
];

export const CONTENT_KEYS = CONTENT_ITEMS.map((c) => c.key);

export function contentItem(key: string): ContentItem | null {
  return CONTENT_ITEMS.find((c) => c.key === key) ?? null;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;

/** The same checks as admin_save_content(), with friendly messages. Null = fine. */
export function contentProblem(item: ContentItem, raw: string): string | null {
  const value = raw.trim();
  switch (item.kind) {
    case "email":
      return value && !EMAIL.test(value) ? "Enter a valid email address." : null;
    case "phone":
      return value && !/^\([2-9]\d{2}\) [2-9]\d{2}-\d{4}$/.test(value) ? "Enter a US phone number, like (808) 555-0123." : null;
    case "url":
      if (!value) return null;
      if (item.key === "instagram_url" && !/^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9_.]+\/?$/i.test(value)) {
        return "Paste the profile link, like https://www.instagram.com/drincupcafe.";
      }
      if (item.key === "facebook_url" && !/^https:\/\/(www\.|m\.)?facebook\.com\/[A-Za-z0-9_.\-/]+$/i.test(value)) {
        return "Paste the page link, like https://www.facebook.com/drincupcafe.";
      }
      return null;
    case "image":
      return null;
    case "long":
      if (value.length < 20) return "Write at least a sentence (20 characters).";
      return value.length > item.maxLength ? `Keep it to ${item.maxLength.toLocaleString("en-US")} characters.` : null;
  }
}

/** "8085550123" or "808-555-0123" -> "(808) 555-0123"; anything else unchanged. */
export function formatPhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : raw.trim();
}

/** Paragraphs from plain text: blank lines separate them. */
export function paragraphs(text: string): string[] {
  return text
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
