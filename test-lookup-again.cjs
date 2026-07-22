async function main() {
  // Fresh card ID that shouldn't be cached
  const res = await fetch('http://localhost:3000/api/hunter/lookup?id=ecard2-104&name=Psyduck');
  const data = await res.json();
  console.log('Raw source:', data.rawSource);
  console.log('eBay sold count:', data.consolidated?.recentSoldCount);
  console.log('Total prices:', data.prices?.length);
  console.log('eBay prices in array:', data.prices?.filter(p => p.source === 'ebay').length);
  if (data.consolidated?.ebaySoldRange) {
    console.log('eBay range:', data.consolidated.ebaySoldRange);
  }
}
main().catch(console.error);
