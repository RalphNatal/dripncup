import "server-only";

/**
 * Re-checks every cart line against the live catalogue and the location's
 * sold-out list, using the same engine the product sheet used when the line
 * was added. Produces both the per-line issues the cart page shows and the
 * engine inputs checkout prices from.
 */
import type { CartLineInput } from "@/lib/checkout/schemas";
import type { CheckedLine, LineIssue } from "@/lib/checkout/types";
import { getSoldOut } from "@/lib/menu/availability";
import { getLiveCatalog } from "@/lib/menu/catalog";
import { buildProductDetail, type ProductDetail } from "@/lib/menu/model";
import { clientEnv } from "@/lib/env";
import {
  calculateLinePrice,
  describeSelection,
  resolveSelection,
  validateSelection,
  type OrderLineInput,
} from "@/lib/pricing";

export interface EvaluatedCart {
  lines: CheckedLine[];
  /** Engine inputs for the lines with no blocking issue, in cart order. */
  orderLines: (OrderLineInput & { lineId: string; detail: ProductDetail })[];
  /** Sum of current line totals (every line that can still be priced). */
  subtotalCents: number;
  blocked: boolean;
}

export async function evaluateCart(
  lines: readonly CartLineInput[],
  location: { id: string; type: "cafe" | "event"; name: string },
  now: Date = new Date(),
): Promise<EvaluatedCart> {
  const [catalog, soldOut] = await Promise.all([getLiveCatalog(), getSoldOut(location.id, now)]);
  const ctx = { location: { id: location.id, type: location.type }, soldOut, now, supabaseUrl: clientEnv.NEXT_PUBLIC_SUPABASE_URL };

  const checked: CheckedLine[] = [];
  const orderLines: EvaluatedCart["orderLines"] = [];
  let subtotalCents = 0;

  for (const line of lines) {
    const issues: LineIssue[] = [];
    const slug = catalog.products.find((p) => p.id === line.productId)?.slug;
    const detail = slug ? buildProductDetail(catalog, slug, ctx) : null;

    if (!detail) {
      checked.push({
        id: line.id,
        issues: [{ code: "removed", message: "This item is no longer on the menu.", blocking: true }],
        current: null,
      });
      continue;
    }

    if (line.locationId !== location.id) {
      issues.push({
        code: "wrong_location",
        message: `Added for a different pickup location than ${location.name}.`,
        blocking: true,
      });
    }
    if (!detail.onLocationMenu) {
      issues.push({ code: "unavailable_here", message: `Not on the menu at ${location.name}.`, blocking: true });
    }
    if (detail.product.soldOut) {
      issues.push({ code: "sold_out", message: `Sold out at ${location.name} right now.`, blocking: true });
    }

    const selection = { sizeId: line.sizeId, modifiers: line.selection, specialInstructions: line.specialInstructions };
    const errors = validateSelection(detail.product, detail.groups, selection).filter(
      (e) => e.code !== "product_sold_out",
    );
    const soldOutOption = errors.find((e) => e.code === "option_sold_out");
    if (soldOutOption) {
      issues.push({ code: "sold_out", message: soldOutOption.message, blocking: true });
    } else if (errors.length > 0) {
      issues.push({
        code: "invalid_selection",
        message: `Your choices need updating: ${errors[0].message}`,
        blocking: true,
      });
    }

    const size = detail.product.sizes.find((s) => s.id === line.sizeId) ?? null;
    const modifiers = resolveSelection(detail.groups, line.selection);
    let current: CheckedLine["current"] = null;

    // A size that vanished makes the line unpriceable; everything else prices.
    if (!(detail.product.sizes.length > 0 && !size)) {
      const lineTotalCents = calculateLinePrice(detail.product, size, modifiers, line.quantity);
      const unitPriceCents = lineTotalCents / line.quantity;
      current = {
        productName: detail.product.name,
        productSlug: detail.product.slug,
        sizeName: size?.name ?? null,
        summary: describeSelection(size?.name ?? null, modifiers),
        unitPriceCents,
        lineTotalCents,
      };
      subtotalCents += lineTotalCents;

      if (unitPriceCents !== line.unitPriceCents && issues.every((i) => !i.blocking)) {
        issues.push({
          code: "price_changed",
          message: "The price has changed.",
          blocking: false,
          oldPriceCents: line.unitPriceCents,
          newPriceCents: unitPriceCents,
        });
      }
    }

    checked.push({ id: line.id, issues, current });
    if (issues.every((i) => !i.blocking)) {
      orderLines.push({
        lineId: line.id,
        categoryId: detail.product.categoryId,
        detail,
        product: detail.product,
        groups: detail.groups,
        selection,
        quantity: line.quantity,
      });
    }
  }

  return {
    lines: checked,
    orderLines,
    subtotalCents,
    blocked: checked.some((l) => l.issues.some((i) => i.blocking)),
  };
}
