async function main() {
  // Fresh card unlikely to be cached
  const res = await fetch('http://localhost:3000/api/hunter/lookup?id=sv3pt5-175&name=Mewtwo');
  const data = await res.json();
  console.log('Raw source:', data.rawSource);
  console.log('eBay sold count:', data.consolidated?.recentSoldCount);
  console.log('Total prices:', data.prices?.length);
  console.log('eBay prices in array:', data.prices?.filter(p => p.source === 'ebay').length);
  if (data.consolidated?.ebaySoldRange) {
    console.log('eBay range low:', data.consolidated.ebaySoldRange.low);
    console.log('eBay range high:', data.consolidated.ebaySoldRange.high);
    console.log('eBay range median:', data.consolidated.ebaySoldRange.median);
  }
  console.log('PSA prices:');
  (data.psaPrices || []).forEach(p => {
    console.log(`  ${p.grade}: avg=${p.avgSold} count=${p.count}`);
  });
}
main().catch(console.error);
