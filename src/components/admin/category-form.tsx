"use client";

/** Add or edit a menu category, in a dialog. */
import { LoaderCircle, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { saveCategoryAction } from "@/lib/menu-admin/actions";

import { AdminField, inputClass, textareaClass } from "./form-layout";

export interface CategoryValues {
  id: string | null;
  name: string;
  slug: string;
  description: string;
  isActive: boolean;
}

export function CategoryDialog({ initial }: { initial: CategoryValues }) {
  const id = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      const result = await saveCategoryAction(values);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? { name: result.message });
        toast.error(result.message);
        return;
      }
      toast.success(result.message ?? "Saved.");
      setOpen(false);
      if (!initial.id) setValues(initial);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {initial.id ? (
          <button type="button" className="focus-ring inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm font-semibold text-brand-teal-deep hover:underline">
            <Pencil className="size-4" aria-hidden="true" />
            Edit<span className="sr-only"> {initial.name}</span>
          </button>
        ) : (
          <button type="button" className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-teal-deep px-5 text-sm font-semibold text-white">
            <Plus className="size-4" aria-hidden="true" />
            New category
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="rounded-3xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl font-extrabold">{initial.id ? "Edit category" : "New category"}</DialogTitle>
          <DialogDescription>Categories are the sections of the menu.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4" noValidate>
          <AdminField id={`${id}-name`} label="Name" error={errors.name}>
            <input id={`${id}-name`} value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} maxLength={60} className={inputClass} />
          </AdminField>
          <AdminField id={`${id}-slug`} label="Web address" hint="Leave blank to make one from the name." error={errors.slug}>
            <input id={`${id}-slug`} value={values.slug} onChange={(e) => setValues({ ...values, slug: e.target.value.toLowerCase() })} maxLength={80} className={inputClass} />
          </AdminField>
          <AdminField id={`${id}-description`} label="Description" hint="Optional, shown under the section title.">
            <textarea id={`${id}-description`} value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} maxLength={300} className={textareaClass} />
          </AdminField>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" checked={values.isActive} onChange={(e) => setValues({ ...values, isActive: e.target.checked })} className="size-5 accent-[var(--brand-teal-deep)]" />
            <span>
              <span className="font-semibold">On the menu</span>
              <span className="block text-muted-foreground">Switched off hides the whole section and its products.</span>
            </span>
          </label>
          <button type="submit" disabled={pending} className="focus-ring inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-brand-teal-deep px-5 text-sm font-semibold text-white disabled:opacity-60">
            {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
            Save
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
