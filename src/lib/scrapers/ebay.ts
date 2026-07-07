import { firecrawlScrape } from "./firecrawl-rest";
import { PricePoint } from "../models";

export async function searchSoldItems(
  query: string,
  options?: { limit?: number }
): Promise<PricePoint[]> {
  const limit = options?.limit ?? 25;
  const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query + " pokemon card")}&LH_Sold=1&LH_Complete=1&_ipg=${Math.min(limit, 50)}`;
  const content = await firecrawlScrape(url);
  if (!content) return [];
  return parseSoldListings(content, limit);
}

export async function searchGradedSoldItems(
  cardName: string,
  grade: number,
  options?: { limit?: number }
): Promise<PricePoint[]> {
  const limit = options?.limit ?? 15;
  const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(`"${cardName}" PSA ${grade} pokemon card`)}&LH_Sold=1&LH_Complete=1&_ipg=${Math.min(limit, 50)}`;
  const content = await firecrawlScrape(url);
  if (!content) return [];
  return parseSoldListings(content, limit);
}

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

  // Try table format first
  const tableRows = content.match(/^\|((?!\s*[-:]+\s*\|).*?)\|/gm);
  if (tableRows) {
    for (const row of tableRows) {
      if (/\|\s*Item\s*\|/i.test(row)) continue;
      if (/\|[\s-:]+\|/.test(row)) continue;

      const cells = row.split("|").map((c) => c.trim()).filter(Boolean);
      if (cells.length < 2) continue;

      const priceMatch = row.match(/\$([\d,.]+)/);
      if (!priceMatch) continue;

      const price = parseFloat(priceMatch[1].replace(/,/g, ""));
      if (isNaN(price)) continue;

      const condMatch = row.match(
        /(?:Brand New|New|Pre-Owned|Very Good|Good|Acceptable|Lightly Played|Heavily Played|Moderately Played|Near Mint|Preowned)/i
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
    return results;
  }

  // Fallback: free-form blocks
  const blocks = content.split(/\n\n+/);
  for (const block of blocks) {
    const priceMatch = block.match(/\$([\d,.]+)/);
    const condMatch = block.match(
      /(?:Brand New|New|Pre-Owned|Very Good|Good|Acceptable|Lightly Played|Heavily Played|Moderately Played|Near Mint|Preowned)/i
    );
    if (priceMatch) {
      const price = parseFloat(priceMatch[1].replace(/,/g, ""));
      if (isNaN(price)) continue;
      results.push({
        source: "ebay" as const,
        priceUsd: price,
        condition: (condMatch ? parseCondition(condMatch[0]) : null) as any,
        url: null,
        date: null,
        isSoldPrice: true,
      });
    }
    if (results.length >= limit) break;
  }
  return results;
}
