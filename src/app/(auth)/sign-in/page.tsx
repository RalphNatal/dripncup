import type { Metadata } from "next";
import Link from "next/link";

import { SignInForm } from "@/components/auth/auth-forms";
import { FormAlert } from "@/components/auth/form-fields";
import { safeNextPath } from "@/lib/auth/redirect";
import { firstParam, type SearchParams } from "@/lib/search-params";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeNextPath(firstParam(params.next));
  const linkFailed = firstParam(params.error) === "link";

  return (
    <>
      <h1 className="text-2xl font-extrabold">Welcome back</h1>
      <p className="mt-1 text-sm text-muted-foreground">Sign in to order ahead and earn rewards.</p>

      {linkFailed ? (
        <div className="mt-5">
          <FormAlert
            state={{
              status: "error",
              message:
                "That link has expired or was already used. Sign in, or request a new link.",
            }}
          />
        </div>
      ) : null}

      <div className="mt-6">
        <SignInForm next={next} />
      </div>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        New to Drincup?{" "}
        <Link
          href={next === "/" ? "/sign-up" : `/sign-up?next=${encodeURIComponent(next)}`}
          className="font-semibold text-brand-teal-deep underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </>
  );
}
