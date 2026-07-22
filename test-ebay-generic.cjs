const { Firecrawl } = require('@mendable/firecrawl-js');
const fs = require('fs');
const apiKey = fs.readFileSync('.env.local', 'utf8').match(/FIRECRAWL_API_KEY=(.+)/)?.[1]?.trim();
const app = new Firecrawl({ apiKey });

function parseSoldListings(content, limit) {
  const results = [];
  const lines = content.split("\n");
  const seenPrices = new Set();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const soldMatch = line.match(/^Sold [A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    if (!soldMatch) continue;
    let price = null;
    let stop = Math.min(i + 15, lines.length);
    for (let j = i + 1; j < stop; j++) {
      const l = lines[j].trim();
      const priceMatch = l.match(/^\$([\d,]+\.\d{2})$/);
      if (priceMatch) {
        const nextL = lines[j + 1]?.trim() || "";
        if (nextL.includes("delivery") || nextL.includes("shipping") || nextL.includes("with coupon") || nextL.includes("to $")) continue;
        price = parseFloat(priceMatch[1].replace(/,/g, ""));
        break;
      }
      if (/^Sold [A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(l)) break;
    }
    if (price && price > 0 && !seenPrices.has(price)) {
      seenPrices.add(price);
      results.push(price);
      if (results.length >= limit) break;
    }
  }
  return results;
}

async function test(query) {
  const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1`;
  console.log('\n--- Testing:', query, '---');
  const doc = await app.scrapeUrl(url, { formats: ['markdown'] });
  const soldCount = doc.markdown.split('\n').filter(l => /^Sold [A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(l.trim())).length;
  const prices = parseSoldListings(doc.markdown, 25);
  console.log('Firecrawl status:', doc.metadata?.statusCode, '| sold lines:', soldCount, '| parsed prices:', prices.length);
  console.log('Prices:', prices.slice(0, 5));
}

async function main() {
  await test('Psyduck pokemon card');
  await test('Psyduck PSA 6 pokemon card');
  await test('charizard 4/102 base set shadowless pokemon card');
}
main().catch(console.error);
