export type CardCondition = "NM" | "LP" | "MP" | "HP" | "DMG";
export type PriceSource = "tcgplayer" | "ebay";

export interface CardIdentity {
  name: string;
  set: string | null;
  cardNumber: string | null;
  setId: string | null;
}

export interface PricePoint {
  source: PriceSource;
  priceUsd: number;
  condition: CardCondition | null;
  url: string | null;
  date: string | null;
  isSoldPrice: boolean;
}

export interface CardPriceResult {
  card: CardIdentity;
  prices: PricePoint[];
  consolidated: {
    tcgplayerMarket: number | null;
    ebaySoldRange: { low: number; high: number; median: number } | null;
    recentSoldCount: number;
  };
  rawSource: "cache" | "live";
  fetchedAt: string;
}

export interface SearchQuery {
  query: string;
  set?: string;
  cardNumber?: string;
}
