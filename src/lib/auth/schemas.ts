/**
 * Zod schemas for every auth and account form.
 *
 * They parse raw `FormData` entries (strings, or null when a field is absent),
 * so the server actions can run them directly. The browser only gets HTML
 * attributes like `required` and `minLength`; these are the real check.
 */
import { z } from "zod";

/** Supabase hashes with bcrypt, which ignores everything past 72 bytes. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

/** FormData gives null for a missing field; treat it as an empty string. */
const text = () => z.preprocess((value) => value ?? "", z.string().trim());

/** Optional free text: blank becomes null so the column is cleared, not "". */
const optionalText = (max: number, label: string) =>
  text()
    .pipe(z.string().max(max, { error: `${label} must be ${max} characters or fewer.` }))
    .transform((value) => (value === "" ? null : value));

/**
 * A checkbox submits "on" when ticked and nothing at all when not. Must be a
 * preprocess: in Zod 4 an absent key fails `z.unknown().transform()`.
 */
const checkbox = () => z.preprocess((value) => value === "on" || value === "true", z.boolean());

const email = () =>
  text().pipe(
    z
      .email({ error: "Enter a valid email address." })
      .max(254, { error: "That email address is too long." })
      .transform((value) => value.toLowerCase()),
  );

const newPassword = () =>
  z.preprocess(
    (value) => value ?? "",
    z
      .string()
      .min(PASSWORD_MIN_LENGTH, {
        error: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
      })
      .max(PASSWORD_MAX_LENGTH, {
        error: `Use ${PASSWORD_MAX_LENGTH} characters or fewer.`,
      }),
  );

/**
 * Loose on purpose: visitors type numbers every which way. Digits, spaces and
 * the usual punctuation, with 7-15 digits (the E.164 maximum).
 */
const phone = () =>
  optionalText(32, "Phone number").refine(
    (value) => {
      if (value === null) return true;
      if (!/^[+\d\s().-]+$/.test(value)) return false;
      const digits = value.replace(/\D/g, "").length;
      return digits >= 7 && digits <= 15;
    },
    { error: "Enter a valid phone number." },
  );

export const signInSchema = z.object({
  email: email(),
  // Never length-check an existing password: the rules may have changed since
  // it was set, and the auth server is the judge.
  password: text().pipe(z.string().min(1, { error: "Enter your password." })),
});

export const signUpSchema = z.object({
  fullName: text().pipe(
    z
      .string()
      .min(1, { error: "Tell us your name." })
      .max(100, { error: "Name must be 100 characters or fewer." }),
  ),
  email: email(),
  password: newPassword(),
  phone: phone(),
  // Off unless the customer ticks it.
  marketingOptIn: checkbox(),
});

export const forgotPasswordSchema = z.object({
  email: email(),
});

export const newPasswordSchema = z
  .object({
    password: newPassword(),
    confirmPassword: z.preprocess((value) => value ?? "", z.string()),
  })
  .refine((values) => values.password === values.confirmPassword, {
    error: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export const profileSchema = z.object({
  fullName: text().pipe(
    z
      .string()
      .min(1, { error: "Tell us your name." })
      .max(100, { error: "Name must be 100 characters or fewer." }),
  ),
  // Called out on the barista's ticket, so it stays short.
  firstName: optionalText(30, "Name for your cup"),
  phone: phone(),
  marketingOptIn: checkbox(),
  smsOptIn: checkbox(),
  orderReadyEmail: checkbox(),
  orderReadyPush: checkbox(),
});

/** What the customer must type to confirm account deletion. Case-sensitive. */
export const DELETE_CONFIRMATION = "DELETE";

export const deleteAccountSchema = z.object({
  // Same handling as sign-in, so whatever signs them in also confirms here.
  password: text().pipe(z.string().min(1, { error: "Enter your password." })),
  confirmation: text().pipe(
    z.string().refine((value) => value === DELETE_CONFIRMATION, {
      error: `Type ${DELETE_CONFIRMATION} in capitals to confirm.`,
    }),
  ),
});

/** Field name -> first error message, ready to render under each input. */
export type FieldErrors = Partial<Record<string, string>>;

export function firstFieldErrors(error: z.ZodError): FieldErrors {
  const flat = z.flattenError(error).fieldErrors as Record<string, string[] | undefined>;
  const result: FieldErrors = {};
  for (const [field, messages] of Object.entries(flat)) {
    if (messages?.[0]) result[field] = messages[0];
  }
  return result;
}
