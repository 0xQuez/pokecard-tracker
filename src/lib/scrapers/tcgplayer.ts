import { fetchPage } from "./fetch-page";
import { CardIdentity, PricePoint } from "../models";

// ── TCGPlayer search + price parsing via direct HTML fetch ──────────────

export async function searchCards(query: string): Promise<(CardIdentity & { marketPrice?: number })[]> {
  const url = `https://www.tcgplayer.com/search/pokemon/product?q=${encodeURIComponent(query)}`;
  const html = await fetchPage(url);
  if (!html) return [];
  return parseSearchResults(html).slice(0, 10);
}

export async function getMarketPrice(productId: number): Promise<{
  marketPrice: number | null;
  medianPrice: number | null;
  listings: PricePoint[];
}> {
  const url = `https://www.tcgplayer.com/product/${productId}`;
  const html = await fetchPage(url);
  if (!html) return { marketPrice: null, medianPrice: null, listings: [] };
  return parsePricePage(html);
}

// ── Search result parsing from TCGPlayer page content ───────────────────

interface RawSearchResult {
  name: string;
  setName: string | null;
  productId: string;
  marketPrice: number | null;
}

function parseSearchResults(content: string): CardIdentity[] {
  const dedupe = new Map<string, RawSearchResult>();

  const productRegex =
    /\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\/product\/(\d+)[^)]*\)[\\\s]*\*\*([^*]+)\*\*[\\\s]*\*([^*]+)\*[\\\s]*([^\n]+?)[\\\s]*listings from \$([\d,.]+)[\\\s]*Market Price:\$([\d,.]+)/gi;

  let match;
  while ((match = productRegex.exec(content)) !== null) {
    const [, pid, setName,, name, marketPriceRaw] = match;
    const price = cleanPrice(marketPriceRaw);
    if (!dedupe.has(pid)) {
      dedupe.set(pid, {
        name: name.trim(),
        setName: setName.trim(),
        productId: pid,
        marketPrice: price,
      });
    }
  }

  if (dedupe.size === 0) {
    const linkRegex = /\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\/product\/(\d+)[^)]*\)[\\\s]*\*\*([^*]+)\*\*/gi;
    while ((match = linkRegex.exec(content)) !== null) {
      const [, pid, setName] = match;
      if (!dedupe.has(pid)) {
        dedupe.set(pid, {
          name: "",
          setName: setName.trim(),
          productId: pid,
          marketPrice: null,
        });
      }
    }
  }

  return Array.from(dedupe.values()).map((r) => ({
    name: r.name,
    set: r.setName,
    cardNumber: null,
    setId: r.productId,
    marketPrice: r.marketPrice ?? undefined,
  }));
}

// ── Price page parsing ───────────────────────────────────────────────────

function parsePricePage(content: string) {
  const lines = content.split(/\n/);

  let normalMarket: number | null = null;
  let foilMarket: number | null = null;
  let listedMedian: number | null = null;

  for (const line of lines) {
    const nm = line.match(/Normal\s+Market\s*Price[:$\s]*([\d,.]+)/i);
    if (nm) normalMarket = cleanPrice(nm[1]);

    const fm = line.match(/Foil\s+Market\s*Price[:$\s]*([\d,.]+)/i);
    if (fm) foilMarket = cleanPrice(fm[1]);

    const lm = line.match(/Listed\s+Median(?:\s*\(\s*(?:Near\s+Mint|NM)\s*\))?[:$\s]*([\d,.]+)/i);
    if (lm) listedMedian = cleanPrice(lm[1]);

    if (listedMedian === null) {
      const lm2 = line.match(/Listed\s+Median[:$\s]*([\d,.]+)/i);
      const lower = line.toLowerCase();
      if (lm2 && !lower.includes("normal market") && !lower.includes("foil market")) {
        listedMedian = cleanPrice(lm2[1]);
      }
    }
  }

  const marketPrice = normalMarket ?? foilMarket;
  return { marketPrice, medianPrice: listedMedian, listings: [] as PricePoint[] };
}

function cleanPrice(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "");
  const parsed = parseFloat(cleaned);
  return Number.isNaN(parsed) ? null : parsed;
}
