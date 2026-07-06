import { NextRequest, NextResponse } from "next/server";
import { getMarketPrice } from "../../../../lib/scrapers/tcgplayer";
import { searchSoldItems } from "../../../../lib/scrapers/ebay";
import { consolidatePrices } from "../../../../lib/price-engine";
import {
  getCachedTCGPrices,
  cacheTCGPrices,
  getCachedEbayPrices,
  cacheEbayPrices,
} from "../../../../lib/price-cache";
import { CardIdentity } from "../../../../lib/models";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const name = req.nextUrl.searchParams.get("name") || "Unknown card";

  if (!id) {
    return NextResponse.json({ error: "Missing product id" }, { status: 400 });
  }

  if (!/^\d+$/.test(id)) {
    return NextResponse.json(
      { error: "Invalid product id: must be numeric" },
      { status: 400 }
    );
  }

  const productId = parseInt(id, 10);

  try {
    const card: CardIdentity = {
      name,
      set: null,
      cardNumber: null,
      setId: id,
    };

    // Check cache first
    const [cachedTCG, cachedEbay] = await Promise.all([
      getCachedTCGPrices(id),
      getCachedEbayPrices(name),
    ]);

    if (cachedTCG && cachedEbay) {
      const result = consolidatePrices(card, cachedTCG, cachedEbay);
      return NextResponse.json({ ...result, rawSource: "cache" as const });
    }

    // Cache miss: scrape TCGPlayer + eBay in parallel
    const [tcgpResult, ebayPrices] = await Promise.all([
      getMarketPrice(productId),
      searchSoldItems(name),
    ]);

    // Write results to cache
    await Promise.all([
      cacheTCGPrices(id, name, tcgpResult.marketPrice, tcgpResult.medianPrice),
      cacheEbayPrices(name, ebayPrices),
    ]);

    const result = consolidatePrices(card, tcgpResult, ebayPrices);
    return NextResponse.json(result);
  } catch (e) {
    console.error("Price lookup failed:", e);
    return NextResponse.json(
      { error: "Price lookup failed. Try again." },
      { status: 500 }
    );
  }
}
