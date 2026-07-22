async function main() {
  // First clear cache by using a random name
  const res = await fetch('http://localhost:3000/api/hunter/lookup?id=basep-20&name=Psyduck%20Promo');
  const data = await res.json();
  console.log('Card:', data.card);
  console.log('eBay sold count:', data.ebaySold?.length || 0);
  console.log('Prices:', data.prices?.length);
  console.log('Raw source:', data.rawSource);

  if (data.prices?.length > 0) {
    data.prices.slice(0, 5).forEach((p, i) => {
      console.log(`  Price ${i}: ${p.priceUsd} ${p.source} ${p.isSoldPrice ? 'sold' : 'listing'}`);
    });
  }
}
main().catch(console.error);
