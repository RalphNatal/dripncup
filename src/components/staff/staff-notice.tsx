import Link from "next/link";

/** A full-width message in place of the queue: not rostered, nothing open today. */
export function StaffNotice({
  title,
  body,
  actionHref,
  actionLabel,
}: {
  title: string;
  body: string;
  actionHref: string;
  actionLabel: string;
}) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-4 rounded-3xl border bg-card p-8" role="alert">
      <h1 className="font-heading text-3xl font-extrabold">{title}</h1>
      <p className="text-lg">{body}</p>
      <Link
        href={actionHref}
        className="focus-ring inline-flex min-h-14 items-center rounded-2xl bg-primary px-6 text-lg font-bold text-primary-foreground"
      >
        {actionLabel}
      </Link>
    </div>
  );
}
