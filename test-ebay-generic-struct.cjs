const { Firecrawl } = require('@mendable/firecrawl-js');
const fs = require('fs');
const apiKey = fs.readFileSync('.env.local', 'utf8').match(/FIRECRAWL_API_KEY=(.+)/)?.[1]?.trim();
const app = new Firecrawl({ apiKey });

async function main() {
  const url = 'https://www.ebay.com/sch/i.html?_nkw=Psyduck+pokemon+card&LH_Sold=1&LH_Complete=1';
  const doc = await app.scrapeUrl(url, { formats: ['markdown'] });
  const lines = doc.markdown.split('\n');

  // Find all lines near a "Sold" line
  const soldIdx = lines.findIndex(l => /^Sold [A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(l.trim()));
  console.log('First Sold at line', soldIdx);
  if (soldIdx >= 0) {
    console.log('Context (lines', soldIdx, 'to', soldIdx+20, '):');
    lines.slice(soldIdx, soldIdx+20).forEach((l, i) => {
      console.log(`${soldIdx+i}: ${l.slice(0, 120)}`);
    });
  }

  // Find all dollar sign lines
  const dollarLines = lines
    .map((l, i) => ({ i, l: l.trim() }))
    .filter(({ l }) => l.includes('$'));
  console.log('\nFirst 20 $ lines:');
  dollarLines.slice(0, 20).forEach(({ i, l }) => console.log(`${i}: ${l.slice(0, 120)}`));
}
main().catch(console.error);
