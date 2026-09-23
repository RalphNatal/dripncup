import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";

/** A real form post, so signing out works even before JavaScript loads. */
export function SignOutButton() {
  return (
    <form action={signOut}>
      <Button type="submit" variant="outline" className="h-11 w-full rounded-full text-base">
        <LogOut aria-hidden="true" />
        Sign out
      </Button>
    </form>
  );
}
