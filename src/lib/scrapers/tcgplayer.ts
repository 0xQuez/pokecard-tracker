import FirecrawlApp from "@mendable/firecrawl-js";
import { CardIdentity, PricePoint } from "../models";

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || "";
const app = FIRECRAWL_API_KEY ? new FirecrawlApp({ apiKey: FIRECRAWL_API_KEY }) : null;

// ── Progressive search: broaden query if exact match returns nothing ─────────

function broadenedQueries(raw: string): string[] {
  const q = raw.trim();
  if (!q) return [];
  const steps = new Set<string>();
  steps.add(q);

  // Step 1: remove grading qualifiers (PSA, BGS, CGC, SGC + number)
  let next = q
    .replace(/\b(psa|bgs|cgc|sgc)\s*\d+\b/gi, "")
    .replace(/\b(graded|ungraded|raw)\b/gi, "")
    .trim();
  if (next.length > 2) steps.add(next);

  // Step 2: remove finish qualifiers (Reverse Holo, Holo, Foil, etc.)
  next = next
    .replace(/\breverse\s*(holo|foil)\b/gi, "")
    .replace(/\b(holo(gra)?phic|foil|non[-\s]?holo|full[-\s]?art)\b/gi, "")
    .trim();
  if (next.length > 2) steps.add(next);

  // Step 3: remove edition / promo qualifiers
  next = next
    .replace(/\b(1st\s*(edition|ed)|first\s*edition)\b/gi, "")
    .replace(/\bpromo(tional)?\b/gi, "")
    .replace(/\bprerelease\b/gi, "")
    .replace(/\bjumbo|oversized\b/gi, "")
    .trim();
  if (next.length > 2) steps.add(next);

  // Step 4: remove common Pokémon TCG set names (single pass, longest first)
  const setNames = [
    /\bscarlet\s+(&\s+|and\s+)?violet\b/gi,
    /\bsword\s+(&\s+|and\s+)?shield\b/gi,
    /\bsun\s+(&\s+|and\s+)?moon\b/gi,
    /\bblack\s+(&\s+|and\s+)?white\b/gi,
    /\bdiamond\s+(&\s+|and\s+)?pearl\b/gi,
    /\bruby\s+(&\s+|and\s+)?sapphire\b/gi,
    /\bteam\s+magma\s+vs\s+team\s+aqua\b/gi,
    /\bteam\s+rocket\s+returns\b/gi,
    /\bbase\s+set\b/gi,
    /\bteam\s+rocket\b/gi,
    /\bgym\s+(heroes|challenge)\b/gi,
    /\bneo\s+(genesis|discovery|revelation|destiny)\b/gi,
    /\bexpedition\b/gi,
    /\bsandstorm\b/gi,
    /\bdragon\b/gi,
    /\bhidden\s+legends\b/gi,
    /\bfirered\s+(&\s+|and\s+)?leafgreen\b/gi,
    /\bdeoxys\b/gi,
    /\bemerald\b/gi,
    /\bunseen\s+forces\b/gi,
    /\bdelta\s+species\b/gi,
    /\blegend\s+maker\b/gi,
    /\bholon\s+phantoms\b/gi,
    /\bcrystal\s+guardians\b/gi,
    /\bdragon\s+frontiers\b/gi,
    /\bpower\s+keepers\b/gi,
    /\bmysterious\s+treasures\b/gi,
    /\bsecret\s+wonders\b/gi,
    /\bgreat\s+encounters\b/gi,
    /\bmajestic\s+dawn\b/gi,
    /\bstormfront\b/gi,
    /\bplatinum\b/gi,
    /\brising\s+rivals\b/gi,
    /\bsupreme\s+victors\b/gi,
    /\barceus\b/gi,
    /\bnext\s+destinies\b/gi,
    /\bdark\s+explorers\b/gi,
    /\bdragons\s+exalted\b/gi,
    /\bboundaries\s+crossed\b/gi,
    /\bplasma\s+(storm|freeze|blast)\b/gi,
    /\blegendary\s+treasures\b/gi,
    /\bprimal\s+clash\b/gi,
    /\broaring\s+skies\b/gi,
    /\bancient\s+origins\b/gi,
    /\bbreakthrough\b/gi,
    /\bbreakpoint\b/gi,
    /\bfates\s+collide\b/gi,
    /\bsteam\s+siege\b/gi,
    /\bevolutions\b/gi,
    /\bguardians\s+rising\b/gi,
    /\bburning\s+shadows\b/gi,
    /\bshining\s+legends\b/gi,
    /\bcrimson\s+invasion\b/gi,
    /\bultra\s+prism\b/gi,
    /\bforbidden\s+light\b/gi,
    /\bcelestial\s+storm\b/gi,
    /\blost\s+thunder\b/gi,
    /\bteam\s+up\b/gi,
    /\bunbroken\s+bonds\b/gi,
    /\bunified\s+minds\b/gi,
    /\bhidden\s+fates\b/gi,
    /\bcosmic\s+eclipse\b/gi,
    /\brebel\s+clash\b/gi,
    /\bdarkness\s+ablaze\b/gi,
    /\bvivid\s+voltage\b/gi,
    /\bshining\s+fates\b/gi,
    /\bbattle\s+styles\b/gi,
    /\bchilling\s+reign\b/gi,
    /\bevolving\s+skies\b/gi,
    /\bfusion\s+strike\b/gi,
    /\bbrilliant\s+stars\b/gi,
    /\bastral\s+radiance\b/gi,
    /\blost\s+origin\b/gi,
    /\bsilver\s+tempest\b/gi,
    /\bcrown\s+zenith\b/gi,
    /\b151\b/gi,
    /\bpaldea\s+evolved\b/gi,
    /\bobsidian\s+flames\b/gi,
    /\bparadox\s+rift\b/gi,
    /\bpaldean\s+fates\b/gi,
    /\btemporal\s+forces\b/gi,
    /\btwilight\s+masquerade\b/gi,
    /\bshrouded\s+fable\b/gi,
    /\bstellar\s+crown\b/gi,
    /\bsurging\s+sparks\b/gi,
  ];

  let beforeSets = next;
  for (const rx of setNames) {
    const after = next.replace(rx, "").trim();
    if (after !== next && after.length > 2) {
      steps.add(after);
      next = after;
    }
  }
  // Ensure the final stripped version is captured even if no sets matched
  if (beforeSets !== q && beforeSets.length > 2) {
    steps.add(beforeSets);
  }

  // Step 5: remove card number fragments like "25/102" or "#25"
  next = next.replace(/\b\d{1,3}\/\d{1,3}[a-z]?\b/gi, "").replace(/#\s*\d+\b/gi, "").trim();
  if (next.length > 2) steps.add(next);

  return Array.from(steps);
}

export async function searchCards(query: string): Promise<(CardIdentity & { marketPrice?: number })[]> {
  const queries = broadenedQueries(query);
  if (queries.length === 0) return [];

  for (const q of queries) {
    const url = `https://www.tcgplayer.com/search/pokemon/product?q=${encodeURIComponent(q)}`;
    const content = await firecrawlScrape(url);
    if (!content) continue;

    const results = parseSearchResults(content);
    if (results.length > 0) {
      return results.slice(0, 10);
    }
  }

  return [];
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

// ── Search result parsing ────────────────────────────────────────────────────

interface RawSearchResult {
  name: string;
  setName: string | null;
  productId: string;
  marketPrice: number | null;
}

function parseSearchResults(content: string): CardIdentity[] {
  const dedupe = new Map<string, RawSearchResult>();

  // Strategy 1: markdown table rows (TCGPlayer renders search results as tables)
  const tableRows = extractTableRows(content);
  for (const row of tableRows) {
    const item = extractFromTableRow(row);
    if (item && !dedupe.has(item.productId)) {
      dedupe.set(item.productId, item);
    }
  }

  // Strategy 2: paragraph / block-level parsing for non-table layouts
  if (dedupe.size === 0) {
    const blocks = content.split(/\n\s*\n/);
    for (const block of blocks) {
      const item = extractFromBlock(block);
      if (item && !dedupe.has(item.productId)) {
        dedupe.set(item.productId, item);
      }
    }
  }

  // Strategy 3: line-by-line fallback with look-ahead for prices
  if (dedupe.size === 0) {
    const lines = content.split(/\n/);
    for (let i = 0; i < lines.length; i++) {
      const item = extractFromLine(lines[i], lines[i + 1] || "");
      if (item && !dedupe.has(item.productId)) {
        dedupe.set(item.productId, item);
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

// ── Extraction helpers ───────────────────────────────────────────────────────

function extractTableRows(content: string): string[][] {
  const rows: string[][] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|")) {
      const cells = trimmed
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      if (cells.length >= 2 && !/^[-:]+$/.test(cells[0])) {
        rows.push(cells);
      }
    }
  }
  return rows;
}

function extractFromTableRow(cells: string[]): RawSearchResult | null {
  let name: string | null = null;
  let productId: string | null = null;
  let setName: string | null = null;
  let marketPrice: number | null = null;

  for (const cell of cells) {
    // Look for a TCGPlayer product link
    const linkMatch = cell.match(/\[([^\]]+)\]\([^)]*\/product\/(\d+)[^)]*\)/);
    if (linkMatch && !name) {
      name = linkMatch[1].trim();
      productId = linkMatch[2];
    }

    // Heuristic: cell that looks like a set name (no price, no link, not rarity/number, reasonable length)
    if (!setName && isLikelySetName(cell)) {
      setName = cell;
    }

    // Extract price, preferring "Market" label
    if (marketPrice === null) {
      marketPrice = extractLabeledPrice(cell, /market/i) ?? extractFirstPrice(cell);
    }
  }

  if (!name || !productId) return null;
  return { name, productId, setName, marketPrice };
}

function extractFromBlock(block: string): RawSearchResult | null {
  const linkMatch = block.match(/\[([^\]]+)\]\([^)]*\/product\/(\d+)[^)]*\)/);
  if (!linkMatch) return null;

  const name = linkMatch[1].trim();
  const productId = linkMatch[2];

  const afterLink = block.slice(block.indexOf(linkMatch[0]) + linkMatch[0].length);
  const setMatch = afterLink.match(/^\s*[-–—]\s*([^$\n]{2,40})/);
  const setName = setMatch ? setMatch[1].trim() : null;

  const marketPrice = extractLabeledPrice(block, /market/i) ?? extractFirstPrice(block);

  return { name, productId, setName, marketPrice };
}

function extractFromLine(line: string, nextLine: string): RawSearchResult | null {
  const linkMatch = line.match(/\[([^\]]+)\]\([^)]*\/product\/(\d+)[^)]*\)/);
  if (!linkMatch) return null;

  const name = linkMatch[1].trim();
  const productId = linkMatch[2];
  const combined = line + " " + nextLine;

  let setName: string | null = null;
  const setMatch = combined.match(/(?:Set|Expansion|Series)[:：]\s*([^\n$]{2,40})/i);
  if (setMatch) setName = setMatch[1].trim();

  const marketPrice = extractLabeledPrice(combined, /market/i) ?? extractFirstPrice(combined);

  return { name, productId, setName, marketPrice };
}

function isLikelySetName(cell: string): boolean {
  const trimmed = cell.trim();
  if (!trimmed || trimmed.length < 3 || trimmed.length > 60) return false;
  if (/[\$\[\]]/.test(trimmed)) return false; // no prices / links
  if (/^\d{1,3}\/\d{1,3}[a-z]?$/i.test(trimmed)) return false; // card number like 25/102
  if (/^\d+$/.test(trimmed)) return false; // pure number
  const rarityWords = /\b(common|uncommon|rare|holo rare|secret rare|ultra rare|promo|shiny|basic|stage 1|stage 2|vstar|vmax|ex|gx|v)\b/i;
  if (rarityWords.test(trimmed)) return false;
  return true;
}

function extractLabeledPrice(text: string, label: RegExp): number | null {
  const rx = new RegExp(label.source + "[:\s$]*([\d,.]+)", "i");
  const m = text.match(rx);
  if (!m) return null;
  return cleanPrice(m[1]);
}

function extractFirstPrice(text: string): number | null {
  const m = text.match(/\$([\d,.]+)/);
  if (!m) return null;
  return cleanPrice(m[1]);
}

function cleanPrice(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "");
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
}

// ── Price page parsing ───────────────────────────────────────────────────────

function parsePricePage(content: string) {
  const lines = content.split(/\n/);

  let normalMarket: number | null = null;
  let foilMarket: number | null = null;
  let listedMedian: number | null = null;

  for (const line of lines) {
    const lower = line.toLowerCase();

    // "Normal Market Price: $123.45" or just "Normal Market Price $123.45"
    const nm = line.match(/Normal\s+Market\s*Price[:\s$]*([\d,.]+)/i);
    if (nm) normalMarket = cleanPrice(nm[1]);

    // "Foil Market Price: $123.45"
    const fm = line.match(/Foil\s+Market\s*Price[:\s$]*([\d,.]+)/i);
    if (fm) foilMarket = cleanPrice(fm[1]);

    // "Listed Median (Near Mint): $123.45" or "Listed Median (NM): $123.45"
    const lm = line.match(/Listed\s+Median\s*\((?:Near\s+Mint|NM)\)[:\s$]*([\d,.]+)/i);
    if (lm) listedMedian = cleanPrice(lm[1]);

    // Also catch "Listed Median: $123.45" as a weaker fallback
    if (listedMedian === null) {
      const lm2 = line.match(/Listed\s+Median[:\s$]*([\d,.]+)/i);
      if (lm2 && !lower.includes("normal market") && !lower.includes("foil market")) {
        listedMedian = cleanPrice(lm2[1]);
      }
    }
  }

  const marketPrice = normalMarket ?? foilMarket;
  return { marketPrice, medianPrice: listedMedian, listings: [] as PricePoint[] };
}
