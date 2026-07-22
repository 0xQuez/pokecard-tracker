async function main() {
  // Test TCG API number query
  const res = await fetch('https://api.pokemontcg.io/v2/cards?q=name:psyduck&pageSize=50');
  const j = await res.json();
  console.log('Cards returned:', j.data.length);

  // Check card numbers
  j.data.forEach(c => {
    console.log(`  ${c.id}: number="${c.number}" set="${c.set?.id}"`);
  });

  // Specific: ecard2-104
  const aqua = j.data.find(c => c.id === 'ecard2-104');
  console.log('\nAquapolis Psyduck:', aqua ? `${aqua.name} #${aqua.number} in ${aqua.set?.name}` : 'not found');

  // Try number search
  const res2 = await fetch('https://api.pokemontcg.io/v2/cards?q=number:104&pageSize=20');
  const j2 = await res2.json();
  console.log('\nNumber 104 search count:', j2.count, 'data:', j2.data?.length);
}
main().catch(console.error);
