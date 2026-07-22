const fs = require('fs');

// Read actual Firecrawl markdown for eBay
const md = fs.readFileSync('/Users/quez/.hermes/profiles/coding/cache/web/www.ebay.com-f0882853ba.md', 'utf8');

// Replicate the current parser logic
function parseCondition(text) {
  const t = text.toLowerCase();
  if (/\b(near mint|mint|brand new|sealed|new\s*\(other\)|new other)\b/.test(t)) return "NM";
  if (/\b(lightly played|lp|pre[-\s]?owned)\b/.test(t)) return "LP";
  if (/\b(moderately played|mp)\b/.test(t)) return "MP";
  if (/\b(heavily played|hp)\b/.test(t)) return "HP";
  if (/\b(damaged|for parts)\b/.test(t)) return "DMG";
  return null;
}

function parseSoldListings(content, limit) {
  const results = [];
  const lines = content.split("\n");
  const seenPrices = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    const soldMatch = line.match(/^Sold [A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    if (!soldMatch) continue;

    let price = null;
    let condition = null;
    let url = null;
    let stop = Math.min(i + 25, lines.length);

    for (let j = i + 1; j < stop; j++) {
      const l = lines[j].trim();

      if (!url) {
        const urlMatch = l.match(/^\[.+\]\((https:\/\/www\.ebay\.com\/itm\/\d+[^\)]+)\)/);
        if (urlMatch) {
          url = urlMatch[1].split("?")[0];
        }
      }

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
        ) {
          continue;
        }
        price = parseFloat(priceMatch[1].replace(/,/g, ""));
        break;
      }

      if (/^Sold [A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(l)) break;
    }

    if (price && price > 0 && !seenPrices.has(price)) {
      seenPrices.add(price);
      results.push({ source: "ebay", priceUsd: price, condition, url, date: null, isSoldPrice: true });
      if (results.length >= limit) break;
    }
  }

  return results;
}

const lines = md.split('\n');
console.log('Total lines:', lines.length);
const soldLines = lines.filter(l => l.trim().match(/^Sold [A-Z][a-z]{2} \d{1,2}, \d{4}$/));
console.log('Sold lines found:', soldLines.length);

const results = parseSoldListings(md, 25);
console.log('\nParsed results:', results.length);
results.slice(0, 10).forEach((r, i) => {
  console.log(`  ${i+1}. $${r.priceUsd} | ${r.condition || 'N/A'} | ${r.url ? r.url.slice(0, 60) : 'NO URL'}`);
});

// Check what the lines around first "Sold" look like
const firstSoldIdx = lines.findIndex(l => l.trim().match(/^Sold [A-Z][a-z]{2} \d{1,2}, \d{4}$/));
if (firstSoldIdx >= 0) {
  console.log('\n--- First Sold block ---');
  for (let j = Math.max(0, firstSoldIdx); j < Math.min(lines.length, firstSoldIdx + 20); j++) {
    console.log(`${j}: ${lines[j].slice(0, 100)}`);
  }
}
