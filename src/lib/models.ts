export type CardCondition = "NM" | "LP" | "MP" | "HP" | "DMG";
export type PriceSource = "tcgplayer" | "ebay";
export type CardRarity =
  | "common"
  | "rare"
  | "reverse holo"
  | "holo rare"
  | "ultra rare"
  | "secret rare";
export type CardEdition =
  | "1st Edition"
  | "Unlimited"
  | "shadowless"
  | "no rarity symbol"
  | "4th print";
export type GradeLevel = "PSA 6" | "PSA 7" | "PSA 8" | "PSA 9" | "PSA 10";

export interface CardIdentity {
  name: string;
  set: string | null;
  cardNumber: string | null;
  setId: string | null;
}export interface PricePoint {
  source: PriceSource;
  priceUsd: number;
  condition: CardCondition | null;
  url: string | null;
  date: string | null;
  isSoldPrice: boolean;
}

export interface PsaPriceData {
  grade: GradeLevel;
  avgSold: number;       // average sold price for this grade from eBay
  count: number;         // how many sold listings used
  url: string | null;
}export interface HuntMetrics {
  // inputs
  rawPrice: number;
  gradingFee: number;
  shippingToGrader: number;
  shippingFromGrader: number;
  insurance: number;
  otherCosts: number;
  // computed
  totalCost: number;      // rawPrice + grading + shipping + insurance + other
  psa6BreakEven: number;   // totalCost * 2
  psa7BreakEven: number;
  psa8BreakEven: number;
  psa9BreakEven: number;
  psa10BreakEven: number;
  // comparison flags
  psa6Buy: boolean;       // PSA6 avg sold >= psa6BreakEven
  psa7Buy: boolean;
  psa8Buy: boolean;
  psa9Buy: boolean;
  psa10Buy: boolean;
  bestMarginGrade: GradeLevel | null; // best profit grade
  bestMargin: number;     // dollar margin for best grade
}

export interface CardPriceResult {
  card: CardIdentity;
  prices: PricePoint[];
  consolidated: {
    tcgplayerMarket: number | null;
    ebaySoldRange: { low: number; high: number; median: number } | null;
    recentSoldCount: number;
  };
  psaPrices: PsaPriceData[];
  hunt: HuntMetrics | null;
  rawSource: "cache" | "live";
  fetchedAt: string;
}

export interface SearchQuery {
  query: string;
  set?: string;
  cardNumber?: string;
  condition?: CardCondition;
  rarity?: CardRarity;
  edition?: CardEdition;
  graded?: GradeLevel;
}
