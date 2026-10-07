import type { Metadata } from "next";

import { ContentEditor } from "@/components/admin/content-editor";
import { AdminPageHeader } from "@/components/admin/page-header";
import { requireRole } from "@/lib/auth/dal";
import { CONTENT_ITEMS } from "@/lib/content/registry";
import { clientEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Pages & contact · Admin" };

export default async function ContentPage() {
  await requireRole(["admin"], "/admin/content");
  const supabase = await createClient();
  const { data } = await supabase.from("site_content").select("key, value, confirmed_at, updated_at");
  const rows = new Map((data ?? []).map((r) => [r.key, r]));

  return (
    <div className="mx-auto max-w-4xl">
      <AdminPageHeader
        title="Pages & contact"
        description="The About page, contact details, social links, logo and policies customers read. Plain text: a blank line starts a new paragraph."
      />
      <div className="space-y-5">
        {CONTENT_ITEMS.map((item) => {
          const row = rows.get(item.key);
          return (
            <ContentEditor
              key={item.key}
              version={row?.updated_at ?? ""}
              item={item}
              initial={row?.value ?? ""}
              confirmed={Boolean(row?.confirmed_at)}
              supabaseUrl={clientEnv.NEXT_PUBLIC_SUPABASE_URL}
            />
          );
        })}
      </div>
    </div>
  );
}
