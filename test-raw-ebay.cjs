async function main() {
  const url = 'https://www.ebay.com/sch/i.html?_nkw=Psyduck+pokemon+card&LH_Sold=1&LH_Complete=1';
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    },
  });
  const text = await res.text();
  console.log('Status:', res.status, 'Length:', text.length);
  console.log('Has "Sold":', text.includes('Sold'));
  console.log('Has "srp-results":', text.includes('srp-results'));
  console.log('Has date patterns:', /Sold\s+[A-Z][a-z]{2}\s+\d{1,2}/.test(text));

  // Check a small sample
  const idx = text.indexOf('srp-results');
  if (idx >= 0) {
    console.log('Sample around srp-results:', text.slice(idx, idx + 500));
  }
}
main().catch(console.error);
