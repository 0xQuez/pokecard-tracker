const http = require('http');

function req(path) {
  return new Promise((resolve, reject) => {
    const q = http.get({ hostname: 'localhost', port: 3000, path, timeout: 30000 }, (r) => {
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
  console.log('=== charizard search ===');
  const s = await req('/api/hunter/search?q=charizard+4%2F102+base+set+shadowless');
  console.log('Results:', s.results?.length);
  s.results?.slice(0, 3).forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.name} | ${c.set} | #${c.cardNumber} | $${c.marketPrice} | url:${c.productUrl || 'none'}`);
  });

  console.log('\n=== psyduck 104/147 ===');
  const s2 = await req('/api/hunter/search?q=psyduck+104%2F147+reverse+holo');
  console.log('Results:', s2.results?.length);
  s2.results?.slice(0, 3).forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.name} | ${c.set} | #${c.cardNumber} | $${c.marketPrice} | url:${c.productUrl || 'none'}`);
  });

  console.log('\n=== 2001 lugia game boy promo ===');
  const s3 = await req('/api/hunter/search?q=2001+lugia+game+boy+promo+psa+10');
  console.log('Results:', s3.results?.length);
  s3.results?.slice(0, 3).forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.name} | ${c.set} | #${c.cardNumber} | $${c.marketPrice} | url:${c.productUrl || 'none'}`);
  });
}

main().catch(console.error);
