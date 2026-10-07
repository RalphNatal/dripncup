"use client";

/**
 * "Order for pickup here": picks the pop-up as the pickup location (the same
 * selectLocation action the location switcher uses, which accepts only a
 * location that is currently offered) and opens its menu.
 */
import { LoaderCircle, ShoppingBag } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { selectLocation } from "@/lib/locations/actions";

export function OrderHereButton({ locationId, name }: { locationId: string; name: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function go() {
    setPending(true);
    try {
      const result = await selectLocation(locationId);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(`Ordering for pickup at ${name}`);
      router.push("/menu");
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void go()}
      disabled={pending}
      className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-teal-deep px-5 text-sm font-semibold text-white hover:bg-brand-teal-deep/90 disabled:opacity-60"
    >
      {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <ShoppingBag className="size-4" aria-hidden="true" />}
      Order for pickup here
    </button>
  );
}
