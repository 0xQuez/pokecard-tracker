import { fetchPage } from "./fetch-page";
import { PricePoint, CardCondition } from "../models";

// ── eBay sold-listings fetch ─────────────────────────────────────────────

export async function searchSoldItems(
  query: string,
  options?: { limit?: number }
): Promise<PricePoint[]> {
  const limit = options?.limit ?? 25;
  const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query + " pokemon card")}&LH_Sold=1&LH_Complete=1&_ipg=${Math.min(limit * 2, 50)}`;
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
  const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(cardName + " PSA " + grade + " pokemon card")}&LH_Sold=1&LH_Complete=1&_ipg=${Math.min(limit * 2, 50)}`;
  const html = await fetchPage(url);
  if (!html) return [];
  return parseSoldListings(html, limit);
}

// ── Condition parsing ────────────────────────────────────────────────────

function parseCondition(text: string): CardCondition | null {
  const t = text.toLowerCase();
  if (/\b(near mint|mint|brand new|sealed|new\s*\(other\)|new other)\b/.test(t)) return "NM";
  if (/\b(lightly played|lp|pre[-\s]?owned)\b/.test(t)) return "LP";
  if (/\b(moderately played|mp)\b/.test(t)) return "MP";
  if (/\b(heavily played|hp)\b/.test(t)) return "HP";
  if (/\b(damaged|for parts)\b/.test(t)) return "DMG";
  return null;
}

// ── eBay Firecrawl markdown parsing ──────────────────────────────────────
// Firecrawl returns markdown with:
//   Sold Jul 21, 2026
//   [Title...](link)
//   Pre-Owned
//   $79.43
//   or Best Offer
//   Free delivery
//
// We extract blocks that contain a "Sold" date line and a price line.

function parseSoldListings(content: string, limit: number): PricePoint[] {
  const results: PricePoint[] = [];
  const lines = content.split("\n");
  const seenPrices = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Look for "Sold <Month> <day>, <year>" lines
    const soldMatch = line.match(/^Sold [A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    if (!soldMatch) continue;

    // Scan forward within next ~25 lines for price, condition, and URL
    let price: number | null = null;
    let condition: CardCondition | null = null;
    let url: string | null = null;
    let stop = Math.min(i + 25, lines.length);

    for (let j = i + 1; j < stop; j++) {
      const l = lines[j].trim();

      // Extract URL from markdown link [Title](https://www.ebay.com/itm/...)
      if (!url) {
        const urlMatch = l.match(/^\[.+\]\((https:\/\/www\.ebay\.com\/itm\/\d+[^\)]+)\)/);
        if (urlMatch) {
          url = urlMatch[1].split("?")[0]; // Strip query params for cleaner URL
        }
      }

      // Condition
      if (!condition) {
        const c = parseCondition(l);
        if (c) condition = c;
      }

      // Price — skip "with coupon" / "shipping" / "delivery" / "to"
      const priceMatch = l.match(/^\$([\d,]+\.\d{2})$/);
      if (priceMatch) {
        const nextL = lines[j + 1]?.trim() || "";
        if (
          nextL.includes("delivery") ||
          nextL.includes("shipping") ||
          nextL.includes("with coupon") ||
          nextL.includes("to $")
        ) {
          continue;
        }
        price = parseFloat(priceMatch[1].replace(/,/g, ""));
        break;
      }

      // Another sold line means we missed the price for this block
      if (/^Sold [A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(l)) break;
    }

    if (price && price > 0 && !seenPrices.has(price)) {
      seenPrices.add(price);
      results.push({
        source: "ebay" as const,
        priceUsd: price,
        condition,
        url,
        date: null,
        isSoldPrice: true,
      });
      if (results.length >= limit) break;
    }
  }

  return results;
}
