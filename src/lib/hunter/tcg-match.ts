/**
 * tcg-match.ts — pokemontcg.io matcher for PokeCard identification.
 *
 * Turns a partial extracted card identity (name / set / collector number) into
 * a short ranked list of candidate cards with image URLs. The vision-extracted
 * "Pokemon Center Exclusive" stamp is deliberately NOT used here: the API does
 * not split regular vs PCE variants (svp-44 is a single entry) — variant
 * disambiguation is the job of a higher layer.
 *
 * Design notes
 * ------------
 * - Library only; no HTTP route. Designed to run inside a Hermes agent loop
 *   (or any Node process) as a callable function.
 * - Retry-with-backoff is REQUIRED because pokemontcg.io 500s under bursts.
 *   The HTTP layer is injectable so tests can fire injected 500s/429s.
 * - Everything network-y and time-y is injectable (`fetchFn`, `sleep`) so the
 *   scoring + query + retry logic is fully unit-testable offline.
 */

export type CardIdentity = {
  /** Card name, e.g. "Charmander". */
  name: string;
  /** Human set name, e.g. "Scarlet & Violet Black Star Promos". */
  setName?: string;
  /** Set code, e.g. "svp". */
  setCode?: string;
  /** Collector number: "44", "044" or "44/197". */
  collectorNumber?: string;
  /** Alias for collectorNumber (prior identity shape used card_number). */
  cardNumber?: string;
};

export type CandidateCard = {
  /** pokemontcg.io card id, e.g. "svp-44". */
  id: string;
  name: string;
  set: { id: string; name: string; series?: string };
  number: string;
  imageSmall?: string;
  imageLarge?: string;
  /**
   * T30.6: the physical finish keys pokemontcg.io's tcgplayer pricing advertises
   * for this catalog row (e.g. ["normal","reverseHolofoil"] for the Latios δ
   * "one row, many finishes" case). Empty when the API returned no pricing.
   * Signal 3 of `hasMultiplePrintVariants` reads this at identify time.
   */
  priceFinishes?: string[];
  /** 0..1 score against the extracted identity. */
  score: number;
};

export type MatchOptions = {
  /**
   * Injectable HTTP GET-JSON. Defaults to the built-in `fetch`-based client.
   * Tests substitute a fake to inject 500s/429s without any network.
   */
  fetchFn?: (url: string, init?: { signal?: AbortSignal }) => Promise<unknown>;
  /** Injectable sleep (ms). Defaults to real setTimeout; tests pass a fast fake. */
  sleep?: (ms: number) => Promise<void>;
  /** Per-attempt timeout, ms. */
  timeoutMs?: number;
  /** Max retries after the first attempt (total attempts = retries + 1). */
  retries?: number;
  /** Base backoff delay, ms (doubled per retry). */
  baseDelayMs?: number;
  /** Upper bound on a single backoff delay, ms. */
  maxDelayMs?: number;
  logger?: (msg: string) => void;
};

type RawCard = {
  id: string;
  name: string;
  number: string;
  set?: { id: string; name: string; series?: string };
  images?: { small?: string; large?: string };
  /** T30.6: tcgplayer pricing object; only its top-level finish keys matter. */
  tcgplayer?: { prices?: Record<string, unknown> };
};

type RawResponse = { data?: RawCard[]; error?: string };

/* -------------------------------------------------------------------------- */
/* Normalization helpers                                                       */
/* -------------------------------------------------------------------------- */

/** Lowercase, collapse whitespace, drop punctuation except spaces. */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pull the leading integer out of a collector number string.
 * "44" -> "44", "044" -> "044", "44/197" -> "44". Leading zeros are kept so the
 * caller can compare; use `numericCollector` for a zero-stripped compare.
 */
export function parseCollectorNumber(n: string): string {
  const m = String(n).trim().match(/^(\d+)/);
  return m ? m[1] : String(n).trim();
}

/** Zero-stripped numeric form for equality comparison ("044" -> "44"). */
export function numericCollector(n: string): string {
  return parseCollectorNumber(n).replace(/^0+(?=\d)/, "");
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                     */
/* -------------------------------------------------------------------------- */

export function scoreName(candidateName: string, identityName: string): number {
  const a = normalizeName(candidateName);
  const b = normalizeName(identityName);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  const toksA = new Set(a.split(" "));
  const toksB = b.split(" ");
  if (toksB.length === 0) return 0;
  const overlap = toksB.filter((t) => toksA.has(t)).length;
  return (overlap / toksB.length) * 0.6;
}

export function scoreNumber(candidateNumber: string, identityNumber?: string): number {
  if (!identityNumber) return 0.6; // unknown — neutral
  const a = numericCollector(candidateNumber);
  const b = numericCollector(identityNumber);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.startsWith(b) || b.startsWith(a)) return 0.7;
  return 0;
}

export function scoreSet(
  candidateSet: { id?: string; name?: string; series?: string } | undefined,
  identity: CardIdentity,
): number {
  if (!candidateSet) return 0.5;
  if (identity.setCode && candidateSet.id === identity.setCode.toLowerCase()) return 1;
  if (identity.setName) {
    const a = normalizeName(candidateSet.name ?? "");
    const b = normalizeName(identity.setName);
    if (a && b) {
      if (a === b) return 0.9;
      if (a.includes(b) || b.includes(a)) return 0.7;
    }
  }
  return 0.5;
}

/**
 * Composite 0..1 score. Name dominates, then number, then set — these weights
 * match the query strategy's ordering (name+number first, narrow by set).
 */
export function scoreCandidate(
  card: RawCard,
  identity: CardIdentity,
): number {
  const name = scoreName(card.name ?? "", identity.name);
  const number = scoreNumber(card.number ?? "", identity.collectorNumber ?? identity.cardNumber);
  const set = scoreSet(card.set, identity);
  return Math.min(1, name * 0.5 + number * 0.3 + set * 0.2);
}

/* -------------------------------------------------------------------------- */
/* Query strategy                                                              */
/* -------------------------------------------------------------------------- */

function qName(identity: CardIdentity): string {
  const n = normalizeName(identity.name).split(" ").join(" ");
  // Quote so multi-word names are matched as a phrase.
  return `name:"${n}"`;
}

function qNumber(identity: CardIdentity): string | null {
  const num = identity.collectorNumber ?? identity.cardNumber;
  if (!num) return null;
  const parsed = parseCollectorNumber(num);
  return parsed ? `number:${parsed}` : null;
}

/**
 * Ordered query strategies: most specific first. We try them in order and stop
 * at the first that returns non-empty data.
 */
export function buildQueries(identity: CardIdentity): string[] {
  const queries: string[] = [];
  const n = qName(identity);
  const num = qNumber(identity);

  if (identity.setCode) {
    // name + number + set code (tightest)
    queries.push([n, num, `set.id:${identity.setCode.toLowerCase()}`].filter(Boolean).join(" "));
  }
  if (identity.setName) {
    // name + number + set name
    queries.push([n, num, `set.name:"${normalizeName(identity.setName)}"`].filter(Boolean).join(" "));
  }
  // name + number
  if (num) queries.push([n, num].filter(Boolean).join(" "));
  // name only (looser fallback)
  queries.push(n);
  // number only (last resort) — `num` already carries the `number:` prefix
  if (num) queries.push(num);

  // de-dupe while preserving order
  return [...new Set(queries.filter((q) => q.trim().length > 0))];
}

/* -------------------------------------------------------------------------- */
/* HTTP client with retry + exponential backoff + jitter                       */
/* -------------------------------------------------------------------------- */

export class HttpError extends Error {
  status: number;
  constructor(status: number, msg: string) {
    super(msg);
    this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 3_000;

function defaultLogger(_msg: string): void {
  /* no-op unless the caller supplies a logger */
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function defaultFetchJson(
  url: string,
  init?: { signal?: AbortSignal },
): Promise<unknown> {
  const res = await fetch(url, { signal: init?.signal });
  if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}`);
  return res.json();
}

function shouldRetry(status: number): boolean {
  return status === 429 || status >= 500;
}

function jitter(ms: number): number {
  // ±25% jitter around the delay to avoid thundering-herd sync.
  const f = 0.75 + Math.random() * 0.5;
  return Math.round(ms * f);
}

/**
 * GET a JSON URL with retry + exponential backoff + jitter.
 * Retries on 5xx and 429 up to `retries` times (so at most retries+1 attempts).
 * Throws HttpError when the budget is exhausted.
 */
export async function httpGetJson(url: string, opts: MatchOptions = {}): Promise<unknown> {
  const fetchFn = opts.fetchFn ?? defaultFetchJson;
  const sleep = opts.sleep ?? defaultSleep;
  const logger = opts.logger ?? defaultLogger;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      await sleep(jitter(delay));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchFn(url, { signal: controller.signal });
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      const status = e instanceof HttpError ? e.status : 0;
      if (!shouldRetry(status) && !(e instanceof Error && e.name === "AbortError")) {
        throw e; // 4xx (other than 429) and network-unknown not tied to timeout: no point retrying
      }
      if (attempt < retries) {
        logger(`tcg-match: attempt ${attempt + 1} failed (status=${status}, err=${(e as Error)?.message}); retrying`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error
    ? new HttpError(
        lastErr instanceof HttpError ? lastErr.status : 0,
        `request failed after ${retries + 1} attempts: ${lastErr.message}`,
      )
    : new Error(`request failed after ${retries + 1} attempts`);
}

/* -------------------------------------------------------------------------- */
/* Matching                                                                    */
/* -------------------------------------------------------------------------- */

function toCandidate(card: RawCard, identity: CardIdentity): CandidateCard {
  return {
    id: card.id,
    name: card.name,
    set: {
      id: card.set?.id ?? "",
      name: card.set?.name ?? "",
      series: card.set?.series,
    },
    number: card.number,
    imageSmall: card.images?.small,
    imageLarge: card.images?.large,
    // T30.6: carry the tcgplayer finish keys so the pipeline can see a catalog
    // row that advertises >1 physical finish (signal 3).
    priceFinishes: card.tcgplayer?.prices
      ? Object.keys(card.tcgplayer.prices)
      : undefined,
    score: scoreCandidate(card, identity),
  };
}

const API_BASE = "https://api.pokemontcg.io/v2";

function buildCardUrl(q: string, pageSize: number): string {
  const params = new URLSearchParams({
    q,
    pageSize: String(pageSize),
    // T30.6: include tcgplayer so the anon API returns finish pricing keys
    // (normal / reverseHolofoil / holofoil) at identify time — the data signal
    // 3 of hasMultiplePrintVariants needs to drive variant multiplicity.
    select: "id,name,number,set,images,tcgplayer",
  });
  return `${API_BASE}/cards?${params.toString()}`;
}

/**
 * T30.6: fetch tcgplayer finish-price keys for a set of card ids in ONE batched
 * query (`id:"a" OR id:"b"`), for candidate lists that came from the artwork
 * embedding path (whose RPC rows carry no pricing). Returns a map of card id ->
 * finish keys (e.g. ex13-22 -> ["normal","reverseHolofoil"]); ids the API didn't
 * return are absent. Never throws — a pricing outage degrades signal 3 to "no
 * data" rather than failing the scan.
 */
export async function fetchPriceFinishes(
  ids: string[],
  opts: MatchOptions = {},
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const uniq = [...new Set(ids.filter(Boolean))];
  if (uniq.length === 0) return out;
  // id:"a" OR id:"b" — pokemontcg.io's query syntax for an exact-id union.
  const q = uniq.map((id) => `id:"${id}"`).join(" OR ");
  const url = buildCardUrl(q, Math.max(uniq.length, 50));
  try {
    const body = (await httpGetJson(url, opts)) as RawResponse;
    for (const card of body?.data ?? []) {
      if (!card?.id) continue;
      out.set(
        card.id,
        card.tcgplayer?.prices ? Object.keys(card.tcgplayer.prices) : [],
      );
    }
  } catch (e) {
    opts.logger?.(`tcg-match: price-finish fetch failed: ${(e as Error)?.message}`);
  }
  return out;
}

/**
 * Match an extracted card identity against pokemontcg.io.
 *
 * Tries the query strategies in order (name+number+set first, falling back to
 * looser queries) until one returns data, then scores and ranks the results.
 * Returns at most `limit` candidates (default 5), best first. Never throws on
 * an empty result — returns `[]`.
 */
export async function matchCard(
  identity: CardIdentity,
  opts: MatchOptions & { limit?: number } = {},
): Promise<CandidateCard[]> {
  const limit = opts.limit ?? 5;
  const queries = buildQueries(identity);
  let cards: RawCard[] = [];

  for (const q of queries) {
    const url = buildCardUrl(q, Math.max(limit, 10));
    try {
      const body = (await httpGetJson(url, opts)) as RawResponse;
      if (body?.data?.length) {
        cards = body.data;
        break;
      }
    } catch (e) {
      opts.logger?.(`tcg-match: query "${q}" failed: ${(e as Error)?.message}`);
      // Network/API failure on one strategy — fall through to the next.
    }
  }

  return cards
    .map((c) => toCandidate(c, identity))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
