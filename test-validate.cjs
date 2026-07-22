const http = require('http');

function req(path) {
  return new Promise((resolve, reject) => {
    const q = http.get({ hostname: 'localhost', port: 3000, path, timeout: 120000 }, (r) => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { resolve({ raw: d }); }
      });
    });
    q.on('error', reject);
    q.on('timeout', () => { q.destroy(); reject(new Error('timeout')); });
  });
}

async function main() {
  // Verify search returns URLs
  const s = await req('/api/hunter/search?q=psyduck');
  const first = s.results?.[0];
  console.log('=== Search Result ===');
  console.log('Name:', first?.name);
  console.log('Set:', first?.set);
  console.log('Number:', first?.cardNumber);
  console.log('Market Price:', first?.marketPrice);
  console.log('Product URL:', first?.productUrl ? first.productUrl.slice(0, 70) + '...' : 'none');
  console.log('Has URL:', !!first?.productUrl);

  // Verify lookup returns URLs in eBay prices
  const l = await req('/api/hunter/lookup?id=ecard2-104&name=Psyduck');
  console.log('\n=== Lookup Result ===');
  console.log('Prices count:', l.prices?.length);
  const tcgPrices = l.prices?.filter(p => p.source === 'tcgplayer');
  const ebayPrices = l.prices?.filter(p => p.source === 'ebay');
  console.log('TCGPlayer prices:', tcgPrices?.length);
  console.log('eBay prices:', ebayPrices?.length);

  if (ebayPrices?.length > 0) {
    const firstEbay = ebayPrices[0];
    console.log('First eBay price:', firstEbay.priceUsd);
    console.log('First eBay condition:', firstEbay.condition);
    console.log('First eBay URL:', firstEbay.url ? firstEbay.url.slice(0, 70) + '...' : 'none');
  }

  console.log('eBay sold range:', JSON.stringify(l.consolidated?.ebaySoldRange));
  console.log('PSA prices count:', l.psaPrices?.length);
  console.log('Hunt best grade:', l.hunt?.bestMarginGrade);
  console.log('Hunt best margin:', l.hunt?.bestMargin);

  // Check all results have required fields
  const allHaveName = s.results?.every(r => r.name);
  const allHaveSet = s.results?.every(r => r.set !== undefined);
  const allHaveUrl = s.results?.every(r => r.productUrl);
  console.log('\n=== Validation ===');
  console.log('All have name:', allHaveName);
  console.log('All have set:', allHaveSet);
  console.log('All have URL:', allHaveUrl);
  console.log('Search results >= 5:', s.results?.length >= 5);
}

main().catch(console.error);
