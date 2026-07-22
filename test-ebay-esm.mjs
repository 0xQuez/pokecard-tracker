const fs = require('fs');
const apiKey = fs.readFileSync('.env.local', 'utf8').match(/FIRECRAWL_API_KEY=(.+)/)?.[1]?.trim();
process.env.FIRECRAWL_API_KEY = apiKey;

// Use dynamic import for ESM modules
(async () => {
  const { searchSoldItems } = await import('./src/lib/scrapers/ebay.ts');
  const results = await searchSoldItems('psyduck 104/147 reverse holo', { limit: 5 });
  console.log('eBay results:', results.length);
  console.log(JSON.stringify(results.slice(0, 5), null, 2));
})();
