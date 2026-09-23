import type { Metadata } from "next";
import Link from "next/link";

import { SignUpForm } from "@/components/auth/auth-forms";
import { safeNextPath } from "@/lib/auth/redirect";
import { BRAND } from "@/lib/brand";
import { firstParam, type SearchParams } from "@/lib/search-params";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignUpPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeNextPath(firstParam(params.next));

  return (
    <>
      <h1 className="text-2xl font-extrabold">Create your account</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Order ahead, skip the line, and start earning {BRAND.loyaltyProgramName}.
      </p>

      <div className="mt-6">
        <SignUpForm next={next} />
      </div>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href={next === "/" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(next)}`}
          className="font-semibold text-brand-teal-deep underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </>
  );
}
