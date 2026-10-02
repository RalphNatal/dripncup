/**
 * POST /api/staff/orders/:id/cancel  { "reason": "Out of oat milk" }
 *
 * Cancels a paid order and refunds it, for staff rostered to the order's
 * location and admins: cancelOrderWithRefund(), which re-checks the actor
 * and roster in the database. The staff dashboard (Phase 6) calls this; a
 * paid order cannot be cancelled any other way (advance_order_status
 * refuses). The cancellation email goes out after the response.
 *
 * Session-authenticated, so it accepts only same-origin JSON requests: a
 * cross-site form cannot send JSON, and a cross-site fetch fails the Origin
 * check.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentProfile } from "@/lib/auth/dal";
import { kickOutbox } from "@/lib/email/outbox";
import { cancelOrderWithRefund } from "@/lib/orders/cancel";

const bodySchema = z.object({ reason: z.string().trim().min(3).max(500) });

const STATUS_FOR = { not_found: 404, forbidden: 403, not_cancellable: 409, reason_required: 400 } as const;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin || !request.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  if (profile.role === "customer") return NextResponse.json({ error: "Staff only" }, { status: 403 });

  const { id } = await params;
  if (!z.guid().safeParse(id).success) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Give a reason for cancelling." }, { status: 400 });

  const result = await cancelOrderWithRefund({ orderId: id, reason: body.data.reason, actorId: profile.id });
  if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: STATUS_FOR[result.code] });

  kickOutbox();
  return NextResponse.json({ cancelled: true, refund: result.refund });
}
