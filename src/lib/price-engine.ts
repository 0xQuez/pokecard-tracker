import { PricePoint, CardPriceResult, CardIdentity, PsaPriceData, HuntMetrics, GradeLevel } from "./models";

const GRADES: GradeLevel[] = ["PSA 6", "PSA 7", "PSA 8", "PSA 9", "PSA 10"];

const GRADING_FEE = 80;
const SHIPPING_TO = 30;
const SHIPPING_FROM = 30;
const INSURANCE = 0;
const OTHER = 0;

export function buildHuntMetrics(
  rawPrice: number,
  psaPrices: PsaPriceData[]
): HuntMetrics {
  const totalCost =
    rawPrice + GRADING_FEE + SHIPPING_TO + SHIPPING_FROM + INSURANCE + OTHER;

  const gradeMap = new Map<string, number>();
  for (const p of psaPrices) {
    gradeMap.set(p.grade, p.avgSold);
  }

  let bestMarginGrade: GradeLevel | null = null;
  let bestMargin = -Infinity;

  const flags: Record<string, number | boolean> = {
    totalCost,
    psa6BreakEven: totalCost * 2,
    psa7BreakEven: totalCost * 2,
    psa8BreakEven: totalCost * 2,
    psa9BreakEven: totalCost * 2,
    psa10BreakEven: totalCost * 2,
    psa6Buy: false,
    psa7Buy: false,
    psa8Buy: false,
    psa9Buy: false,
    psa10Buy: false,
  };

  for (const grade of GRADES) {
    const breakeven = totalCost * 2;
    const sold = gradeMap.get(grade);
    const keyBuy = grade.toLowerCase().replace(/\s/g, "") + "Buy";
    if (sold !== undefined) {
      flags[keyBuy] = sold >= breakeven;
      const margin = sold - totalCost;
      if (margin > bestMargin) {
        bestMargin = margin;
        bestMarginGrade = grade;
      }
    }
  }

  return {
    rawPrice,
    gradingFee: GRADING_FEE,
    shippingToGrader: SHIPPING_TO,
    shippingFromGrader: SHIPPING_FROM,
    insurance: INSURANCE,
    otherCosts: OTHER,
    totalCost,
    psa6BreakEven: flags.psa6BreakEven as number,
    psa7BreakEven: flags.psa7BreakEven as number,
    psa8BreakEven: flags.psa8BreakEven as number,
    psa9BreakEven: flags.psa9BreakEven as number,
    psa10BreakEven: flags.psa10BreakEven as number,
    psa6Buy: flags.psa6Buy as boolean,
    psa7Buy: flags.psa7Buy as boolean,
    psa8Buy: flags.psa8Buy as boolean,
    psa9Buy: flags.psa9Buy as boolean,
    psa10Buy: flags.psa10Buy as boolean,
    bestMarginGrade,
    bestMargin: bestMarginGrade ? bestMargin : 0,
  };
}

export function consolidatePrices(
  card: CardIdentity,
  tcgpResult: { marketPrice: number | null; medianPrice: number | null } | null,
  ebayPrices: PricePoint[],
  psaPrices: PsaPriceData[] = [],
  rawPriceOverride?: number
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

  const rawPrice = rawPriceOverride ?? tcgpResult?.marketPrice ?? ebaySoldRange?.median ?? 0;
  const hunt = psaPrices.length > 0 ? buildHuntMetrics(rawPrice, psaPrices) : null;

  return {
    card,
    prices: allPrices,
    consolidated: {
      tcgplayerMarket: tcgpResult?.marketPrice ?? null,
      ebaySoldRange,
      recentSoldCount: ebayPrices.length,
    },
    psaPrices,
    hunt,
    rawSource: "live",
    fetchedAt: new Date().toISOString(),
  };
}
