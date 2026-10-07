import type { Metadata } from "next";

import { EventForm } from "@/components/admin/event-form";
import { AdminPageHeader } from "@/components/admin/page-header";
import { requireRole } from "@/lib/auth/dal";
import { appNow } from "@/lib/clock";
import { clientEnv } from "@/lib/env";
import { listPickerProducts, listStaffProfiles } from "@/lib/events/queries";
import { addDays, cafeDateKey } from "@/lib/time";

export const metadata: Metadata = { title: "New event · Admin" };

export default async function NewEventPage() {
  await requireRole(["admin"], "/admin/events/new");
  const [products, staff, now] = await Promise.all([listPickerProducts(), listStaffProfiles(), appNow()]);

  return (
    <div className="mx-auto max-w-4xl">
      <AdminPageHeader title="New pop-up event" backHref="/admin/events" backLabel="Events" />
      <EventForm
        event={null}
        products={products}
        staff={staff}
        supabaseUrl={clientEnv.NEXT_PUBLIC_SUPABASE_URL}
        initial={{
          name: "",
          slug: "",
          description: "",
          addressLine1: "",
          addressLine2: "",
          city: "Honolulu",
          postalCode: "",
          mapUrl: "",
          latitude: "",
          longitude: "",
          date: cafeDateKey(addDays(now, 7)),
          startTime: "10:00",
          endTime: "14:00",
          prepTimeMinutes: "12",
          imagePath: null,
          pickupInstructions: "",
          menu: [],
          staff: [],
        }}
      />
    </div>
  );
}
