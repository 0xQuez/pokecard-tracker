async function main() {
  const url = 'https://api.pokemontcg.io/v2/cards?q=name:psyduck&pageSize=50';
  const res = await fetch(url);
  const j = await res.json();
  console.log('Total count:', j.count);
  const allPsyducks = j.data;
  console.log('All Psyduck cards:');
  allPsyducks.forEach(c => {
    console.log(`  id=${c.id} number=${c.number} set=${c.set?.id} setName=${c.set?.name}`);
  });

  // Search specifically for aquapolis
  const aqua = allPsyducks.find(c => c.set?.id === 'ecard2');
  console.log('\nAquapolis match:', aqua ? aqua.id : 'none');
}
main().catch(console.error);
