import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminPageHeader } from "@/components/admin/page-header";
import { AdjustPointsForm } from "@/components/admin/reward-forms";
import { isUuid } from "@/lib/admin/guard";
import { requireRole } from "@/lib/auth/dal";
import { memberActivity } from "@/lib/rewards/admin";
import { formatMemberCode, formatPoints } from "@/lib/rewards/model";
import { createClient } from "@/lib/supabase/server";
import { formatCafeDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Member · Admin" };

const TYPE_LABEL: Record<string, string> = {
  earn: "Earned",
  redeem: "Redeemed",
  release: "Returned",
  reverse: "Reversed after a refund",
  adjust: "Adjusted",
  expire: "Expired",
};

type Params = Promise<{ id: string }>;

export default async function MemberPage({ params }: { params: Params }) {
  const { id } = await params;
  await requireRole(["admin"], `/admin/rewards/members/${id}`);
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data: member } = await supabase.from("profiles").select("id, full_name, email, member_code, loyalty_points, deleted_at").eq("id", id).maybeSingle();
  if (!member || member.deleted_at) notFound();
  const activity = await memberActivity(id);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <AdminPageHeader
        backHref="/admin/rewards/members"
        backLabel="Members"
        title={member.full_name || member.email || "Member"}
        description={
          <>
            {member.email} · code <code>{formatMemberCode(member.member_code)}</code> ·{" "}
            <Link href={`/admin/users/${id}`} className="font-semibold text-brand-teal-deep underline">
              User details
            </Link>
          </>
        }
      />
      <div className="rounded-3xl border bg-card p-5">
        <p className="text-sm font-semibold text-muted-foreground">Balance</p>
        <p className="tabular font-heading text-4xl font-extrabold" data-testid="member-balance">
          {formatPoints(member.loyalty_points)}
        </p>
      </div>
      <AdjustPointsForm userId={id} balance={member.loyalty_points} />
      <section aria-labelledby="activity" className="space-y-3">
        <h2 id="activity" className="text-xl font-bold">
          Activity
        </h2>
        {activity.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">No points activity yet.</p>
        ) : (
          <ul className="divide-y rounded-3xl border bg-card" data-testid="member-activity">
            {activity.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-2 px-4 py-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">{TYPE_LABEL[entry.type] ?? entry.type}</span>
                  {entry.orderNumber ? (
                    <>
                      {" · "}
                      <Link href={`/admin/orders/${entry.orderId}`} className="text-brand-teal-deep underline-offset-2 hover:underline">
                        {entry.orderNumber}
                      </Link>
                    </>
                  ) : null}
                  {entry.type === "adjust" && entry.description ? <span className="block text-muted-foreground">“{entry.description}”{entry.by ? ` · by ${entry.by}` : ""}</span> : null}
                  <span className="block text-xs text-muted-foreground">{formatCafeDateTime(new Date(entry.createdAt))}</span>
                </span>
                <span className={`tabular font-bold ${entry.points < 0 ? "text-destructive" : "text-brand-teal-deep"}`}>{formatPoints(entry.points, { signed: true })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
