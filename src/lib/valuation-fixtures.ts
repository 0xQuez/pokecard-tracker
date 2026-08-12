// Deterministic mock fixtures for the valuation UI — used by the /dev/valuation
// fixture page and by the component tests. No network.

import type {
  CardCondition,
  ConditionCurveJson,
  PricePointJson,
  ValuationRequestRow,
  ValuationResultRow,
} from "./valuation-ui";

export const DRAGONITE_IDENTITY = {
  set: "Dragon",
  number: "90/97",
  variant: null,
  name: "Dragonite ex",
};

export const FULL_CURVE: ConditionCurveJson = {
  NM: { estimated_price: 850.0, sample_count: 8 },
  LP: { estimated_price: 690.0, sample_count: 6 },
  MP: { estimated_price: 520.0, sample_count: 7 },
  HP: { estimated_price: 380.0, sample_count: 4 },
  DMG: { estimated_price: 240.0, sample_count: 3 },
};

export const INSUFFICIENT_CURVE: ConditionCurveJson = {
  NM: { estimated_price: 850.0, sample_count: 2 },
  LP: { estimated_price: null, sample_count: 0 },
  MP: null,
  HP: null,
  DMG: { estimated_price: 240.0, sample_count: 1 },
};

export const FULL_POINTS: PricePointJson[] = [
  {
    source: "ebay",
    url: "https://www.ebay.com/itm/12345",
    price: 850.0,
    condition_claimed: "Near Mint",
    condition_verified: "NM",
    sold_at: "2026-07-30T12:00:00Z",
    is_best_offer: false,
    is_trust_anchor: true,
    flags: [],
  },
  {
    source: "ebay",
    url: "https://www.ebay.com/itm/12346",
    price: 780.0,
    condition_claimed: "NM",
    condition_verified: "NM",
    sold_at: "2026-07-28T18:30:00Z",
    is_best_offer: true,
    is_trust_anchor: false,
    flags: ["best_offer"],
  },
  {
    source: "ebay",
    url: "https://www.ebay.com/itm/12347",
    price: 520.0,
    condition_claimed: "Moderately Played",
    condition_verified: "MP",
    sold_at: "2026-07-25T09:00:00Z",
    is_best_offer: false,
    is_trust_anchor: false,
    flags: [],
  },
  {
    source: "tcgplayer",
    url: "https://www.tcgplayer.com/product/9876",
    price: 499.99,
    condition_claimed: "Near Mint",
    condition_verified: null,
    sold_at: null,
    is_best_offer: false,
    is_trust_anchor: true,
    flags: [],
  },
];

export function makeRequest(
  id: number,
  status: ValuationRequestRow["status"],
  over: Partial<ValuationRequestRow> = {}
): ValuationRequestRow {
  const base: ValuationRequestRow = {
    id,
    user_id: "Quez",
    card_query: "Dragonite ex",
    card_id: null,
    status,
    priority: 0,
    claimed_by: null,
    created_at: "2026-08-12T10:00:00Z",
    started_at: null,
    completed_at: null,
    error: null,
  };
  const started: Record<string, string> = {
    running: "2026-08-12T10:00:30Z",
    claimed: "2026-08-12T10:00:30Z",
  };
  const completed: Record<string, string> = {
    done: "2026-08-12T10:03:00Z",
    failed: "2026-08-12T10:03:00Z",
    blocked: "2026-08-12T10:03:00Z",
  };
  return {
    ...base,
    ...over,
    started_at: over.started_at ?? started[status] ?? null,
    completed_at: over.completed_at ?? completed[status] ?? null,
  };
}

export function makeResult(
  requestId: number,
  over: Partial<ValuationResultRow> = {}
): ValuationResultRow {
  return {
    id: requestId,
    request_id: requestId,
    card_identity: DRAGONITE_IDENTITY,
    price_points: FULL_POINTS,
    condition_curve: FULL_CURVE,
    created_at: "2026-08-12T10:03:00Z",
    share_token: `tok-${requestId}`,
    ...over,
  };
}

export function curveFor(cond: CardCondition, price: number, n: number) {
  return { estimated_price: price, sample_count: n };
}
