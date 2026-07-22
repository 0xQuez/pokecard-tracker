async function t() {
  const tests = [
    'name:charizard',
    'name:psyduck',
    'name:lugia',
    'name:mew',
  ];
  for (const q of tests) {
    const url = 'https://api.pokemontcg.io/v2/cards?q=' + encodeURIComponent(q) + '&pageSize=20';
    const res = await fetch(url, { headers: {Accept:'application/json'} });
    const d = await res.json();
    console.log('Q:', q, 'status:', res.status, 'count:', d.count);
    if (d.data) d.data.slice(0, 3).forEach(c => console.log('  ', c.name, c.set.name, c.number, c.id));
  }

  console.log('\n=== Lookup by ID ===');
  const url = 'https://api.pokemontcg.io/v2/cards/ecard2-104';
  const res = await fetch(url, { headers: {Accept:'application/json'} });
  const d = await res.json();
  const c = d.data;
  console.log(c.name, c.set.name, c.number, c.id);
  console.log('tcgplayer prices:', JSON.stringify(c.tcgplayer?.prices, null, 2));
}
t();
