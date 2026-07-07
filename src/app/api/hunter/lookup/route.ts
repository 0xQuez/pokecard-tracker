import { NextRequest, NextResponse } from "next/server";
import { getMarketPrice } from "../../../../lib/scrapers/tcgplayer";
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
        // raw price over-ride: prefer tcgplayer market over cached median
        cachedTCG.marketPrice ?? undefined
      );
      return NextResponse.json({ ...result, rawSource: "cache" as const });
    }

    // Scrape TCGPlayer + raw eBay in parallel; PSA graded eBay in parallel afterwards
    const [tcgpResult, ebayPrices] = await Promise.all([
      getMarketPrice(productId),
      searchSoldItems(name, { limit: 25 }),
    ]);

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

    // Write results to cache
    await Promise.all([
      cacheTCGPrices(id, name, tcgpResult.marketPrice, tcgpResult.medianPrice),
      cacheEbayPrices(name, ebayPrices),
      cachePsaPrices(name, psaPrices),
    ]);

    const result = consolidatePrices(
      card,
      tcgpResult,
      ebayPrices,
      psaPrices,
      tcgpResult.marketPrice ?? undefined
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
