const { searchSoldItems } = require('./.next/server/chunks/lib_scrapers_ebay.js');

async function main() {
  try {
    const results = await searchSoldItems("psyduck 104/147 reverse holo", { limit: 5 });
    console.log('Results:', results.length);
    console.log(JSON.stringify(results, null, 2));
  } catch (e) {
    console.error('Error:', e.message);
  }
}
main();
