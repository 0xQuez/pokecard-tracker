import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export const CARD_IMAGE_BUCKET = "card-images";

/**
 * Upload a card image to the public `card-images` storage bucket and return the
 * stored object path (render with publicCardImageUrl). Returns null on failure
 * so callers can save the entry anyway without blocking on an image.
 */
export async function uploadCardImage(file: File): Promise<string | null> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from(CARD_IMAGE_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false });
  if (error) {
    console.error("card image upload failed:", error.message);
    return null;
  }
  return path;
}

export type DbCardPrice = {
  id: number;
  card_name: string;
  card_set: string | null;
  card_number: string | null;
  source: "tcgplayer" | "ebay";
  price_usd: number;
  condition: string | null;
  listing_url: string | null;
  listing_date: string | null;
  raw_data: Record<string, unknown> | null;
  fetched_at: string;
};
