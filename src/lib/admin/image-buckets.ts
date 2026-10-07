/** The Storage buckets admin uploads may go to (public read, admin write). */
export const IMAGE_BUCKETS = ["collection-banners", "location-images", "product-images"] as const;
export type ImageBucket = (typeof IMAGE_BUCKETS)[number];

/** The buckets' own limits (the upload action and Storage both enforce them). */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
