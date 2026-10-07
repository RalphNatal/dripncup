"use client";

/**
 * Upload one image to a Storage bucket. The file is checked here for a
 * quick answer (type, 5 MB) and again on the server, which re-encodes it
 * without metadata (src/lib/admin/images.ts). The field holds the stored
 * path; the preview shows what customers will see.
 */
import { ImageUp, LoaderCircle, Trash2 } from "lucide-react";
import Image from "next/image";
import { useId, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { IMAGE_ACCEPT, IMAGE_MAX_BYTES, type ImageBucket } from "@/lib/admin/image-buckets";
import { uploadImageAction } from "@/lib/admin/images";
import { isLoopbackUrl, publicStorageUrl } from "@/lib/menu/images";

export function ImageUploadField({
  label,
  bucket,
  supabaseUrl,
  value,
  onChange,
  hint,
  aspect = "aspect-[3/1]",
  previewAlt,
}: {
  label: string;
  bucket: ImageBucket;
  supabaseUrl: string;
  /** The stored path inside the bucket, or null. */
  value: string | null;
  onChange: (path: string | null) => void;
  hint?: ReactNode;
  /** Tailwind aspect class for the preview. */
  aspect?: string;
  previewAlt: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = value ? publicStorageUrl(supabaseUrl, bucket, value) : null;

  async function upload(file: File) {
    setError(null);
    if (!IMAGE_ACCEPT.split(",").includes(file.type)) return setError("Use a JPEG, PNG or WebP image.");
    if (file.size > IMAGE_MAX_BYTES) return setError("That image is over 5 MB. Please choose a smaller one.");
    setUploading(true);
    try {
      const form = new FormData();
      form.set("bucket", bucket);
      form.set("file", file);
      const result = await uploadImageAction(form);
      if (!result.ok) return setError(result.message);
      onChange(result.path);
      toast.success("Image uploaded. Save to keep it.");
    } catch {
      setError("The upload failed. Please try again.");
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="space-y-2 md:col-span-2">
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
      </label>
      <div className={`relative overflow-hidden rounded-2xl border bg-muted ${aspect}`}>
        {preview ? (
          <Image src={preview} alt={previewAlt} fill sizes="(min-width: 768px) 640px, 100vw" className="object-cover" unoptimized={isLoopbackUrl(preview)} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No image yet</div>
        )}
        {uploading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-background/70" role="status">
            <LoaderCircle className="size-6 animate-spin" aria-hidden="true" />
            <span className="sr-only">Uploading…</span>
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          ref={input}
          id={id}
          type="file"
          accept={IMAGE_ACCEPT}
          className="sr-only"
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={uploading}
          className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm font-semibold hover:bg-muted"
        >
          <ImageUp className="size-4" aria-hidden="true" />
          {value ? "Replace image" : "Upload image"}
        </button>
        {value ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={uploading}
            className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm font-semibold text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Remove
          </button>
        ) : null}
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm font-medium text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
