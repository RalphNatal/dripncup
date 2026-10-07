/**
 * What an import would do, before anything is written: which items it
 * creates, which it changes (and how), which stay as they are, and -- only
 * when the admin ticks "archive items missing from the file" -- which it
 * archives. Pure; the server reads the current menu and passes it in.
 */
import { formatCents } from "@/lib/money";
import type { Enums } from "@/types/database";

import type { ImportPlan, PlanProduct } from "./parse";

export interface ExistingProduct {
  slug: string;
  name: string;
  description: string | null;
  categorySlug: string | null;
  basePriceCents: number;
  isActive: boolean;
  archived: boolean;
  cateringEligible: boolean;
  allergens: Enums<"allergen">[];
  dietaryTags: Enums<"dietary_tag">[];
  /** Live (not archived) sizes, in order. */
  sizes: { name: string; priceCents: number; isDefault: boolean }[];
  groups: { slug: string; whenOptionId: string | null }[];
}

export interface PreviewItem {
  row: number;
  slug: string;
  name: string;
  categoryName: string;
  price: string;
  /** Human sentences: "Price: Medium $6.00 → $6.25". Empty for a new item. */
  changes: string[];
}

export interface ImportPreview {
  newCategories: { slug: string; name: string }[];
  creates: PreviewItem[];
  updates: PreviewItem[];
  unchanged: PreviewItem[];
  archives: { slug: string; name: string }[];
}

export function priceSummary(product: Pick<PlanProduct, "basePriceCents" | "sizes">): string {
  if (product.sizes.length === 0) return formatCents(product.basePriceCents);
  return product.sizes.map((s) => `${s.name}${s.isDefault && product.sizes.length > 1 ? "*" : ""} ${formatCents(s.priceCents)}`).join(" · ");
}

const sameSet = <T>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((x) => b.includes(x));
const label = (tag: string) => tag.replace(/_/g, " ");

function describeChanges(next: PlanProduct, current: ExistingProduct): string[] {
  const changes: string[] = [];
  if (current.archived) changes.push("Restored from the archive");
  if (next.name !== current.name) changes.push(`Name: ${current.name} → ${next.name}`);
  if ((next.description ?? "") !== (current.description ?? "")) changes.push("Description updated");
  if (next.categorySlug !== current.categorySlug) changes.push(`Moved to ${next.categoryName}`);

  if (next.sizes.length === 0 && current.sizes.length === 0) {
    if (next.basePriceCents !== current.basePriceCents) {
      changes.push(`Price: ${formatCents(current.basePriceCents)} → ${formatCents(next.basePriceCents)}`);
    }
  } else if (next.sizes.length === 0 || current.sizes.length === 0) {
    changes.push(`Price: ${priceSummary(current)} → ${priceSummary(next)}`);
  } else {
    for (const size of next.sizes) {
      const old = current.sizes.find((s) => s.name === size.name);
      if (!old) changes.push(`New size: ${size.name} ${formatCents(size.priceCents)}`);
      else if (old.priceCents !== size.priceCents) {
        changes.push(`Price: ${size.name} ${formatCents(old.priceCents)} → ${formatCents(size.priceCents)}`);
      }
    }
    for (const size of current.sizes) {
      if (!next.sizes.some((s) => s.name === size.name)) changes.push(`Size removed: ${size.name}`);
    }
    const nextDefault = next.sizes.find((s) => s.isDefault)?.name;
    const oldDefault = current.sizes.find((s) => s.isDefault)?.name;
    if (nextDefault && oldDefault && nextDefault !== oldDefault && current.sizes.some((s) => s.name === nextDefault)) {
      changes.push(`Default size: ${oldDefault} → ${nextDefault}`);
    }
  }

  const nextGroups = next.groups.map((g) => g.slug);
  const oldGroups = current.groups.map((g) => g.slug);
  if (nextGroups.join() !== oldGroups.join()) {
    const added = nextGroups.filter((g) => !oldGroups.includes(g));
    const removed = oldGroups.filter((g) => !nextGroups.includes(g));
    if (added.length) changes.push(`Modifier groups added: ${added.join(", ")}`);
    if (removed.length) changes.push(`Modifier groups removed: ${removed.join(", ")}`);
    if (!added.length && !removed.length) changes.push("Modifier groups reordered");
  }
  for (const group of next.groups) {
    if (!group.when) continue;
    const old = current.groups.find((g) => g.slug === group.slug);
    if (old?.whenOptionId !== group.when.optionId) changes.push(`${group.slug}: only when ${group.when.optionName}`);
  }

  if (!sameSet(next.allergens, current.allergens)) {
    changes.push(`Allergens: ${next.allergens.map(label).join(", ") || "none"}`);
  }
  if (!sameSet(next.dietaryTags, current.dietaryTags)) {
    changes.push(`Dietary: ${next.dietaryTags.map(label).join(", ") || "none"}`);
  }
  if (next.cateringEligible !== current.cateringEligible) changes.push(next.cateringEligible ? "Now offered for catering" : "No longer offered for catering");
  if (next.active !== current.isActive) changes.push(next.active ? "Switched on" : "Switched off (hidden from customers)");
  return changes;
}

export function previewImport(
  plan: ImportPlan,
  current: { categories: { slug: string }[]; products: ExistingProduct[] },
  { archiveMissing }: { archiveMissing: boolean },
): ImportPreview {
  const preview: ImportPreview = { newCategories: [], creates: [], updates: [], unchanged: [], archives: [] };
  const categorySlugs = new Set(current.categories.map((c) => c.slug));
  preview.newCategories = plan.categories.filter((c) => !categorySlugs.has(c.slug));

  const bySlug = new Map(current.products.map((p) => [p.slug, p]));
  for (const product of plan.products) {
    const item: PreviewItem = {
      row: product.row,
      slug: product.slug,
      name: product.name,
      categoryName: product.categoryName,
      price: priceSummary(product),
      changes: [],
    };
    const existing = bySlug.get(product.slug);
    if (!existing) {
      preview.creates.push(item);
      continue;
    }
    item.changes = describeChanges(product, existing);
    (item.changes.length ? preview.updates : preview.unchanged).push(item);
  }

  if (archiveMissing) {
    const inFile = new Set(plan.products.map((p) => p.slug));
    preview.archives = current.products
      .filter((p) => !p.archived && !inFile.has(p.slug))
      .map((p) => ({ slug: p.slug, name: p.name }));
  }
  return preview;
}
