const fs = require('fs');
const apiKey = fs.readFileSync('.env.local', 'utf8').match(/FIRECRAWL_API_KEY=(.+)/)?.[1]?.trim();

async function fetchWithFirecrawl(url) {
  const endpoint = "https://api.firecrawl.dev/v1/scrape";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ url, formats: ["markdown"] }),
  });
  const data = await res.json();
  return data?.data?.markdown || null;
}

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
    let stop = Math.min(i + 25, lines.length);

    for (let j = i + 1; j < stop; j++) {
      const l = lines[j].trim();
      if (!condition) {
        const c = parseCondition(l);
        if (c) condition = c;
      }
      const priceMatch = l.match(/^\$([\d,]+\.\d{2})$/);
      if (priceMatch) {
        const nextL = lines[j + 1]?.trim() || "";
        if (nextL.includes("delivery") || nextL.includes("shipping") || nextL.includes("with coupon") || nextL.includes("to $")) {
          continue;
        }
        price = parseFloat(priceMatch[1].replace(/,/g, ""));
        break;
      }
      if (/^Sold [A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(l)) break;
    }

    if (price && price > 0 && !seenPrices.has(price)) {
      seenPrices.add(price);
      results.push({ source: "ebay", priceUsd: price, condition, url: null, date: null, isSoldPrice: true });
      if (results.length >= limit) break;
    }
  }

  return results;
}

async function main() {
  const url = 'https://www.ebay.com/sch/i.html?_nkw=psyduck+104%2F147+reverse+holo+pokemon+card&LH_Sold=1&LH_Complete=1';
  console.log('Fetching via Firecrawl...');
  const markdown = await fetchWithFirecrawl(url);
  console.log('Markdown length:', markdown?.length);

  if (markdown) {
    const results = parseSoldListings(markdown, 10);
    console.log('Parsed results:', results.length);
    console.log(JSON.stringify(results.slice(0, 5), null, 2));
  }
}
main().catch(console.error);
