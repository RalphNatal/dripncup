/**
 * Who may open which part of the app.
 *
 * Pure data and functions, so the proxy, the server-side guards and the tests
 * all read the same table. The database enforces the real boundary through
 * RLS; this decides which pages to show or redirect away from.
 */
import type { Enums } from "@/types/database";

export type UserRole = Enums<"user_role">;

const ANY_SIGNED_IN: readonly UserRole[] = ["customer", "staff", "admin"];

/** Prefixes that require a signed-in user, and the roles allowed through. */
export const PROTECTED_ROUTES: readonly { prefix: string; roles: readonly UserRole[] }[] = [
  { prefix: "/admin", roles: ["admin"] },
  { prefix: "/staff", roles: ["staff", "admin"] },
  { prefix: "/account", roles: ANY_SIGNED_IN },
  { prefix: "/orders", roles: ANY_SIGNED_IN },
  // /rewards is public: guests get the programme explained and an invitation.
  { prefix: "/checkout", roles: ANY_SIGNED_IN },
];

/** Pages that make no sense once signed in; the proxy sends users onward. */
export const GUEST_ONLY_ROUTES: readonly string[] = ["/sign-in", "/sign-up"];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** The rule guarding `pathname`, or null for a public page. */
export function findRouteRule(pathname: string) {
  return PROTECTED_ROUTES.find((rule) => matchesPrefix(pathname, rule.prefix)) ?? null;
}

export function isGuestOnlyRoute(pathname: string): boolean {
  return GUEST_ONLY_ROUTES.some((prefix) => matchesPrefix(pathname, prefix));
}

export function roleCanAccess(role: UserRole, pathname: string): boolean {
  const rule = findRouteRule(pathname);
  return rule === null || rule.roles.includes(role);
}

export const ROLE_LABELS: Record<UserRole, string> = {
  customer: "Customer",
  staff: "Staff",
  admin: "Admin",
};
