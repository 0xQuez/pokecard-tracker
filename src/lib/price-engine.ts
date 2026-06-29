import { PricePoint, CardPriceResult, CardIdentity } from "./models";

export function consolidatePrices(
  card: CardIdentity,
  tcgpResult: { marketPrice: number | null; medianPrice: number | null } | null,
  ebayPrices: PricePoint[]
): CardPriceResult {
  const allPrices: PricePoint[] = [];

  if (tcgpResult?.marketPrice) {
    allPrices.push({
      source: "tcgplayer",
      priceUsd: tcgpResult.marketPrice,
      condition: null,
      url: null,
      date: null,
      isSoldPrice: false,
    });
  }

  if (ebayPrices.length > 0) {
    allPrices.push(...ebayPrices);
  }

  let ebaySoldRange: { low: number; high: number; median: number } | null = null;
  if (ebayPrices.length > 0) {
    const sold = ebayPrices
      .filter((p) => p.isSoldPrice && p.priceUsd > 0)
      .map((p) => p.priceUsd)
      .sort((a, b) => a - b);

    if (sold.length > 0) {
      const mid = Math.floor(sold.length / 2);
      ebaySoldRange = {
        low: sold[0],
        high: sold[sold.length - 1],
        median: sold.length % 2 === 0 ? (sold[mid - 1] + sold[mid]) / 2 : sold[mid],
      };
    }
  }

  return {
    card,
    prices: allPrices,
    consolidated: {
      tcgplayerMarket: tcgpResult?.marketPrice ?? null,
      ebaySoldRange,
      recentSoldCount: ebayPrices.length,
    },
    rawSource: "live",
    fetchedAt: new Date().toISOString(),
  };
}
