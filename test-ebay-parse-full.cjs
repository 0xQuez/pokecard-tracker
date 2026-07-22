const { Firecrawl } = require('@mendable/firecrawl-js');
const fs = require('fs');
const apiKey = fs.readFileSync('.env.local', 'utf8').match(/FIRECRAWL_API_KEY=(.+)/)?.[1]?.trim();
const app = new Firecrawl({ apiKey });

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
    let title = null;
    let url = null;
    let stop = Math.min(i + 20, lines.length);

    for (let j = i + 1; j < stop; j++) {
      const l = lines[j].trim();

      // Extract title link
      if (!title) {
        const linkMatch = l.match(/^\[([^\]]+)\]\(([^)]+)\)/);
        if (linkMatch) {
          title = linkMatch[1].replace(/Opens in a new window or tab/g, "").trim();
          url = linkMatch[2];
        }
      }

      // Condition
      if (!condition) {
        const c = parseCondition(l);
        if (c) condition = c;
      }

      // Price
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
      results.push({ price, condition, title, url });
      if (results.length >= limit) break;
    }
  }

  return results;
}

async function main() {
  const url = 'https://www.ebay.com/sch/i.html?_nkw=psyduck+104%2F147+reverse+holo+pokemon+card&LH_Sold=1&LH_Complete=1';
  const doc = await app.scrapeUrl(url, { formats: ['markdown'] });
  console.log('Firecrawl status:', doc.metadata?.statusCode);
  console.log('Markdown length:', doc.markdown?.length);

  const results = parseSoldListings(doc.markdown, 25);
  console.log('\nParsed results:', results.length);
  results.slice(0, 10).forEach((r, i) => {
    console.log(`${i+1}. $${r.price.toFixed(2)} ${r.condition ?? 'N/A'} — ${r.title?.slice(0, 60) ?? 'N/A'}`);
  });
}
main().catch(console.error);
