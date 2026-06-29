import FirecrawlApp from "@mendable/firecrawl-js";
import { CardIdentity, PricePoint } from "../models";

const FIRECRAWL_API_KEY=process.env.FIRECRAWL_API_KEY || "";
const app = FIRECRAWL_API_KEY ? new FirecrawlApp({ apiKey: FIRECRAWL_API_KEY }) : null;

export async function searchCards(query: string): Promise<CardIdentity[]> {
  const url = `https://www.tcgplayer.com/search/pokemon/product?q=${encodeURIComponent(query)}`;
  const content = await firecrawlScrape(url);
  if (!content) return [];
  return parseSearchResults(content);
}

export async function getMarketPrice(productId: number): Promise<{
  marketPrice: number | null;
  medianPrice: number | null;
  listings: PricePoint[];
}> {
  const url = `https://www.tcgplayer.com/product/${productId}`;
  const content = await firecrawlScrape(url);
  if (!content) return { marketPrice: null, medianPrice: null, listings: [] };
  return parsePricePage(content);
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
    console.error("Firecrawl scrape failed:", e);
    return null;
  }
}

function parseSearchResults(content: string): CardIdentity[] {
  const results: CardIdentity[] = [];
  const linkPattern = /\[([^\]]+)\]\([^)]*\/product\/(\d+)[^)]*\)/g;
  let match;
  while ((match = linkPattern.exec(content)) !== null && results.length < 10) {
    results.push({ name: match[1].trim(), set: null, cardNumber: null, setId: match[2] });
  }
  return results;
}

function parsePricePage(content: string) {
  const marketPrice = extractPrice(content, /market\s*price[:\s$]*([\d,.]+)/i);
  const medianPrice = extractPrice(content, /median\s*price[:\s$]*([\d,.]+)/i);
  return { marketPrice, medianPrice, listings: [] as PricePoint[] };
}

function extractPrice(text: string, rx: RegExp): number | null {
  const m = text.match(rx);
  if (!m) return null;
  const cleaned = m[1].replace(/,/g, "");
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
}
