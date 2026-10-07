"use client";

/**
 * Pick products from the menu, in order: search to add, move up and down,
 * remove. Used for event menus and collections; `extra` renders per-row
 * controls (a collection's "limited time" box).
 */
import { ArrowDown, ArrowUp, Plus, Search, X } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";

import type { PickerProduct } from "@/lib/events/queries";

export function ProductPicker({
  label,
  products,
  selected,
  onChange,
  extra,
  error,
  hint,
}: {
  label: string;
  products: PickerProduct[];
  selected: string[];
  onChange: (ids: string[]) => void;
  extra?: (product: PickerProduct) => ReactNode;
  error?: string;
  hint?: ReactNode;
}) {
  const id = useId();
  const [search, setSearch] = useState("");
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [];
    return products
      .filter((p) => !selected.includes(p.id) && (p.name.toLowerCase().includes(term) || (p.categoryName ?? "").toLowerCase().includes(term)))
      .slice(0, 8);
  }, [products, search, selected]);

  const move = (index: number, by: -1 | 1) => {
    const next = [...selected];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    onChange(next);
  };

  return (
    <div className="space-y-3 md:col-span-2" data-invalid={error ? true : undefined}>
      <p className="text-sm font-semibold" id={`${id}-label`}>
        {label}
      </p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {selected.length > 0 ? (
        <ol className="space-y-2" aria-labelledby={`${id}-label`}>
          {selected.map((productId, index) => {
            const product = byId.get(productId);
            return (
              <li key={productId} className="flex flex-wrap items-center gap-2 rounded-xl border p-2" data-testid="picked-product">
                <span className="tabular w-6 text-center text-sm text-muted-foreground">{index + 1}</span>
                <span className="min-w-0 flex-1 text-sm font-semibold">
                  {product?.name ?? "Removed product"}
                  {product && !product.isActive ? <span className="ml-1 text-xs font-normal text-destructive">(inactive)</span> : null}
                  {product?.categoryName ? <span className="block text-xs font-normal text-muted-foreground">{product.categoryName}</span> : null}
                </span>
                {product && extra ? extra(product) : null}
                <span className="flex gap-1">
                  <button type="button" onClick={() => move(index, -1)} disabled={index === 0} className="focus-ring inline-flex size-11 items-center justify-center rounded-lg border disabled:opacity-40" aria-label={`Move ${product?.name ?? "item"} up`}>
                    <ArrowUp className="size-4" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => move(index, 1)} disabled={index === selected.length - 1} className="focus-ring inline-flex size-11 items-center justify-center rounded-lg border disabled:opacity-40" aria-label={`Move ${product?.name ?? "item"} down`}>
                    <ArrowDown className="size-4" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => onChange(selected.filter((s) => s !== productId))} className="focus-ring inline-flex size-11 items-center justify-center rounded-lg border text-destructive" aria-label={`Remove ${product?.name ?? "item"}`}>
                    <X className="size-4" aria-hidden="true" />
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">Nothing picked yet.</p>
      )}
      <div className="space-y-1">
        <label htmlFor={`${id}-search`} className="sr-only">
          Search the menu to add
        </label>
        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            id={`${id}-search`}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search the menu to add…"
            className="focus-ring h-11 w-full rounded-xl border bg-background pr-3 pl-9 text-sm"
            aria-describedby={error ? `${id}-error` : undefined}
          />
        </div>
        {matches.length > 0 ? (
          <ul className="divide-y rounded-xl border" aria-label="Matching products">
            {matches.map((product) => (
              <li key={product.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange([...selected, product.id]);
                    setSearch("");
                  }}
                  className="focus-ring flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm hover:bg-muted"
                >
                  <Plus className="size-4 text-brand-teal-deep" aria-hidden="true" />
                  <span className="font-semibold">{product.name}</span>
                  <span className="text-muted-foreground">{product.categoryName}</span>
                  {!product.isActive ? <span className="text-xs text-destructive">(inactive)</span> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : search.trim() ? (
          <p className="text-sm text-muted-foreground">No other products match “{search.trim()}”.</p>
        ) : null}
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-sm font-medium text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
