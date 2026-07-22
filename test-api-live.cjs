const http = require('http');

function request(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: 'localhost', port: 3000, path, timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve({ raw: data, parseError: e.message }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function main() {
  console.log('=== Testing /api/hunter/search?q=psyduck ===');
  const search = await request('/api/hunter/search?q=psyduck');
  if (search.error) {
    console.log('ERROR:', search.error);
  } else {
    console.log('Results:', search.results?.length || 0);
    (search.results || []).slice(0, 5).forEach((c, i) => {
      console.log(`  ${i + 1}. ${c.name} | set:${c.set || '?'} | #${c.cardNumber || '?'} | $${c.marketPrice || 'N/A'}`);
    });
  }

  console.log('\n=== Testing /api/hunter/lookup?id=ecard2-104&name=Psyduck ===');
  const lookup = await request('/api/hunter/lookup?id=ecard2-104&name=Psyduck');
  if (lookup.error) {
    console.log('ERROR:', lookup.error);
  } else {
    console.log('Prices:', lookup.prices?.length || 0);
    console.log('eBay sold count:', lookup.consolidated?.recentSoldCount || 0);
    console.log('eBay range:', JSON.stringify(lookup.consolidated?.ebaySoldRange));
    console.log('PSA prices:');
    (lookup.psaPrices || []).forEach(p => {
      console.log(`  ${p.grade}: avg=$${p.avgSold} count=${p.count}`);
    });
    console.log('Best margin grade:', lookup.hunt?.bestMarginGrade);
    console.log('Best margin:', lookup.hunt?.bestMargin);
    console.log('Raw source:', lookup.rawSource);
  }
}

main().catch(console.error);
