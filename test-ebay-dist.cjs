const { Firecrawl } = require('@mendable/firecrawl-js');
const fs = require('fs');
const apiKey = fs.readFileSync('.env.local', 'utf8').match(/FIRECRAWL_API_KEY=(.+)/)?.[1]?.trim();
const app = new Firecrawl({ apiKey });

async function main() {
  const url = 'https://www.ebay.com/sch/i.html?_nkw=Psyduck+pokemon+card&LH_Sold=1&LH_Complete=1';
  const doc = await app.scrapeUrl(url, { formats: ['markdown'] });
  const lines = doc.markdown.split('\n');

  // For each sold line, find distance to nearest price
  lines.forEach((line, i) => {
    if (!/^Sold [A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(line.trim())) return;
    for (let j = i + 1; j < Math.min(i + 30, lines.length); j++) {
      if (/^\$[\d,]+\.\d{2}$/.test(lines[j].trim())) {
        console.log(`Sold at ${i} -> price at ${j} (distance ${j-i}): ${lines[j].trim()}`);
        return;
      }
      if (/^Sold [A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(lines[j].trim())) return;
    }
    console.log(`Sold at ${i} -> no price found within 30 lines`);
  });
}
main().catch(console.error);
