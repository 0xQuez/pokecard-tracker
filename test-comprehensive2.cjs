const http = require('http');

function req(path) {
  return new Promise((resolve, reject) => {
    const q = http.get({ hostname: '127.0.0.1', port: 3000, path, timeout: 90000 }, (r) => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({raw: d}); } });
    });
    q.on('error', reject);
    q.on('timeout', () => { q.destroy(); reject(new Error('timeout')); });
  });
}

async function testSearch(query, label) {
  const s = await req('/api/hunter/search?q=' + encodeURIComponent(query));
  console.log(`\n--- Search: "${label || query}" ---`);
  console.log('Results:', s.results?.length || 0);
  const ok = s.results?.length >= 5;
  console.log('>= 5 results:', ok ? 'PASS' : 'FAIL');
  s.results?.slice(0, 3).forEach((c, i) => {
    const hasUrl = !!c.productUrl;
    console.log(`  ${i + 1}. ${c.name} | ${c.set || '?'} | #${c.cardNumber || '?'} | $${c.marketPrice || 'N/A'} | url:${hasUrl ? 'yes' : 'NO'}`);
  });
  if (s.error) console.log('Error:', s.error);
  return ok;
}

async function testLookup(id, name) {
  const l = await req('/api/hunter/lookup?id=' + id + '&name=' + encodeURIComponent(name));
  console.log(`\n--- Lookup: ${name} (${id}) ---`);
  console.log('Prices count:', l.prices?.length || 0);
  const ebayCount = l.prices?.filter(p => p.source === 'ebay').length || 0;
  const tcgCount = l.prices?.filter(p => p.source === 'tcgplayer').length || 0;
  const ebayWithUrl = l.prices?.filter(p => p.source === 'ebay' && p.url).length || 0;
  console.log('TCGPlayer prices:', tcgCount);
  console.log('eBay prices:', ebayCount);
  console.log('eBay with URLs:', ebayWithUrl);
  console.log('PSA prices:', l.psaPrices?.length || 0);
  console.log('Hunt best grade:', l.hunt?.bestMarginGrade);
  console.log('Hunt best margin:', l.hunt?.bestMargin);
  const pass = ebayCount >= 5 && l.psaPrices?.length === 5;
  console.log('PASS:', pass);
  return pass;
}

async function main() {
  let allPass = true;
  
  allPass &= await testSearch('psyduck 104/147 reverse holo', 'psyduck 104/147 reverse holo');
  allPass &= await testSearch('charizard 4/102 base set shadowless', 'charizard 4/102');
  allPass &= await testSearch('2001 lugia game boy promo psa 10', '2001 lugia game boy promo');
  
  allPass &= await testLookup('ecard2-104', 'Psyduck');
  allPass &= await testLookup('base1-4', 'Charizard');
  
  console.log('\n==============================');
  console.log('OVERALL:', allPass ? 'ALL PASS' : 'SOME FAILED');
}

main().catch(console.error);
