"use server";

/**
 * Admin image uploads: collection banners and event photos (and, in Phase 9,
 * menu photos).
 *
 *   - admins only (checked here; Storage's policies check again, because the
 *     upload runs with the admin's own session)
 *   - JPEG, PNG or WebP, judged by the file's bytes, not its name or the
 *     type the browser claims; at most 5 MB (the buckets enforce both too)
 *   - re-encoded with sharp: turned upright from its EXIF orientation, then
 *     written without metadata (no GPS position, camera serial or editing
 *     history), at most 2400 px on the long side
 *   - stored under a random name, so an image is never guessable before the
 *     content using it is published
 *
 * Returns the path inside the bucket; that is what the row stores.
 */
import { randomUUID } from "node:crypto";

import { getCurrentProfile } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

import { IMAGE_BUCKETS, IMAGE_MAX_BYTES as MAX_BYTES } from "./image-buckets";

const MAX_EDGE = 2400;

type Kind = "jpeg" | "png" | "webp";

/** The format from the file's first bytes, or null. */
function sniff(bytes: Uint8Array): Kind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return "png";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

export type UploadImageResult = { ok: true; path: string } | { ok: false; message: string };

export async function uploadImageAction(formData: FormData): Promise<UploadImageResult> {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") return { ok: false, message: "Only an admin can upload images." };

  const bucket = formData.get("bucket");
  const file = formData.get("file");
  if (typeof bucket !== "string" || !(IMAGE_BUCKETS as readonly string[]).includes(bucket)) {
    return { ok: false, message: "Unknown image destination." };
  }
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose an image." };
  if (file.size > MAX_BYTES) return { ok: false, message: "That image is over 5 MB. Please choose a smaller one." };

  const input = new Uint8Array(await file.arrayBuffer());
  const kind = sniff(input);
  if (!kind) return { ok: false, message: "Use a JPEG, PNG or WebP image." };

  let output: Buffer;
  try {
    const sharp = (await import("sharp")).default;
    // .rotate() with no angle applies the EXIF orientation; sharp writes no
    // metadata unless asked to keep it.
    const pipeline = sharp(input, { failOn: "error" })
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true });
    output =
      kind === "jpeg"
        ? await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer()
        : kind === "png"
          ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
          : await pipeline.webp({ quality: 85 }).toBuffer();
  } catch {
    return { ok: false, message: "That image couldn't be read. Please try another file." };
  }
  if (output.length > MAX_BYTES) return { ok: false, message: "That image is too large once processed. Please choose a smaller one." };

  const path = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${kind === "jpeg" ? "jpg" : kind}`;
  const supabase = await createClient();
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, output, { contentType: `image/${kind}`, upsert: false, cacheControl: "31536000" });
  if (error) {
    console.error(`Image upload to ${bucket} failed`, error);
    return { ok: false, message: "The upload failed. Please try again." };
  }
  return { ok: true, path };
}
