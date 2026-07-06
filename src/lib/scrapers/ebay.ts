import FirecrawlApp from "@mendable/firecrawl-js";
import { PricePoint } from "../models";

const FIRECRAWL_API_KEY=process.env.FIRECRAWL_API_KEY || "";
const app = FIRECRAWL_API_KEY ? new FirecrawlApp({ apiKey: FIRECRAWL_API_KEY }) : null;

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

async function firecrawlScrape(url: string): Promise<string | null> {
  if (!app) return null;
  try {
    const doc = await app.scrapeUrl(url, {
      formats: ["markdown"],
      onlyMainContent: true,
    });
    return doc?.markdown || null;
  } catch (e) {
    console.error("Firecrawl eBay scrape failed:", e);
    return null;
  }
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

  // Try table format first: eBay renders results in a table with
  // Item, Price, Condition columns. Firecrawl turns markdown tables
  // into rows starting with "| Item | Price | Condition |".
  const tableRows = content.match(/^\|((?!\s*[-:]+\s*\|).*?)\|/gm);
  if (tableRows) {
    for (const row of tableRows) {
      // Skip header and separator rows
      if (/\|\s*Item\s*\|/i.test(row)) continue;
      if (/\|[\s-:]+\|/.test(row)) continue;

      const cells = row.split("|").map(c => c.trim()).filter(Boolean);
      if (cells.length < 2) continue;

      const priceMatch = row.match(/\$([\d,.]+)/);
      if (!priceMatch) continue;

      const price = parseFloat(priceMatch[1].replace(/,/g, ""));
      if (isNaN(price)) continue;

      // Condition is usually in the last cell; look for known keywords
      const condMatch = row.match(
        /(?:Brand New|New|Pre-Owned|Very Good|Good|Acceptable|Lightly Played|Heavily Played|Moderately Played|Near Mint|Preowned)/i
      );

      // Item title is the first cell
      const _itemCell = cells[0];
      void _itemCell;

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

  // Fallback: parse as free-form blocks (legacy markdown without tables)
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
