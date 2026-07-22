const http = require('http');

function request(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: 'localhost', port: 3000, path, timeout: 120000 }, (res) => {
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
  console.log('Testing lookup with 120s timeout...');
  const start = Date.now();
  const lookup = await request('/api/hunter/lookup?id=ecard2-104&name=Psyduck');
  console.log('Took', (Date.now() - start) / 1000, 'seconds');
  console.log('Prices:', lookup.prices?.length || 0);
  console.log('eBay sold count:', lookup.consolidated?.recentSoldCount || 0);
  console.log('PSA prices count:', lookup.psaPrices?.length || 0);
  console.log('Hunt best grade:', lookup.hunt?.bestMarginGrade);
  console.log('Hunt best margin:', lookup.hunt?.bestMargin);
  if (lookup.error) console.log('Error:', lookup.error);
  if (lookup.raw) console.log('Raw:', lookup.raw.slice(0, 200));
}

main().catch(console.error);
