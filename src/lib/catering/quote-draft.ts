/**
 * The quote builder's editable lines, and how a request or an earlier quote
 * becomes a first draft. Pure, so the admin page (server) can prefill what
 * the builder (browser) edits.
 */
import type { CateringQuoteView, CateringRequestDetail } from "./queries";

export interface DraftLine {
  key: string;
  kind: "product" | "custom";
  productId: string | null;
  sizeId: string | null;
  description: string;
  quantity: string;
  /** Dollars, as typed. */
  unitPrice: string;
}

export const toDollars = (cents: number) => (cents / 100).toFixed(2);

interface PricedProduct {
  id: string;
  name: string;
  basePriceCents: number;
  sizes: { id: string; name: string; priceCents: number }[];
}

/**
 * The starting lines: the current quote's (a revision starts from what was
 * sent), else what the customer asked for at today's menu prices, plus a
 * custom line for a signature drink.
 */
export function initialDraftLines(request: CateringRequestDetail, quote: CateringQuoteView | null, products: PricedProduct[]): DraftLine[] {
  if (quote) {
    return quote.lines.map((line, index) => ({
      key: `q${index}`,
      kind: line.kind,
      productId: line.productId,
      sizeId: line.sizeId,
      description: line.description,
      quantity: String(line.quantity),
      unitPrice: toDollars(line.unitPriceCents),
    }));
  }
  const lines: DraftLine[] = [];
  request.items.forEach((item, index) => {
    const product = item.productId ? products.find((p) => p.id === item.productId) : null;
    if (!product) {
      if (item.name !== "Custom signature drink") return;
      lines.push({
        key: `r${index}`,
        kind: "custom",
        productId: null,
        sizeId: null,
        description: "Signature drink: ",
        quantity: String(item.quantity),
        unitPrice: "0.00",
      });
      return;
    }
    const size = product.sizes.find((s) => s.name === item.sizeName) ?? product.sizes[0] ?? null;
    lines.push({
      key: `r${index}`,
      kind: "product",
      productId: product.id,
      sizeId: size?.id ?? null,
      description: product.name,
      quantity: String(item.quantity),
      unitPrice: toDollars(size?.priceCents ?? product.basePriceCents),
    });
  });
  return lines;
}
