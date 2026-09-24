/**
 * Random ids made in the browser (idempotency keys, cart line ids).
 *
 * crypto.randomUUID only exists in secure contexts, and testing on a phone
 * over the LAN (http://192.168.x.x) is not one; the fallback keeps checkout
 * working there. Output is always [A-Za-z0-9-], at least 16 characters.
 */
export function newClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const random = Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join("");
  return `id-${Date.now().toString(36)}-${random}`;
}
