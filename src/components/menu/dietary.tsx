/**
 * Allergen and dietary labels. The words come from the database enums, so
 * this is presentation of the schema, not menu content: a new product needs
 * no change here.
 */
import { Bean, Coffee, Egg, Leaf, Milk, MilkOff, Moon, Nut, NutOff, Sprout, Vegan, Wheat, WheatOff, type LucideIcon } from "lucide-react";

import type { Allergen, DietaryTag } from "@/lib/menu/model";
import { cn } from "@/lib/utils";

export const ALLERGENS: Record<Allergen, { label: string; Icon: LucideIcon }> = {
  dairy: { label: "Dairy", Icon: Milk },
  tree_nuts: { label: "Tree nuts", Icon: Nut },
  macadamia: { label: "Macadamia", Icon: Nut },
  peanuts: { label: "Peanuts", Icon: Nut },
  gluten: { label: "Gluten", Icon: Wheat },
  soy: { label: "Soy", Icon: Bean },
  egg: { label: "Egg", Icon: Egg },
  sesame: { label: "Sesame", Icon: Sprout },
};

export const DIETARY: Record<DietaryTag, { label: string; Icon: LucideIcon }> = {
  vegan: { label: "Vegan", Icon: Vegan },
  vegetarian: { label: "Vegetarian", Icon: Leaf },
  dairy_free: { label: "Dairy-free", Icon: MilkOff },
  gluten_free: { label: "Gluten-free", Icon: WheatOff },
  nut_free: { label: "Nut-free", Icon: NutOff },
  contains_caffeine: { label: "Caffeine", Icon: Coffee },
  decaf: { label: "Decaf", Icon: Moon },
};

/** "Contains dairy, macadamia" -- for option rows and screen readers. */
export function allergenSentence(allergens: readonly Allergen[]): string | null {
  if (allergens.length === 0) return null;
  return `Contains ${allergens.map((a) => ALLERGENS[a].label.toLowerCase()).join(", ")}`;
}

/** Compact icon row for menu cards; every icon has a text equivalent. */
export function DietaryIcons({
  allergens,
  dietaryTags,
  className,
}: {
  allergens: readonly Allergen[];
  dietaryTags: readonly DietaryTag[];
  className?: string;
}) {
  if (allergens.length === 0 && dietaryTags.length === 0) return null;

  return (
    <ul aria-label="Dietary and allergen info" className={cn("flex flex-wrap items-center gap-1", className)}>
      {dietaryTags.map((tag) => {
        const { label, Icon } = DIETARY[tag];
        return (
          <li key={tag} title={label} className="flex size-6 items-center justify-center rounded-full bg-brand-teal-soft text-brand-teal-deep">
            <Icon className="size-3.5" aria-hidden="true" />
            <span className="sr-only">{label}</span>
          </li>
        );
      })}
      {allergens.map((allergen) => {
        const { label, Icon } = ALLERGENS[allergen];
        return (
          <li
            key={allergen}
            title={`Contains ${label.toLowerCase()}`}
            className="flex size-6 items-center justify-center rounded-full bg-brand-pink-soft text-brand-magenta-deep"
          >
            <Icon className="size-3.5" aria-hidden="true" />
            <span className="sr-only">Contains {label.toLowerCase()}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Full labelled chips for the product sheet. */
export function DietaryChips({ allergens, dietaryTags }: { allergens: readonly Allergen[]; dietaryTags: readonly DietaryTag[] }) {
  if (allergens.length === 0 && dietaryTags.length === 0) return null;

  return (
    <div className="space-y-2">
      {dietaryTags.length > 0 ? (
        <ul aria-label="Dietary" className="flex flex-wrap gap-1.5">
          {dietaryTags.map((tag) => {
            const { label, Icon } = DIETARY[tag];
            return (
              <li key={tag} className="inline-flex items-center gap-1 rounded-full bg-brand-teal-soft px-2.5 py-1 text-xs font-semibold text-secondary-foreground">
                <Icon className="size-3.5" aria-hidden="true" />
                {label}
              </li>
            );
          })}
        </ul>
      ) : null}
      {allergens.length > 0 ? (
        <p className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-semibold">Allergens:</span>
          {allergens.map((allergen) => {
            const { label, Icon } = ALLERGENS[allergen];
            return (
              <span key={allergen} className="inline-flex items-center gap-1 rounded-full bg-brand-pink-soft px-2.5 py-1 font-semibold text-accent-foreground">
                <Icon className="size-3.5" aria-hidden="true" />
                {label}
              </span>
            );
          })}
        </p>
      ) : null}
    </div>
  );
}
