/**
 * Where product photos live.
 *
 * `products.image_url` holds either a path inside the `product-images`
 * Storage bucket ("latte.webp", what the admin uploader will write) or a full
 * public Storage URL. Paths are expanded to the bucket's public URL so
 * next/image can load them.
 *
 * Only this project's public Storage URLs are used. next.config.ts allows
 * exactly that prefix, and next/image throws on anything else -- so a pasted
 * link to another site falls back to the placeholder rather than breaking
 * the menu page.
 */
export const PRODUCT_IMAGE_BUCKET = "product-images";

const PUBLIC_STORAGE_PATH = "/storage/v1/object/public/";

export function publicStorageUrl(supabaseUrl: string, bucket: string, path: string): string {
  const base = supabaseUrl.replace(/\/+$/, "");
  const cleanPath = path.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
  return `${base}${PUBLIC_STORAGE_PATH}${bucket}/${cleanPath}`;
}

/** A displayable URL for a Storage path or URL, or null to use the placeholder. */
export function storageImageUrl(value: string | null, supabaseUrl: string, bucket: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  if (!/^https?:\/\//i.test(trimmed)) return publicStorageUrl(supabaseUrl, bucket, trimmed);

  try {
    const url = new URL(trimmed);
    const allowed = new URL(supabaseUrl);
    return url.origin === allowed.origin && url.pathname.startsWith(PUBLIC_STORAGE_PATH) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function productImageUrl(imageUrl: string | null, supabaseUrl: string): string | null {
  return storageImageUrl(imageUrl, supabaseUrl, PRODUCT_IMAGE_BUCKET);
}

/**
 * A collection's accent colour, if it is plainly a colour. The value is typed
 * by the owner and ends up in an inline style, so anything that is not a hex,
 * rgb/hsl/oklch function or a colour keyword is dropped rather than risk
 * smuggling extra CSS (`red; background: url(...)`) onto the page.
 */
export function safeCssColor(value: string | null): string | null {
  const color = value?.trim();
  if (!color) return null;
  const hex = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  const fn = /^(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\([\d\s.,%/+-]+\)$/i;
  const keyword = /^[a-z]{3,20}$/i;
  return hex.test(color) || fn.test(color) || keyword.test(color) ? color : null;
}
