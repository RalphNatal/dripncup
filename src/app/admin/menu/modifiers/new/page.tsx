import type { Metadata } from "next";

import { GroupEditor } from "@/components/admin/group-editor";
import { AdminPageHeader } from "@/components/admin/page-header";
import { requireRole } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "New modifier group · Admin" };

export default async function NewGroupPage() {
  await requireRole(["admin"], "/admin/menu/modifiers/new");
  return (
    <div className="mx-auto max-w-4xl">
      <AdminPageHeader backHref="/admin/menu/modifiers" backLabel="Modifiers" title="New modifier group" />
      <GroupEditor
        usedOn={0}
        initial={{
          id: null,
          name: "",
          slug: "",
          description: "",
          selectionType: "single",
          isRequired: false,
          minSelections: "0",
          maxSelections: "",
          maxQuantityPerOption: "1",
          quantityUnit: "",
          chargePerQuantity: true,
          isActive: true,
          options: [{ key: "first", id: null, name: "", description: "", price: "", isDefault: false, maxQuantity: "1", allergens: [] }],
        }}
      />
    </div>
  );
}
