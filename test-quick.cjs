const http = require('http');

function req(path) {
  return new Promise((resolve, reject) => {
    const q = http.get({ hostname: 'localhost', port: 3000, path, timeout: 30000 }, (r) => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({raw: d}); } });
    });
    q.on('error', reject);
    q.on('timeout', () => { q.destroy(); reject(new Error('timeout')); });
  });
}

async function main() {
  console.log('Testing search...');
  const s = await req('/api/hunter/search?q=' + encodeURIComponent('psyduck'));
  console.log('Results:', s.results?.length || 0);
  s.results?.slice(0, 8).forEach((c, i) => {
    console.log('  ' + (i+1) + '. ' + c.name + ' | ' + (c.set || '?') + ' | #' + (c.cardNumber || '?') + ' | $' + (c.marketPrice || 'N/A') + ' | url:' + (!!c.productUrl ? 'yes' : 'NO'));
  });
  console.log('>=5 results?', s.results?.length >= 5 ? 'PASS' : 'FAIL');
}
main().catch(e => console.error('Error:', e.message));
