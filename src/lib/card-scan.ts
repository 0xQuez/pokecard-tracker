// Pure, offline-testable helpers for the HunterTool "Scan card" flow (T19).
// Kept free of the global supabase client and of relative imports so the upload
// logic can run under `node --test` type-stripping (mirrors valuation-ui.ts).
// Note: CARD_IMAGE_BUCKET is also defined in helpers.ts / supabaseClient.ts;
// kept local here so this module stays import-free and node-testable.

export const CARD_IMAGE_BUCKET = "card-images";
export const SCAN_MIME_TYPE = "image/jpeg";
export const SCAN_FILENAME = "scan.jpg";

/** Minimal shape of the Supabase Storage client used to upload a scan. */
export interface CardImageClient {
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        file: Blob,
        opts?: { cacheControl?: string; upsert?: boolean }
      ): Promise<{ data: { path: string } | null; error: { message: string } | null }>;
    };
  };
}

export type ScanUpload =
  | { ok: true; path: string; url: string }
  | { ok: false; error: string };

/** Build a unique, extension-bearing storage path for a card scan. */
export function scanImagePath(file: { name: string }): string {
  const dot = file.name.lastIndexOf(".");
  const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  const safeExt = /^[a-z0-9]{1,5}$/.test(ext) ? ext : "jpg";
  const rand = Math.random().toString(36).slice(2, 8);
  return `scan-${Date.now()}-${rand}.${safeExt}`;
}

/** Public URL for a stored card-scan object path. */
export function scanPublicUrl(path: string): string {
  if (!path) return "";
  if (/^https?:\/\//.test(path)) return path;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL || ""}/storage/v1/object/public/${CARD_IMAGE_BUCKET}/${path}`;
}

/**
 * Wrap a <canvas> frame in a File the storage client can upload. Returns null
 * when the browser can't encode the frame (no toBlob support).
 */
export function canvasToFile(
  canvas: HTMLCanvasElement,
  mimeType = SCAN_MIME_TYPE,
  filename = SCAN_FILENAME
): Promise<File | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob ? new File([blob], filename, { type: mimeType }) : null),
      mimeType,
      0.9
    );
  });
}

/**
 * Upload a card scan to the public `card-images` bucket and resolve to its
 * public URL. Never throws — failures come back as { ok: false, error }.
 */
export async function uploadCardScan(
  client: CardImageClient,
  file: File
): Promise<ScanUpload> {
  const path = scanImagePath(file);
  const res = await client.storage.from(CARD_IMAGE_BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (res.error) return { ok: false, error: res.error.message };
  return { ok: true, path, url: scanPublicUrl(path) };
}
