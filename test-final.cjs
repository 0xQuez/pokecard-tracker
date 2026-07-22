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
  console.log('=== Search: psyduck ===');
  const s = await req('/api/hunter/search?q=psyduck');
  console.log('Results:', s.results?.length);
  s.results?.slice(0, 5).forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.name} | ${c.set} | #${c.cardNumber} | $${c.marketPrice || 'N/A'} | url:${c.productUrl ? 'yes' : 'no'}`);
  });

  console.log('\n=== Search: charizard 4/102 base set shadowless ===');
  const s2 = await req('/api/hunter/search?q=charizard+4%2F102+base+set+shadowless');
  console.log('Results:', s2.results?.length);
  s2.results?.slice(0, 3).forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.name} | ${c.set} | #${c.cardNumber} | $${c.marketPrice || 'N/A'} | url:${c.productUrl ? 'yes' : 'no'}`);
  });

  console.log('\n=== Search: 2001 lugia game boy promo psa 10 ===');
  const s3 = await req('/api/hunter/search?q=2001+lugia+game+boy+promo+psa+10');
  console.log('Results:', s3.results?.length);
  s3.results?.slice(0, 3).forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.name} | ${c.set} | #${c.cardNumber} | $${c.marketPrice || 'N/A'} | url:${c.productUrl ? 'yes' : 'no'}`);
  });

  console.log('\n=== Lookup: Psyduck ecard2-104 ===');
  const start = Date.now();
  const l = await req('/api/hunter/lookup?id=ecard2-104&name=Psyduck');
  console.log('Took', ((Date.now() - start) / 1000).toFixed(1), 'seconds');
  console.log('Prices:', l.prices?.length);
  console.log('eBay sold count:', l.consolidated?.recentSoldCount);
  console.log('eBay range:', JSON.stringify(l.consolidated?.ebaySoldRange));
  console.log('PSA prices:');
  (l.psaPrices || []).forEach(p => {
    console.log(`  ${p.grade}: avg=$${p.avgSold} count=${p.count}`);
  });
  console.log('Hunt best grade:', l.hunt?.bestMarginGrade);
  console.log('Hunt best margin:', l.hunt?.bestMargin);
  console.log('Sample eBay price with URL:');
  const ebayPrices = (l.prices || []).filter(p => p.source === 'ebay');
  if (ebayPrices.length > 0) {
    const sample = ebayPrices[0];
    console.log(`  $${sample.priceUsd} ${sample.condition || 'no cond'} url:${sample.url ? sample.url.slice(0, 60) + '...' : 'none'}`);
  }
}

main().catch(console.error);
