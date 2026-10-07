/**
 * Limited-time products: `products.available_from` / `available_until`.
 * Outside its window a product is off the menu everywhere availability is
 * checked -- the menu, the product page, cart re-validation, checkout,
 * reorder, favourites and the staff sold-out list -- all through this one
 * function. Pure and safe in the browser (the staff panel uses it).
 */

export interface AvailabilityWindow {
  available_from: string | null;
  available_until: string | null;
}

/** On the menu at `now`: from <= now < until, either side open when null. */
export function isProductAvailableAt(product: AvailabilityWindow, now: Date): boolean {
  const time = now.getTime();
  if (product.available_from && time < Date.parse(product.available_from)) return false;
  if (product.available_until && time >= Date.parse(product.available_until)) return false;
  return true;
}

/** Whether a product has a window at all (to label it "Limited time"). */
export function isLimitedTime(product: AvailabilityWindow): boolean {
  return Boolean(product.available_from || product.available_until);
}

/** The customer-facing reason a saved or carted product is gone. */
export function outOfWindowMessage(product: AvailabilityWindow, now: Date): string {
  if (product.available_from && now.getTime() < Date.parse(product.available_from)) {
    return "This limited-time item isn't on the menu yet.";
  }
  return "This limited-time item is no longer on the menu.";
}
