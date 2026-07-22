// Quick test of eBay scraper parsing against real Firecrawl markdown
const fs = require("fs");
const md = fs.readFileSync("/Users/quez/.hermes/profiles/coding/cache/web/www.ebay.com-e473c0ec91.md", "utf8");

function parseCondition(text) {
  const t = text.toLowerCase();
  if (/\b(near mint|mint|brand new|sealed)\b/.test(t)) return "NM";
  if (/\b(lightly played|lp|pre[-\s]?owned)\b/.test(t)) return "LP";
  if (/\b(moderately played|mp)\b/.test(t)) return "MP";
  if (/\b(heavily played|hp)\b/.test(t)) return "HP";
  if (/\b(damaged|for parts)\b/.test(t)) return "DMG";
  return null;
}

function parseSoldListings(content, limit = 25) {
  const results = [];
  const lines = content.split("\n");
  const seenPrices = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const soldMatch = line.match(/^Sold [A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    if (!soldMatch) continue;

    let price = null;
    let condition = null;
    let stop = Math.min(i + 15, lines.length);

    for (let j = i + 1; j < stop; j++) {
      const l = lines[j].trim();
      if (!condition) {
        const c = parseCondition(l);
        if (c) condition = c;
      }
      const priceMatch = l.match(/^\$([\d,]+\.\d{2})$/);
      if (priceMatch) {
        const nextL = lines[j + 1]?.trim() || "";
        if (
          nextL.includes("delivery") ||
          nextL.includes("shipping") ||
          nextL.includes("with coupon") ||
          nextL.includes("to $")
        ) continue;
        price = parseFloat(priceMatch[1].replace(/,/g, ""));
        break;
      }
      if (/^Sold [A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(l)) break;
    }

    if (price && price > 0 && !seenPrices.has(price)) {
      seenPrices.add(price);
      results.push({ price, condition });
      if (results.length >= limit) break;
    }
  }
  return results;
}

const parsed = parseSoldListings(md, 25);
console.log("Extracted sold listings:", parsed.length);
parsed.slice(0, 10).forEach((p, i) => console.log(`${i + 1}. $${p.price.toFixed(2)} ${p.condition ?? ""}`));
console.log("Median:", parsed.map(p => p.price).sort((a, b) => a - b)[Math.floor(parsed.length / 2)]);
