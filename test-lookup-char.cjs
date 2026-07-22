async function main() {
  // Check a fresh card (not in cache)
  const res = await fetch('http://localhost:3000/api/hunter/lookup?id=base1-4&name=Charizard');
  const data = await res.json();
  console.log('eBay sold count:', data.ebaySold?.length || 0);
  console.log('eBay median:', data.consolidated?.ebayMedian);
  console.log('eBay avg:', data.consolidated?.ebayAvg);
  console.log('PSA prices:');
  (data.psaPrices || []).forEach(p => {
    console.log(`  ${p.grade}: avg=${p.avgSold} count=${p.count}`);
  });
}
main().catch(console.error);
