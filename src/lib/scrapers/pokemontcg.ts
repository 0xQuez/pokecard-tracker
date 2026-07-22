// Pokémon TCG API scraper — free, structured, no key needed.
// Replaces broken direct-fetch scraping of TCGPlayer CSR pages.
// Embeds TCGPlayer market/median prices directly.

import { CardIdentity, PricePoint } from "../models";

const API_BASE = "https://api.pokemontcg.io/v2";

// Map common set name aliases to TCG API set IDs
const SET_ALIASES: Record<string, string> = {
  "base set": "base",
  "base set 2": "base2",
  "jungle": "gym",
  "fossil": "fossil",
  "team rocket": "teamrocket",
  "neo genesis": "neo1",
  "neo discovery": "neo2",
  "neo revelation": "neo3",
  "neo destiny": "neo4",
  "expedition": "ecard1",
  "aquapolis": "ecard2",
  "skyridge": "ecard3",
  "ex ruby sapphire": "ex1",
  "ex sandstorm": "ex2",
  "ex dragon": "ex3",
  "ex team magma vs team aqua": "ex4",
  "ex hidden legends": "ex5",
  "ex firered leafgreen": "ex6",
  "ex deoxys": "ex7",
  "ex emerald": "ex8",
  "ex unseen forces": "ex9",
  "ex delta species": "ex10",
  "ex legend maker": "ex11",
  "ex holon phantoms": "ex12",
  "ex crystal guardians": "ex13",
  "ex dragon frontiers": "ex14",
  "ex power keepers": "ex15",
  "diamond pearl": "dp1",
  "mysterious treasures": "dp2",
  "secret wonders": "dp3",
  "great encounters": "dp4",
  "majestic dawn": "dp5",
  "legends awakened": "dp6",
  "stormfront": "dp7",
  "platinum": "pl1",
  "rising rivals": "pl2",
  "supreme victors": "pl3",
  "arceus": "pl4",
  "heartgold soulsilver": "hgss1",
  "unleashed": "hgss2",
  "undaunted": "hgss3",
  "triumphant": "hgss4",
  "call of legends": "col1",
  "black white": "bw1",
  "emerging powers": "bw2",
  "noble victories": "bw3",
  "next destinies": "bw4",
  "dark explorers": "bw5",
  "dragons exalted": "bw6",
  "boundaries crossed": "bw7",
  "plasma storm": "bw8",
  "plasma freeze": "bw9",
  "plasma blast": "bw10",
  "legendary treasures": "bw11",
  "xy": "xy1",
  "flashfire": "xy2",
  "furious fists": "xy3",
  "phantom forces": "xy4",
  "primal clash": "xy5",
  "roaring skies": "xy6",
  "ancient origins": "xy7",
  "breakthrough": "xy8",
  "breakpoint": "xy9",
  "fates collide": "xy10",
  "steam siege": "xy11",
  "evolutions": "xy12",
  "sun moon": "sm1",
  "guardians rising": "sm2",
  "burning shadows": "sm3",
  "shining legends": "sm35",
  "crimson invasion": "sm4",
  "ultra prism": "sm5",
  "forbidden light": "sm6",
  "celestial storm": "sm7",
  "lost thunder": "sm8",
  "team up": "sm9",
  "unbroken bonds": "sm10",
  "unified minds": "sm11",
  "hidden fates": "sm115",
  "cosmic eclipse": "sm12",
  "sword shield": "swsh1",
  "rebel clash": "swsh2",
  "darkness ablaze": "swsh3",
  "vivid voltage": "swsh4",
  "shining fates": "swsh45",
  "battle styles": "swsh5",
  "chilling reign": "swsh6",
  "evolving skies": "swsh7",
  "fusion strike": "swsh8",
  "brilliant stars": "swsh9",
  "astral radiance": "swsh10",
  "lost origin": "swsh11",
  "silver tempest": "swsh11",
  "crown zenith": "swsh12",
  "scarlet violet": "sv1",
  "paldea evolved": "sv2",
  "obsidian flames": "sv3",
  "paradox rift": "sv4",
  "paldean fates": "sv4pt5",
  "temporal forces": "sv5",
  "twilight masquerade": "sv6",
  "shrouded fable": "sv6pt5",
  "stellar crown": "sv7",
  "surging sparks": "sv8",
  "prismatic evolutions": "sv8pt5",
  "journey together": "sv9",
  "destined rivals": "sv10",
};

interface ParsedQuery {
  name: string;
  number: string | null;
  set: string | null;
  qualifiers: string[];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callApi(q: string, pageSize: number): Promise<any[]> {
  const url = `${API_BASE}/cards?q=${encodeURIComponent(q)}&pageSize=${pageSize}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      if (res.status >= 500) {
        // Server error — may be transient
        console.warn(`Pokemon TCG API 500 for query "${q}"`);
        return [];
      }
      console.error("Pokemon TCG API error:", res.status, await res.text());
      return [];
    }

    const data = await res.json();
    return data.data || [];
  } catch (e) {
    console.error("Pokemon TCG API network error:", e);
    return [];
  }
}

export function parseQuery(query: string): ParsedQuery {
  const q = query.trim().toLowerCase();

  // Extract card number like "104/147" or "4/102"
  const numberMatch = q.match(/(\d+\/\d+[a-z]?)/i);
  const rawNumber = numberMatch ? numberMatch[1] : null;
  // TCG API "number" field contains just the card number (e.g. "104"), not "104/147"
  const number = rawNumber ? rawNumber.split("/")[0] : null;

  // Detect set hint
  let set: string | null = null;
  for (const [hint, code] of Object.entries(SET_ALIASES)) {
    if (q.includes(hint)) {
      set = code;
      break;
    }
  }

  // Extract qualifiers
  const qualifiers: string[] = [];
  if (/\breverse\b/.test(q)) qualifiers.push("reverse");
  if (/\bholo\b/.test(q)) qualifiers.push("holo");
  if (/\bpsa\b/.test(q)) qualifiers.push("psa");
  if (/\b1st\b/.test(q) || /\bfirst\b/.test(q)) qualifiers.push("first");
  if (/\bshadowless\b/.test(q)) qualifiers.push("shadowless");

  // Extract card name: strip qualifiers, number, set hints
  let name = q;
  if (number) name = name.replace(rawNumber!, "").trim();
  // Also strip any remaining fractional patterns like "/147"
  name = name.replace(/\/\d+/, "").trim();
  // Strip detected set hints from name
  for (const [hint, _code] of Object.entries(SET_ALIASES)) {
    name = name.replace(new RegExp(`\\b${hint.replace(/\s+/g, "\\s+")}\\b`, "gi"), "").trim();
  }
  name = name
    .replace(/\b(reverse holo|holo|foil|1st edition|first edition|shadowless|unlimited|promo|psa \d+|graded|pokemon card|game boy|gameboy)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  // Strip leading year numbers
  name = name.replace(/^\d{4}\s+/, "");

  return { name, number, set, qualifiers };
}

function extractMarketPrice(card: any): number | undefined {
  const prices = card?.tcgplayer?.prices || {};
  for (const variant of ["normal", "holofoil", "reverseHolofoil", "firstEditionHolofoil", "firstEditionNormal"]) {
    const p = prices[variant];
    if (p?.market && p.market > 0) return p.market;
  }
  // Fall back to mid price
  for (const variant of ["normal", "holofoil", "reverseHolofoil", "firstEditionHolofoil", "firstEditionNormal"]) {
    const p = prices[variant];
    if (p?.mid && p.mid > 0) return p.mid;
  }
  return undefined;
}

function extractMedianPrice(card: any): number | undefined {
  const prices = card?.tcgplayer?.prices || {};
  for (const variant of ["normal", "holofoil", "reverseHolofoil", "firstEditionHolofoil", "firstEditionNormal"]) {
    const p = prices[variant];
    if (p?.mid && p.mid > 0) return p.mid;
  }
  return undefined;
}

/**
 * Search cards via Pokemon TCG API with eBay fallback.
 * Returns array of CardIdentity + optional marketPrice.
 */
export async function searchCards(query: string): Promise<(CardIdentity & { marketPrice?: number })[]> {
  const { name, number, set } = parseQuery(query);

  if (!name && !number) return [];

  // Build API query(s)
  const cards: any[] = [];

  if (name && number) {
    const combinedQ = `name:"${name}" number:"${number}"`;
    const results = await callApi(combinedQ, 20);
    if (results.length > 0) cards.push(...results);
  }

  if (cards.length === 0 && name) {
    let attempts = 0;
    while (attempts < 2) {
      const results = await callApi(`name:"${name}"`, 20);
      if (results.length > 0) {
        cards.push(...results);
        break;
      }
      attempts++;
      if (attempts < 2) await sleep(500);
    }
  }

  if (cards.length === 0 && name && name.includes(" ")) {
    const firstWord = name.split(" ")[0];
    const results = await callApi(`name:"${firstWord}"`, 20);
    if (results.length > 0) cards.push(...results);
  }

  if (cards.length > 0) {
    const scored = cards.map((card: any) => {
      let score = 0;
      const cardName = card.name?.toLowerCase() || "";
      const cardNumber = card.number || "";
      const cardSetId = card.set?.id || "";

      if (name) {
        const nameWords = name.split(/\s+/);
        for (const word of nameWords) {
          if (cardName.includes(word)) score += 10;
        }
        if (cardName === name || cardName.startsWith(name + " ")) score += 50;
      }

      if (number && cardNumber === number) score += 100;
      if (set && cardSetId === set) score += 30;
      // Only penalize if card name and search name are completely unrelated
      if (name && cardName !== name && !cardName.startsWith(name + " ") && !name.startsWith(cardName + " ") && !name.split(/\s+/).some(w => cardName.includes(w))) {
        score -= 50;
      }

      return { card, score };
    });

    scored.sort((a: any, b: any) => b.score - a.score);

    const seen = new Set<string>();
    const unique: any[] = [];
    for (const item of scored) {
      if (!seen.has(item.card.id)) {
        seen.add(item.card.id);
        unique.push(item);
      }
    }

    const apiResults = unique.slice(0, 10).map(({ card }: { card: any }) => ({
      name: card.name,
      set: card.set?.name || null,
      cardNumber: card.number || null,
      setId: card.id,
      marketPrice: extractMarketPrice(card),
      productUrl: card.tcgplayer?.url || null,
    }));

    // If we have 5+ results from API, return them
    if (apiResults.length >= 5) {
      return apiResults;
    }

    // Otherwise supplement with eBay sold listings
    try {
      const { searchSoldItems } = await import("./ebay");
      const sold = await searchSoldItems(query, { limit: Math.max(10, 10 - apiResults.length) });
      if (sold.length > 0) {
        const ebayResults = sold.map((s: PricePoint, i: number) => ({
          name: `${query} (eBay #${i + 1})`,
          set: null,
          cardNumber: number,
          setId: `ebay-${i}`,
          marketPrice: s.priceUsd,
          productUrl: s.url,
        }));
        return [...apiResults, ...ebayResults].slice(0, 10);
      }
    } catch (e) {
      console.error("eBay supplement search error:", e);
    }

    return apiResults;
  }

  // ── Fallback: eBay sold-listings search ──────────────────────────────
  try {
    const { searchSoldItems } = await import("./ebay");
    const sold = await searchSoldItems(query, { limit: 10 });
    if (sold.length > 0) {
      return sold.map((s: PricePoint, i: number) => ({
        name: `${query} (eBay #${i + 1})`,
        set: null,
        cardNumber: number,
        setId: `ebay-${i}`,
        marketPrice: s.priceUsd,
        productUrl: s.url,
      }));
    }
  } catch (e) {
    console.error("eBay fallback search error:", e);
  }

  return [];
}

/**
 * Get market price for a specific card by its Pokemon TCG API ID.
 * The ID is structured like "ecard2-104" (set-code + number).
 */
export async function getMarketPrice(cardId: string): Promise<{
  marketPrice: number | null;
  medianPrice: number | null;
  listings: PricePoint[];
}> {
  if (!cardId) {
    return { marketPrice: null, medianPrice: null, listings: [] };
  }

  try {
    const res = await fetch(`${API_BASE}/cards/${encodeURIComponent(cardId)}`, {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      console.error("Pokemon TCG API lookup failed:", res.status);
      return { marketPrice: null, medianPrice: null, listings: [] };
    }

    const data = await res.json();
    const card = data.data;
    const tcgUrl = card?.tcgplayer?.url || null;
    const prices = card?.tcgplayer?.prices || {};

    const marketPrice = extractMarketPrice(card) ?? null;
    const medianPrice = extractMedianPrice(card) ?? null;

    // Build listing entries from price variants
    const listings: PricePoint[] = [];
    for (const variant of ["normal", "holofoil", "reverseHolofoil", "firstEditionHolofoil", "firstEditionNormal"]) {
      const p = prices[variant];
      if (p?.market && p.market > 0) {
        listings.push({
          source: "tcgplayer",
          priceUsd: p.market,
          condition: null,
          url: tcgUrl,
          date: card.tcgplayer?.updatedAt || null,
          isSoldPrice: false,
        });
      }
    }

    return { marketPrice, medianPrice, listings };
  } catch (e) {
    console.error("Pokemon TCG API lookup error:", e);
    return { marketPrice: null, medianPrice: null, listings: [] };
  }
}
