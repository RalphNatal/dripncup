"use server";

/**
 * Favourites ("My usual"): save from the product sheet or from a line of a
 * past order, rename, delete, and check one before it goes in the cart.
 *
 * Writes go through the customer's own session, so RLS keeps every row
 * theirs; the database also enforces the 40-character name and the cap of 50.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentProfile } from "@/lib/auth/dal";
import { snapshotFromSelected, type SnapshotModifier } from "@/lib/orders/detail";
import type { LineReview } from "@/lib/orders/reorder";
import { loadReviewContext } from "@/lib/orders/review-context";
import { resolveSelection, validateSelection } from "@/lib/pricing";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

import { FAVORITE_SELECT, savedLineOf, type FavoriteRow } from "./queries";
import { favoriteErrorMessage, favoriteNameSchema, saveFavoriteSchema, type SaveFavoriteInput } from "./schemas";

export type FavoriteResult = { ok: true; id: string; name: string } | { ok: false; signedOut?: true; message: string };

const SIGNED_OUT: FavoriteResult = { ok: false, signedOut: true, message: "Sign in to save favorites." };

function refresh() {
  revalidatePath("/account/favorites");
  revalidatePath("/menu");
  revalidatePath("/");
}

async function insertFavorite(
  userId: string,
  values: {
    name: string;
    productId: string;
    sizeId: string | null;
    sizeName: string | null;
    modifiers: SnapshotModifier[];
    specialInstructions: string | null;
  },
): Promise<FavoriteResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("favorites")
    .insert({
      user_id: userId,
      name: values.name,
      product_id: values.productId,
      product_size_id: values.sizeId,
      size_name: values.sizeName,
      modifiers: values.modifiers as unknown as Json,
      quantity: 1,
      special_instructions: values.specialInstructions || null,
    })
    .select("id, name")
    .single();
  if (error || !data) return { ok: false, message: favoriteErrorMessage(error?.code) };
  refresh();
  return { ok: true, id: data.id, name: data.name };
}

/**
 * From the product sheet, after customising. The choices must make a valid
 * drink on today's menu (a sold-out option is fine: it is a favourite, not an
 * order); they are stored as the same snapshot an order line keeps.
 */
export async function saveFavoriteAction(input: SaveFavoriteInput): Promise<FavoriteResult> {
  const profile = await getCurrentProfile();
  if (!profile) return SIGNED_OUT;

  const parsed = saveFavoriteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the name and try again." };
  const { name, productId, sizeId, selection, specialInstructions } = parsed.data;

  const context = await loadReviewContext();
  const detail = context?.detailFor(productId);
  if (!detail) return { ok: false, message: "This item is no longer on the menu." };

  const errors = validateSelection(detail.product, detail.groups, { sizeId, modifiers: selection, specialInstructions }).filter(
    (e) => e.code !== "product_sold_out" && e.code !== "option_sold_out",
  );
  if (errors.length > 0) return { ok: false, message: `Finish your choices first: ${errors[0].message}` };

  const size = detail.product.sizes.find((s) => s.id === sizeId) ?? null;
  return insertFavorite(profile.id, {
    name,
    productId,
    sizeId: size?.id ?? null,
    sizeName: size?.name ?? null,
    modifiers: snapshotFromSelected(resolveSelection(detail.groups, selection)),
    specialInstructions,
  });
}

/** From any line of one of the customer's own orders, exactly as it was made. */
export async function saveFavoriteFromOrderItemAction(itemId: unknown, name: unknown): Promise<FavoriteResult> {
  const profile = await getCurrentProfile();
  if (!profile) return SIGNED_OUT;
  if (!z.guid().safeParse(itemId).success) return { ok: false, message: "That item couldn't be found." };
  const parsedName = favoriteNameSchema.safeParse(name);
  if (!parsedName.success) return { ok: false, message: parsedName.error.issues[0].message };

  const supabase = await createClient();
  const { data: item } = await supabase
    .from("order_items")
    .select("product_id, product_size_id, size_name, modifiers, special_instructions, orders!inner(user_id)")
    .eq("id", itemId as string)
    .maybeSingle();
  // RLS lets staff read items at their location; a favourite comes only from your own order.
  if (!item || item.orders.user_id !== profile.id) return { ok: false, message: "That item couldn't be found." };
  if (!item.product_id) return { ok: false, message: "This item is no longer on the menu, so it can't be saved." };

  return insertFavorite(profile.id, {
    name: parsedName.data,
    productId: item.product_id,
    sizeId: item.product_size_id,
    sizeName: item.size_name,
    modifiers: Array.isArray(item.modifiers) ? (item.modifiers as unknown as SnapshotModifier[]) : [],
    specialInstructions: item.special_instructions,
  });
}

export async function renameFavoriteAction(favoriteId: unknown, name: unknown): Promise<FavoriteResult> {
  const profile = await getCurrentProfile();
  if (!profile) return SIGNED_OUT;
  if (!z.guid().safeParse(favoriteId).success) return { ok: false, message: "That favorite couldn't be found." };
  const parsedName = favoriteNameSchema.safeParse(name);
  if (!parsedName.success) return { ok: false, message: parsedName.error.issues[0].message };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("favorites")
    .update({ name: parsedName.data })
    .eq("id", favoriteId as string)
    .select("id, name")
    .maybeSingle();
  if (error) return { ok: false, message: favoriteErrorMessage(error.code) };
  if (!data) return { ok: false, message: "That favorite couldn't be found." };
  refresh();
  return { ok: true, id: data.id, name: data.name };
}

export async function deleteFavoriteAction(favoriteId: unknown): Promise<{ ok: boolean; message?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Sign in to manage favorites." };
  if (!z.guid().safeParse(favoriteId).success) return { ok: false, message: "That favorite couldn't be found." };

  const supabase = await createClient();
  const { error } = await supabase.from("favorites").delete().eq("id", favoriteId as string);
  if (error) return { ok: false, message: "We couldn't remove it. Please try again." };
  refresh();
  return { ok: true };
}

/**
 * A favourite checked against the live menu right before it goes in the
 * cart: the line to add at today's price, or why it can't be added now.
 */
export async function reviewFavoriteAction(
  favoriteId: unknown,
): Promise<{ review: LineReview; ordering: { canOrder: boolean; reason: string | null } } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Sign in to use your favorites." };
  if (!z.guid().safeParse(favoriteId).success) return { error: "That favorite couldn't be found." };

  const supabase = await createClient();
  const [{ data }, context] = await Promise.all([
    supabase.from("favorites").select(FAVORITE_SELECT).eq("id", favoriteId as string).maybeSingle(),
    loadReviewContext(),
  ]);
  if (!data) return { error: "That favorite couldn't be found." };
  if (!context) return { error: "Ordering isn't set up yet." };

  return {
    review: context.review(savedLineOf(data as unknown as FavoriteRow)),
    ordering: { canOrder: context.location.status.canOrder, reason: context.location.status.unavailableReason },
  };
}
