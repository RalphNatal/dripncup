import type { Metadata } from "next";

import { ActionButton } from "@/components/admin/action-button";
import { MenuNav } from "@/components/admin/menu-nav";
import { AdminPageHeader } from "@/components/admin/page-header";
import { SoldOutLauncher } from "@/components/admin/sold-out-launcher";
import { requireRole } from "@/lib/auth/dal";
import { appNow } from "@/lib/clock";
import { openingHours } from "@/lib/locations/opening-hours";
import { clearSoldOutAction } from "@/lib/menu-admin/actions";
import { createClient } from "@/lib/supabase/server";
import { addDays, cafeDateKey, formatCafeDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Sold out · Admin" };

/** What is sold out at each counter right now, and a way to change it. */
export default async function SoldOutPage() {
  await requireRole(["admin"], "/admin/menu/sold-out");
  const now = await appNow();
  const supabase = await createClient();
  const [locations, flags, hours, closures] = await Promise.all([
    supabase.from("locations").select("id, name, type, ends_at").eq("is_active", true).order("type").order("starts_at", { nullsFirst: true }),
    supabase
      .from("location_availability")
      .select("location_id, product_id, modifier_option_id, is_available, available_from, updated_at, product:products(name), option:modifier_options(name, group:modifier_groups(name))"),
    supabase.from("location_hours").select("location_id, day_of_week, opens_at, closes_at"),
    supabase.from("closures").select("location_id, closure_date, is_closed, opens_at, closes_at, reason").gte("closure_date", cafeDateKey(now)).lte("closure_date", cafeDateKey(addDays(now, 15))),
  ]);
  const live = (locations.data ?? []).filter((l) => l.type === "cafe" || (l.ends_at && new Date(l.ends_at) > now));
  const current = (flags.data ?? []).filter((f) => !f.is_available && (!f.available_from || new Date(f.available_from) > now));

  return (
    <div className="mx-auto max-w-5xl">
      <AdminPageHeader title="Sold out" description="What each counter has marked sold out right now. Staff change this from their screen too." />
      <MenuNav current="/admin/menu/sold-out" />
      <div className="space-y-5">
        {live.map((location) => {
          const opening = openingHours(
            (hours.data ?? []).filter((h) => h.location_id === location.id),
            closures.data,
          );
          const items = current.filter((f) => f.location_id === location.id);
          return (
            <section key={location.id} aria-labelledby={`loc-${location.id}`} className="rounded-3xl border bg-card p-5" data-testid="sold-out-location">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id={`loc-${location.id}`} className="text-lg font-bold">
                  {location.name}
                </h2>
                <SoldOutLauncher location={{ id: location.id, name: location.name, type: location.type, hours: opening.hours, closures: opening.closures }} />
              </div>
              {items.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">Nothing sold out.</p>
              ) : (
                <ul className="mt-3 divide-y">
                  {items.map((flag) => {
                    const name = flag.product?.name ?? (flag.option ? `${flag.option.name} (${flag.option.group?.name ?? "option"})` : "Item");
                    return (
                      <li key={`${flag.product_id ?? flag.modifier_option_id}`} className="flex flex-wrap items-center gap-2 py-2">
                        <span className="min-w-0 flex-1 text-sm">
                          <span className="font-semibold">{name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {flag.available_from ? `Back by itself ${formatCafeDateTime(new Date(flag.available_from))}` : "Until someone turns it back on"}
                          </span>
                        </span>
                        <ActionButton
                          size="sm"
                          action={clearSoldOutAction.bind(null, location.id, flag.product_id ? "product" : "option", (flag.product_id ?? flag.modifier_option_id)!)}
                        >
                          Back on<span className="sr-only"> {name}</span>
                        </ActionButton>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
