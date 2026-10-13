/**
 * `npm run push:keys`: makes the VAPID key pair Web Push needs and writes it
 * to .env.local (no account anywhere: VAPID keys are just an EC P-256 key
 * pair we generate ourselves).
 *
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY  sent to browsers when they subscribe
 *   VAPID_PRIVATE_KEY             signs every push (server only, secret)
 *   VAPID_SUBJECT                 a contact for the push services, mailto: or https:
 *
 * Keys already in .env.local are kept: every subscription is tied to the
 * public key, so new keys silently cut off every device that turned
 * notifications on. `-- --force` replaces them anyway; `-- --print` only
 * prints a new pair (for the Vercel project's environment variables).
 * `-- --subject mailto:you@example.com` sets the contact.
 *
 * Restart `npm run dev` afterwards: Next reads .env.local at start.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import webpush from "web-push";

const ENV_FILE = ".env.local";
const DEFAULT_SUBJECT = "mailto:notifications@drincup.test";

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : true;
}

const force = option("force") === true;
const printOnly = option("print") === true;
const subjectArg = option("subject");

if (typeof subjectArg === "string" && !/^(mailto:\S+@\S+|https:\/\/\S+)$/.test(subjectArg)) {
  console.error("[push:keys] --subject must be a mailto: address or an https: URL.");
  process.exit(1);
}

const keys = webpush.generateVAPIDKeys();

if (printOnly) {
  console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${keys.publicKey}`);
  console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
  console.log(`VAPID_SUBJECT=${typeof subjectArg === "string" ? subjectArg : DEFAULT_SUBJECT}`);
  process.exit(0);
}

const original = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
const lines = original.split(/\r?\n/);
const current = (name) => lines.find((line) => line.startsWith(`${name}=`))?.slice(name.length + 1).trim() ?? "";

if (current("NEXT_PUBLIC_VAPID_PUBLIC_KEY") && current("VAPID_PRIVATE_KEY") && !force) {
  console.log("[push:keys] .env.local already has VAPID keys; keeping them.");
  console.log("[push:keys] New keys would cut off every device that turned notifications on. Use -- --force to replace them anyway.");
  process.exit(0);
}

const values = {
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: keys.publicKey,
  VAPID_PRIVATE_KEY: keys.privateKey,
  VAPID_SUBJECT: typeof subjectArg === "string" ? subjectArg : current("VAPID_SUBJECT") || DEFAULT_SUBJECT,
};

let output = lines;
for (const [name, value] of Object.entries(values)) {
  const index = output.findIndex((line) => line.startsWith(`${name}=`));
  if (index === -1) {
    if (!output.some((line) => line.startsWith("# ---- Push notifications"))) {
      output = [...output.filter((line, i) => !(i === output.length - 1 && line === "")), "", "# ---- Push notifications (npm run push:keys) ----"];
    }
    output.push(`${name}=${value}`);
  } else {
    output[index] = `${name}=${value}`;
  }
}

writeFileSync(ENV_FILE, `${output.join("\n").replace(/\n+$/, "")}\n`);
console.log(`[push:keys] Wrote a new VAPID key pair to ${ENV_FILE}${force ? " (replacing the old one)" : ""}.`);
console.log(`[push:keys] Subject: ${values.VAPID_SUBJECT}. Use the cafe's real contact before launch (-- --subject mailto:...).`);
console.log("[push:keys] Restart npm run dev. For production, set the same three variables in the Vercel project.");
