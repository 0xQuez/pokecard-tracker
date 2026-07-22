const { Firecrawl } = require('@mendable/firecrawl-js');
const fs = require('fs');
const apiKey = fs.readFileSync('.env.local', 'utf8').match(/FIRECRAWL_API_KEY=(.+)/)?.[1]?.trim();
const app = new Firecrawl({ apiKey });

async function main() {
  const url = 'https://www.ebay.com/sch/i.html?_nkw=psyduck+104%2F147+reverse+holo+pokemon+card&LH_Sold=1&LH_Complete=1';
  const doc = await app.scrapeUrl(url, { formats: ['markdown'] });
  console.log('status:', doc.metadata?.statusCode);
  console.log('markdown length:', doc.markdown?.length);

  const md = doc.markdown;
  const lines = md.split('\n');

  // Find "Sold" lines
  const soldIndices = lines
    .map((l, i) => ({ line: l, i }))
    .filter(({ line }) => /^Sold [A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(line.trim()));
  console.log('\nSold line count:', soldIndices.length);
  soldIndices.slice(0, 5).forEach(({ line, i }) => {
    console.log(`\n--- Sold line at ${i}: "${line}"`);
    console.log('Context:', lines.slice(Math.max(0, i-2), Math.min(lines.length, i+8)).map((l, j) => `${i+j-2}| ${l}`).join('\n'));
  });

  // Find price lines
  const priceLines = lines.filter(l => /^\$[\d,]+\.\d{2}$/.test(l.trim()));
  console.log('\nPrice line count:', priceLines.length);
  console.log('First 10 prices:', priceLines.slice(0, 10));
}
main().catch(console.error);
