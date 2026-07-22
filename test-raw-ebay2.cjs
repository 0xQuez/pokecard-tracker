async function main() {
  const url = 'https://www.ebay.com/sch/i.html?_nkw=Psyduck+pokemon+card&LH_Sold=1&LH_Complete=1';
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    },
  });
  const text = await res.text();
  console.log('Status:', res.status);
  console.log('Has <ul:', text.includes('<ul'));
  console.log('Has srp-results:', text.includes('srp-results'));
  console.log('Has _nkw=:', text.includes('_nkw='));
  console.log('First 500 chars:', text.slice(0, 500));
}
main().catch(console.error);
