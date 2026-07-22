async function t() {
  // Try simpler queries
  const tests = [
    'name:psyduck',
    'name:charizard',
    'name:psyduck number:104',
    'name:psyduck set.id:ecard2',
  ];
  for (const q of tests) {
    const url = 'https://api.pokemontcg.io/v2/cards?q=' + encodeURIComponent(q) + '&pageSize=5';
    const res = await fetch(url, { headers: {Accept:'application/json'} });
    const d = await res.json();
    console.log('Q:', q, 'status:', res.status, 'count:', d.count);
    if (d.data) d.data.forEach(c => console.log('  ', c.name, c.set.name, c.number, c.id));
  }
}
t();
