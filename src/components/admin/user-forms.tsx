"use client";

/** Change a user's role (with the admin's password) and a barista's locations. */
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

import { changeRoleAction, setStaffLocationsAction } from "@/lib/users/admin-actions";
import { cn } from "@/lib/utils";

import { ConfirmDialog } from "./confirm-dialog";
import { inputClass } from "./form-layout";

const ROLES = [
  { id: "customer", label: "Customer", what: "orders for themselves" },
  { id: "staff", label: "Staff", what: "works the counter screen at the locations you assign" },
  { id: "admin", label: "Admin", what: "can change everything in this dashboard" },
] as const;

export function RoleForm({ userId, name, role, isSelf }: { userId: string; name: string; role: "customer" | "staff" | "admin"; isSelf: boolean }) {
  const id = useId();
  const router = useRouter();
  const [next, setNext] = useState(role);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const target = ROLES.find((r) => r.id === next)!;

  if (isSelf) {
    return <p className="text-sm text-muted-foreground">You can&apos;t change your own role. Another admin can.</p>;
  }

  const consequence =
    next === "customer" && role === "staff"
      ? " Their staff locations are removed and the counter screen closes to them."
      : next === "customer" && role === "admin"
        ? " They lose the admin dashboard and the counter screen."
        : next === "admin"
          ? " They get full access to the admin dashboard, including roles, refunds and reports."
          : next === "staff"
            ? " Assign them a location below so they can open the counter screen."
            : "";

  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="text-sm font-semibold">Role</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {ROLES.map((r) => (
            <label key={r.id} className={cn("flex cursor-pointer gap-2 rounded-2xl border p-3 text-sm", next === r.id && "border-brand-teal-deep bg-brand-teal-soft")}>
              <input type="radio" name={`${id}-role`} checked={next === r.id} onChange={() => setNext(r.id)} className="mt-0.5 size-4 accent-[var(--brand-teal-deep)]" />
              <span>
                <span className="font-semibold">
                  {r.label}
                  {r.id === role ? " (now)" : ""}
                </span>
                <span className="block text-muted-foreground">{r.what}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <ConfirmDialog
        trigger={
          <button type="button" disabled={next === role} className="focus-ring inline-flex min-h-11 items-center rounded-full bg-brand-teal-deep px-5 text-sm font-semibold text-white disabled:opacity-50">
            Change role
          </button>
        }
        title={`Make ${name} ${next === "admin" ? "an admin" : next === "staff" ? "staff" : "a customer"}?`}
        description={`${name} ${target.what}.${consequence} Enter your own password to confirm.`}
        confirmLabel="Change role"
        tone={next === "admin" ? "danger" : "primary"}
        confirmDisabled={!password}
        onConfirm={async () => {
          setError(null);
          const result = await changeRoleAction(userId, next, password);
          setPassword("");
          if (!result.ok) {
            setError(result.message);
            toast.error(result.message);
            return false;
          }
          toast.success(result.message ?? "Role changed.");
          router.refresh();
          return true;
        }}
      >
        <div className="space-y-1.5">
          <label htmlFor={`${id}-password`} className="block text-sm font-semibold">
            Your password
          </label>
          <input id={`${id}-password`} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
          {error ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </ConfirmDialog>
    </div>
  );
}

export function StaffLocationsForm({ userId, locations, assigned }: { userId: string; locations: { id: string; name: string; type: "cafe" | "event" }[]; assigned: string[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState(assigned);
  const [pending, setPending] = useState(false);
  const dirty = [...selected].sort().join() !== [...assigned].sort().join();

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        try {
          const result = await setStaffLocationsAction(userId, selected);
          if (!result.ok) return void toast.error(result.message);
          toast.success(result.message ?? "Saved.");
          router.refresh();
        } finally {
          setPending(false);
        }
      }}
      className="space-y-3"
      aria-label="Staff locations"
    >
      <fieldset>
        <legend className="text-sm font-semibold">Can work at</legend>
        <div className="mt-2 space-y-1">
          {locations.map((l) => (
            <label key={l.id} className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(l.id)}
                onChange={(e) => setSelected((s) => (e.target.checked ? [...s, l.id] : s.filter((x) => x !== l.id)))}
                className="size-5 accent-[var(--brand-teal-deep)]"
              />
              {l.name}
              {l.type === "event" ? <span className="text-muted-foreground">(pop-up)</span> : null}
            </label>
          ))}
        </div>
      </fieldset>
      <button type="submit" disabled={!dirty || pending} className="focus-ring inline-flex min-h-11 items-center rounded-full bg-brand-teal-deep px-5 text-sm font-semibold text-white disabled:opacity-50">
        Save locations
      </button>
    </form>
  );
}
