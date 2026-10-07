import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionButton } from "@/components/admin/action-button";
import { AdminPageHeader } from "@/components/admin/page-header";
import { StatusPill } from "@/components/admin/status-pill";
import { RoleForm, StaffLocationsForm } from "@/components/admin/user-forms";
import { isUuid } from "@/lib/admin/guard";
import { requireRole } from "@/lib/auth/dal";
import { appNow } from "@/lib/clock";
import { formatCents } from "@/lib/money";
import { ORDER_STATUS_LABEL } from "@/lib/orders/admin";
import { formatMemberCode, formatPoints } from "@/lib/rewards/model";
import { getAdminUser, rosterableLocations } from "@/lib/users/admin";
import { sendPasswordResetAction } from "@/lib/users/admin-actions";
import { formatCafeDate, formatCafeDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "User · Admin" };

type Params = Promise<{ id: string }>;

export default async function UserPage({ params }: { params: Params }) {
  const { id } = await params;
  const me = await requireRole(["admin"], `/admin/users/${id}`);
  if (!isUuid(id)) notFound();
  const [user, now] = await Promise.all([getAdminUser(id), appNow()]);
  if (!user) notFound();
  const locations = user.role === "staff" ? await rosterableLocations(now) : [];
  const name = user.fullName || user.email || "This user";

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <AdminPageHeader
        backHref="/admin/users"
        backLabel="Users"
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            {name}
            <StatusPill tone={user.role === "admin" ? "info" : user.role === "staff" ? "good" : "neutral"} testId="user-role">
              {user.role}
            </StatusPill>
          </span>
        }
        description={`${user.email ?? ""} · joined ${formatCafeDate(new Date(user.createdAt))}`}
        actions={
          <ActionButton
            action={sendPasswordResetAction.bind(null, id)}
            confirm={{ title: "Send a password reset email?", description: `${user.email} gets a link to choose a new password. You never see or set it.`, confirmLabel: "Send email" }}
          >
            Send password reset
          </ActionButton>
        }
      />

      <section aria-labelledby="profile" className="grid gap-3 rounded-3xl border bg-card p-5 text-sm sm:grid-cols-3">
        <h2 id="profile" className="sr-only">
          Profile
        </h2>
        <p>
          <span className="block text-muted-foreground">First name (cup)</span>
          {user.firstName ?? "—"}
        </p>
        <p>
          <span className="block text-muted-foreground">Phone</span>
          {user.phone ?? "—"}
        </p>
        <p>
          <span className="block text-muted-foreground">Marketing emails</span>
          {user.marketingOptIn ? "Opted in" : "No"}
        </p>
        <p>
          <span className="block text-muted-foreground">Points</span>
          <Link href={`/admin/rewards/members/${id}`} className="tabular font-semibold text-brand-teal-deep underline">
            {formatPoints(user.points)}
          </Link>
        </p>
        <p>
          <span className="block text-muted-foreground">Member code</span>
          <code>{formatMemberCode(user.memberCode)}</code>
        </p>
      </section>

      <section aria-labelledby="role-heading" className="rounded-3xl border bg-card p-5">
        <h2 id="role-heading" className="mb-3 text-lg font-bold">
          Role
        </h2>
        <RoleForm key={user.role} userId={id} name={name} role={user.role} isSelf={id === me.id} />
      </section>

      {user.role === "staff" ? (
        <section aria-labelledby="locations-heading" className="rounded-3xl border bg-card p-5">
          <h2 id="locations-heading" className="mb-3 text-lg font-bold">
            Staff locations
          </h2>
          <StaffLocationsForm key={user.staffLocations.join()} userId={id} locations={locations} assigned={user.staffLocations} />
        </section>
      ) : null}

      <section aria-labelledby="orders-heading" className="rounded-3xl border bg-card p-5">
        <h2 id="orders-heading" className="mb-3 text-lg font-bold">
          Recent orders
        </h2>
        {user.orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="divide-y text-sm">
            {user.orders.map((o) => (
              <li key={o.id} className="flex flex-wrap justify-between gap-2 py-2">
                <Link href={`/admin/orders/${o.id}`} className="font-mono font-semibold text-brand-teal-deep underline-offset-2 hover:underline">
                  {o.orderNumber}
                </Link>
                <span className="text-muted-foreground">
                  {formatCafeDateTime(new Date(o.createdAt))} · {ORDER_STATUS_LABEL[o.status]} · <span className="tabular">{formatCents(o.totalCents)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="catering-heading" className="rounded-3xl border bg-card p-5">
        <h2 id="catering-heading" className="mb-3 text-lg font-bold">
          Catering requests
        </h2>
        {user.catering.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="divide-y text-sm">
            {user.catering.map((c) => (
              <li key={c.id} className="flex flex-wrap justify-between gap-2 py-2">
                <Link href={`/admin/catering/${c.id}`} className="font-mono font-semibold text-brand-teal-deep underline-offset-2 hover:underline">
                  {c.requestNumber}
                </Link>
                <span className="text-muted-foreground">
                  {formatCafeDateTime(new Date(c.eventAt))} · {c.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-xs text-muted-foreground">Accounts are deleted by their owners from their Account page. Admin-initiated deletion is on the post-launch list.</p>
    </div>
  );
}
