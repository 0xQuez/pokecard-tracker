import { fetchPage } from "./fetch-page";
import { PricePoint } from "../models";

// ── eBay sold-listings fetch ─────────────────────────────────────────────

export async function searchSoldItems(
  query: string,
  options?: { limit?: number }
): Promise<PricePoint[]> {
  const limit = options?.limit ?? 25;
  const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query + " pokemon card")}&LH_Sold=1&LH_Complete=1&_ipg=${Math.min(limit, 50)}`;
  const html = await fetchPage(url);
  if (!html) return [];
  return parseSoldListings(html, limit);
}

export async function searchGradedSoldItems(
  cardName: string,
  grade: number,
  options?: { limit?: number }
): Promise<PricePoint[]> {
  const limit = options?.limit ?? 15;
  const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(`"${cardName}" PSA ${grade} pokemon card`)}&LH_Sold=1&LH_Complete=1&_ipg=${Math.min(limit, 50)}`;
  const html = await fetchPage(url);
  if (!html) return [];
  return parseSoldListings(html, limit);
}

// ── Sold-listings parsing ────────────────────────────────────────────────

function parseCondition(text: string): string | null {
  const t = text.toLowerCase();
  if (/(near mint|mint|brand new|sealed)/.test(t)) return "NM";
  if (/(lightly played|lp|very good|pre-owned|preowned)/.test(t)) return "LP";
  if (/(moderately played|mp|good)/.test(t)) return "MP";
  if (/(heavily played|hp|acceptable)/.test(t)) return "HP";
  if (/(damaged|for parts)/.test(t)) return "DMG";
  return null;
}

function parseSoldListings(content: string, limit: number): PricePoint[] {
  const results: PricePoint[] = [];

  // Strategy 1: table rows
  const tableRows = content.match(/^\|.*?\|$/gm);
  if (tableRows) {
    for (const row of tableRows) {
      if (/\|\s*Item\s*\|/i.test(row)) continue;
      if (/\|[\s:;-]+\|/.test(row)) continue;

      const priceMatch = row.match(/\$([\d,.]+)/);
      if (!priceMatch) continue;

      const price = parseFloat(priceMatch[1].replace(/,/g, ""));
      if (Number.isNaN(price)) continue;

      const condMatch = row.match(
        /(Brand New|New|Pre-Owned|Very Good|Good|Acceptable|Lightly Played|Heavily Played|Moderately Played|Near Mint|Preowned)/i
      );

      results.push({
        source: "ebay" as const,
        priceUsd: price,
        condition: (condMatch ? parseCondition(condMatch[0]) : null) as any,
        url: null,
        date: null,
        isSoldPrice: true,
      });

      if (results.length >= limit) return results;
    }
  }

  // Strategy 2: free-form blocks
  if (results.length === 0) {
    const blocks = content.split(/\n\n+/);
    for (const block of blocks) {
      const priceMatch = block.match(/\$([\d,.]+)/);
      if (!priceMatch) continue;

      const price = parseFloat(priceMatch[1].replace(/,/g, ""));
      if (Number.isNaN(price)) continue;

      const condMatch = block.match(
        /(Brand New|New|Pre-Owned|Very Good|Good|Acceptable|Lightly Played|Heavily Played|Moderately Played|Near Mint|Preowned)/i
      );

      results.push({
        source: "ebay" as const,
        priceUsd: price,
        condition: (condMatch ? parseCondition(condMatch[0]) : null) as any,
        url: null,
        date: null,
        isSoldPrice: true,
      });

      if (results.length >= limit) break;
    }
  }

  return results;
}
