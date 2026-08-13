/**
 * pokemontcg-catalog.ts — Live IdentifyCatalog backed by the free
 * pokemontcg.io v2 API (T20).
 *
 * The API is free (no key) but flaky under bursts — it intermittently 500s.
 * Every query is wrapped in `fetchWithRetry` (exponential backoff + jitter),
 * and the module tracks a health flag so a zero-match can be distinguished
 * from "catalog is down" (the matcher surfaces a retry warning instead of a
 * misleading no-match).
 */

import type { CatalogCard, IdentifyCatalog } from "./identity-matcher";

const API_BASE = "https://api.pokemontcg.io/v2";

// ── Retry-with-backoff ────────────────────────────────────────────────────────

export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY: RetryOptions = {
  attempts: 4, // 1 initial + 3 retries
  baseDelayMs: 500,
  maxDelayMs: 4000,
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Fetch with exponential backoff + full jitter. Retries on network errors and
 * HTTP 5xx (the flaky-burst failure mode verified in earlier tasks). Resolves
 * the final non-2xx response or throws on network failure.
 *
 * `fetchFn` is injectable for tests (defaults to global fetch).
 */
export async function fetchWithRetry(
  url: string,
  opts: RetryOptions = DEFAULT_RETRY,
  init?: RequestInit,
  fetchFn: typeof fetch = fetch
): Promise<Response> {
  let lastRes: Response | null = null;
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < opts.attempts; attempt++) {
    try {
      const res = await fetchFn(url, init);
      if (res.ok) return res;
      lastRes = res;
      if (res.status < 500) return res; // 4xx won't fix itself with a retry
      // 5xx — fall through to backoff and retry.
    } catch (e) {
      lastErr = e; // network error — retry
    }

    if (attempt < opts.attempts - 1) {
      // Full jitter: random delay in [0, base*2^attempt], capped.
      const cap = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** attempt);
      const delay = Math.floor(Math.random() * (cap + 1));
      await sleep(delay);
    }
  }

  if (lastRes) return lastRes;
  throw lastErr instanceof Error
    ? lastErr
    : new Error("fetchWithRetry network failure");
}

// ── Catalog health flag ───────────────────────────────────────────────────────

let lastError: string | null = null;

function setError(msg: string | null) {
  lastError = msg;
}

// ── Raw payload mapping ───────────────────────────────────────────────────────

interface RawApiCard {
  id: string;
  name: string;
  number: string;
  set?: { id: string; name: string; ptcgoCode: string | null } | null;
  images?: { small?: string | null } | null;
  tcgplayer?: {
    prices?: Record<string, { market?: number } | undefined> | null;
  } | null;
}

/** Best market price from tcgplayer.prices across variants. */
function marketPrice(card: RawApiCard): number | null {
  const prices = card.tcgplayer?.prices;
  if (!prices) return null;
  let best: number | null = null;
  for (const p of Object.values(prices)) {
    if (p && typeof p.market === "number" && p.market > 0) {
      best = best === null ? p.market : Math.max(best, p.market);
    }
  }
  return best;
}

/** Which print variants the catalog says exist (tcgplayer.prices keys). */
function availableVariants(card: RawApiCard): string[] {
  const keys = Object.keys(card.tcgplayer?.prices ?? {});
  if (keys.length === 0) return [];
  return keys.map((k) => k.toLowerCase());
}

function mapCard(c: RawApiCard): CatalogCard {
  return {
    id: c.id,
    name: c.name,
    number: c.number,
    setId: c.set?.id ?? "",
    setName: c.set?.name ?? "",
    ptcgoCode: c.set?.ptcgoCode ?? null,
    price: marketPrice(c),
    imageUrl: c.images?.small ?? null,
    availableVariants: availableVariants(c),
  };
}

// ── Live catalog ──────────────────────────────────────────────────────────────

export const pokemontcgIdentifyCatalog: IdentifyCatalog = {
  async searchCards({ name, number, setHints }, limit = 10) {
    // pokemontcg.io name is an exact-phrase match, so use wildcards.
    const wcName = `name:*${name.replace(/[*"]/g, "").trim().replace(/\s+/g, "*")}*`;
    const parts: string[] = [wcName];
    if (number) parts.push(`number:${number}`);
    const q = parts.join(" ");
    const pageSize = Math.max(limit, 40);
    const url = `${API_BASE}/cards?q=${encodeURIComponent(q)}&pageSize=${pageSize}`;

    const fetchJson = async (u: string): Promise<RawApiCard[]> => {
      try {
        const res = await fetchWithRetry(u, DEFAULT_RETRY, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) {
          setError(`catalog HTTP ${res.status}`);
          return [];
        }
        const data = (await res.json()) as { data?: RawApiCard[] };
        setError(null);
        return data.data || [];
      } catch (e) {
        setError(`catalog fetch failed: ${(e as Error).message}`);
        return [];
      }
    };

    let cards = await fetchJson(url);
    if (cards.length === 0) {
      // Broader fallback: name only (drop the number).
      const fallback = `${API_BASE}/cards?q=${encodeURIComponent(wcName)}&pageSize=${pageSize}`;
      cards = await fetchJson(fallback);
    }

    let mapped = cards.map(mapCard);

    // Surface the most specific matching set first (like card-identity.ts).
    if (setHints && setHints.length > 0) {
      const primary = setHints[0].toLowerCase();
      mapped = mapped.sort((a, b) => {
        const am = a.setName.toLowerCase().includes(primary) ? 1 : 0;
        const bm = b.setName.toLowerCase().includes(primary) ? 1 : 0;
        if (am !== bm) return bm - am;
        // Tie: prefer exact number match.
        if (number) {
          const an = a.number === number ? 1 : 0;
          const bn = b.number === number ? 1 : 0;
          if (an !== bn) return bn - an;
        }
        return 0;
      });
    }

    return mapped.slice(0, limit);
  },
  health() {
    return lastError
      ? { degraded: true, message: lastError }
      : { degraded: false };
  },
};
