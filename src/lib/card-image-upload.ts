// Card image upload helper for the PokeCard scan flow (T22.2).
//
// Uploads a card photo to the public `card-images` Supabase storage bucket and
// resolves to the public URL the vision identify API can fetch
// (POST /api/hunter/identify takes { imageUrl }).
//
// Design mirrors src/lib/card-scan.ts (T19): the storage client is injected so
// the module is plain erasable TypeScript that runs both in the browser (via
// the Next app) and directly under `node --test` (Node 22+ strips types
// natively). No TS `enum`, no global imports — every network I/O happens
// through the injected client, so errors can be typed and tested offline.
//
// Compared to the T19 `uploadCardScan`/`scanImagePath` in card-scan.ts, this
// helper is the dedicated, caller-facing API for the scan flow:
//   - guards file size BEFORE any network call (rejects > MAX_CARD_IMAGE_BYTES)
//   - uploads under a user-scoped path when an authenticated user id is known,
//     otherwise under `scans/` with a UUID filename
//   - sets an explicit content-type derived from the blob (falls back to the
//     filename extension, then image/jpeg)
//   - returns a structured result with TYPED errors the UI can render
import { createClient } from "@supabase/supabase-js";

// ── Constants ────────────────────────────────────────────────────────────────

export const CARD_IMAGE_BUCKET = "card-images";
/** Reject card photos larger than 10 MB. */
export const MAX_CARD_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MiB
/** Default cache control applied to uploaded objects. */
export const CARD_IMAGE_CACHE_CONTROL = "3600";

// ── Typed errors ─────────────────────────────────────────────────────────────

export type CardImageErrorCode =
  | "oversize"
  | "network"
  | "policy"
  | "invalid-input"
  | "storage";

/** A typed, serialisable error the UI can switch on. */
export class CardImageUploadError extends Error {
  readonly code: CardImageErrorCode;
  /** Underlying storage/network error message, when one exists. */
  readonly causeMessage: string | null;

  constructor(code: CardImageErrorCode, message: string, causeMessage?: string) {
    super(message);
    this.name = "CardImageUploadError";
    this.code = code;
    this.causeMessage = causeMessage ?? null;
  }
}

// ── Result type ──────────────────────────────────────────────────────────────

export type CardImageUploadResult =
  | { ok: true; path: string; publicUrl: string }
  | { ok: false; error: CardImageUploadError };

/** Minimal shape of the Supabase Storage client used to upload an image. */
export interface CardImageUploadClient {
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        file: Blob,
        opts?: {
          cacheControl?: string;
          upsert?: boolean;
          contentType?: string;
        }
      ): Promise<{
        data: { path: string } | null;
        error: { message: string; statusCode?: string | number } | null;
      }>;
    };
  };
}

// ── Pure helpers (offline-testable) ──────────────────────────────────────────

/** Allowed file extensions -> content-type, used when the blob lacks one. */
const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
};

/** Safe 1-5 char alphanumeric extension for a filename, or null. */
export function imageExtension(name: string | undefined): string | null {
  if (!name) return null;
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : null;
}

/**
 * Resolve the content-type to send with the upload: prefer the blob's own
 * `type`, then a mapping from the filename extension, then image/jpeg.
 */
export function imageContentType(file: Blob, fileName?: string): string {
  if (file.type) return file.type;
  const ext = imageExtension(fileName);
  if (ext && EXT_TO_MIME[ext]) return EXT_TO_MIME[ext];
  return "image/jpeg";
}

/**
 * Build a unique, user-scoped storage path for a card image.
 * - With a userId:   users/<userId>/<uuid>.<ext>
 * - Without (anon):  scans/<uuid>.<ext>
 * The UUID keeps paths collision-free and unguessable.
 */
export function buildCardImagePath(
  opts: { userId?: string | null; ext?: string | null }
): string {
  const ext = opts.ext && /^[a-z0-9]{1,5}$/.test(opts.ext) ? opts.ext : "jpg";
  const uuid = crypto.randomUUID();
  if (opts.userId) {
    return `users/${opts.userId}/${uuid}.${ext}`;
  }
  return `scans/${uuid}.${ext}`;
}

/** Public URL for a stored card-image object path (bucket is public). */
export function publicCardImageUrl(path: string): string {
  if (!path) return "";
  if (/^https?:\/\//.test(path)) return path;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  return `${base}/storage/v1/object/public/${CARD_IMAGE_BUCKET}/${path}`;
}

// ── Core upload ──────────────────────────────────────────────────────────────

/**
 * Upload a card image (File or Blob) to the `card-images` bucket.
 *
 * Returns { ok: true, path, publicUrl } on success, or a typed
 * CardImageUploadError. NEVER throws for normal failures — oversize input is
 * rejected before any network I/O; storage/network/policy failures are mapped
 * to typed error codes.
 *
 * @param client  Storage client (real Supabase or a test double).
 * @param file    The image blob to upload (File or Blob).
 * @param opts    Optional: userId (for user-scoped path), fileName (used for
 *                extension/content-type when the blob has no name/type), and
 *                the SUPABASE_URL to build the public URL.
 */
export async function uploadCardImage(
  client: CardImageUploadClient,
  file: Blob,
  opts?: {
    userId?: string | null;
    fileName?: string;
  }
): Promise<CardImageUploadResult> {
  if (!file || typeof file.size !== "number" || file.size < 0) {
    return {
      ok: false,
      error: new CardImageUploadError(
        "invalid-input",
        "No image was provided to upload."
      ),
    };
  }

  if (file.size > MAX_CARD_IMAGE_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      error: new CardImageUploadError(
        "oversize",
        `Image is ${mb} MB. The maximum is 10 MB.`,
        `file size ${file.size} exceeds ${MAX_CARD_IMAGE_BYTES}`
      ),
    };
  }

  const ext = imageExtension(opts?.fileName);
  const contentType = imageContentType(file, opts?.fileName);
  const path = buildCardImagePath({ userId: opts?.userId ?? null, ext });

  let res;
  try {
    res = await client.storage.from(CARD_IMAGE_BUCKET).upload(path, file, {
      cacheControl: CARD_IMAGE_CACHE_CONTROL,
      upsert: false,
      contentType,
    });
  } catch (e) {
    return {
      ok: false,
      error: new CardImageUploadError(
        "network",
        "Could not reach the image service. Check your connection and try again.",
        e instanceof Error ? e.message : String(e)
      ),
    };
  }

  if (res?.error) {
    return {
      ok: false,
      error: mapStorageError(res.error.message, res.error.statusCode),
    };
  }

  return {
    ok: true,
    path,
    publicUrl: publicCardImageUrl(path),
  };
}

/** Map a Supabase Storage error message/status to a typed code. */
export function mapStorageError(
  message: string,
  status?: string | number | null
): CardImageUploadError {
  const statusStr = String(status ?? "");
  // 400/403 on insert = RLS / policy rejection (bucket missing, not allowed).
  if (statusStr === "400" || statusStr === "403") {
    return new CardImageUploadError(
      "policy",
      "Your image was rejected by the image service. Try a different image.",
      message
    );
  }
  const lower = message.toLowerCase();
  if (
    /policy|permission|not authorized|forbidden|not allowed|rls/i.test(lower)
  ) {
    return new CardImageUploadError(
      "policy",
      "Your image was rejected by the image service. Try a different image.",
      message
    );
  }
  return new CardImageUploadError(
    "storage",
    "The image upload failed. Try again.",
    message
  );
}

// ── Default instance wired to the real Supabase client ──────────────────────

let _supabase: ReturnType<typeof createClient> | null = null;

/**
 * The app-wide Supabase client (lazy). Using the same credentials as the rest
 * of the app (src/lib/supabaseClient.ts) keeps auth/session state consistent.
 * Lazy so importing this module under `node --test` (no env vars) doesn't throw
 * at module load — the client is only built when the real upload wrapper runs.
 */
function getSupabase(): ReturnType<typeof createClient> {
  if (!_supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    if (!url || !anon) {
      throw new CardImageUploadError(
        "storage",
        "Supabase is not configured (missing NEXT_PUBLIC_SUPABASE_URL / ANON_KEY)."
      );
    }
    _supabase = createClient(url, anon);
  }
  return _supabase;
}

/**
 * Convenience wrapper that uploads with the real Supabase client and resolves
 * the authenticated user (if any) so the object lands under a user-scoped path.
 * Returns the same typed result; never throws.
 */
export async function uploadCardImageToBucket(
  file: Blob,
  opts?: { userId?: string | null; fileName?: string }
): Promise<CardImageUploadResult> {
  let userId = opts?.userId ?? null;
  try {
    const supabase = getSupabase();
    if (!userId) {
      const { data } = await supabase.auth.getUser();
      userId = data?.user?.id ?? null;
    }
    return await uploadCardImage(supabase, file, {
      userId,
      fileName: opts?.fileName,
    });
  } catch (e) {
    if (e instanceof CardImageUploadError) {
      return { ok: false, error: e };
    }
    return {
      ok: false,
      error: new CardImageUploadError(
        "storage",
        "The image upload failed. Try again.",
        e instanceof Error ? e.message : String(e)
      ),
    };
  }
}
