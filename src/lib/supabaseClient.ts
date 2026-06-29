import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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
