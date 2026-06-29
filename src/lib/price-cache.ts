import { supabase, DbCardPrice } from "./supabaseClient";
import { CardIdentity, PricePoint } from "./models";

const CACHE_TTL_MS_TCGP = 60 * 60 * 1000; // 1 hour
const CACHE_TTL_MS_EBAY = 24 * 60 * 60 * 1000; // 24 hours

export async function getCachedTCGPrices(
  productId: string
): Promise<{ marketPrice: number | null; medianPrice: number | null } | null> {
  const { data } = await supabase
    .from("card_prices")
    .select("*")
    .eq("source", "tcgplayer")
    .eq("listing_url", `product/${productId}`)
    .gte("fetched_at", new Date(Date.now() - CACHE_TTL_MS_TCGP).toISOString())
    .order("fetched_at", { ascending: false })
    .limit(1)
    .single<DbCardPrice>();

  if (!data) return null;

  const raw = data.raw_data as any;
  return {
    marketPrice: raw?.marketPrice ?? null,
    medianPrice: raw?.medianPrice ?? null,
  };
}

export async function getCachedEbayPrices(
  query: string
): Promise<PricePoint[] | null> {
  const { data } = await supabase
    .from("card_prices")
    .select("*")
    .eq("source", "ebay")
    .eq("card_name", query)
    .gte("fetched_at", new Date(Date.now() - CACHE_TTL_MS_EBAY).toISOString())
    .order("fetched_at", { ascending: false })
    .limit(1)
    .single<DbCardPrice>();

  if (!data) return null;

  const raw = data.raw_data as any;
  return raw?.prices ?? null;
}

export async function cacheTCGPrices(
  productId: string,
  cardName: string,
  marketPrice: number | null,
  medianPrice: number | null
) {
  await supabase.from("card_prices").insert({
    card_name: cardName,
    source: "tcgplayer",
    price_usd: marketPrice || medianPrice || 0,
    listing_url: `product/${productId}`,
    raw_data: { marketPrice, medianPrice },
    fetched_at: new Date().toISOString(),
  });
}

export async function cacheEbayPrices(
  query: string,
  prices: PricePoint[]
) {
  for (const price of prices.slice(0, 25)) {
    await supabase.from("card_prices").insert({
      card_name: query,
      source: "ebay",
      price_usd: price.priceUsd,
      condition: price.condition,
      listing_url: price.url,
      listing_date: price.date,
      raw_data: { prices },
      fetched_at: new Date().toISOString(),
    });
  }
}
