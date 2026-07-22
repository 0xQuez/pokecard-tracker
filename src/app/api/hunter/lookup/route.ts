import { NextRequest, NextResponse } from "next/server";
import { getMarketPrice } from "../../../../lib/scrapers/pokemontcg";
import { searchSoldItems, searchGradedSoldItems } from "../../../../lib/scrapers/ebay";
import { consolidatePrices } from "../../../../lib/price-engine";
import {
  getCachedTCGPrices,
  cacheTCGPrices,
  getCachedEbayPrices,
  cacheEbayPrices,
  getCachedPsaPrices,
  cachePsaPrices,
} from "../../../../lib/price-cache";
import { CardIdentity, PsaPriceData, GradeLevel } from "../../../../lib/models";

const GRADES: GradeLevel[] = ["PSA 6", "PSA 7", "PSA 8", "PSA 9", "PSA 10"];

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const name = req.nextUrl.searchParams.get("name") || "Unknown card";

  if (!id) {
    return NextResponse.json({ error: "Missing card id" }, { status: 400 });
  }

  try {
    const card: CardIdentity = {
      name,
      set: null,
      cardNumber: null,
      setId: id,
    };

    // Check cache first
    const [cachedTCG, cachedEbay, cachedPsa] = await Promise.all([
      getCachedTCGPrices(id),
      getCachedEbayPrices(name),
      getCachedPsaPrices(name),
    ]);

    if (cachedTCG && cachedEbay && cachedPsa != null) {
      let psaPrices = cachedPsa as PsaPriceData[];
      const result = consolidatePrices(
        card,
        cachedTCG,
        cachedEbay,
        psaPrices,
        cachedTCG.marketPrice ?? undefined
      );
      return NextResponse.json({ ...result, rawSource: "cache" as const });
    }

    // Scrape TCG API + raw eBay in parallel
    const [tcgpResult, ebayPrices] = await Promise.all([
      getMarketPrice(id),
      searchSoldItems(name, { limit: 25 }),
    ]);

    // PSA graded eBay searches (sequential to avoid rate limits)
    const psaPromise = Promise.all(
      GRADES.map(async (grade) => {
        const gradeNum = parseInt(grade.split(" ")[1], 10);
        const sold = await searchGradedSoldItems(name, gradeNum, { limit: 10 });
        const avg =
          sold.length > 0
            ? sold.reduce((sum, p) => sum + p.priceUsd, 0) / sold.length
            : 0;
        return {
          grade,
          avgSold: Number(avg.toFixed(2)),
          count: sold.length,
          url: null,
        } as PsaPriceData;
      })
    );

    const psaPrices = await psaPromise;

    // If TCG API is down, use eBay median as marketPrice
    let marketPrice = tcgpResult.marketPrice;
    let medianPrice = tcgpResult.medianPrice;
    if (!marketPrice && ebayPrices.length > 0) {
      const prices = ebayPrices.map((p) => p.priceUsd).sort((a, b) => a - b);
      const mid = Math.floor(prices.length / 2);
      marketPrice = prices.length % 2 === 0 ? (prices[mid - 1] + prices[mid]) / 2 : prices[mid];
      if (!medianPrice) medianPrice = marketPrice;
    }

    // Write results to cache
    await Promise.all([
      cacheTCGPrices(id, name, marketPrice, medianPrice),
      cacheEbayPrices(name, ebayPrices),
      cachePsaPrices(name, psaPrices),
    ]);

    const result = consolidatePrices(
      card,
      { marketPrice, medianPrice },
      ebayPrices,
      psaPrices,
      marketPrice ?? undefined
    );
    return NextResponse.json(result);
  } catch (e) {
    console.error("Price lookup failed:", e);
    return NextResponse.json(
      { error: "Price lookup failed. Try again." },
      { status: 500 }
    );
  }
}
