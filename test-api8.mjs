async function t() {
  const tests = [
    { q: 'name:charizard', pageSize: 5 },
    { q: 'name:charizard', pageSize: 3 },
    { q: 'name:charizard*', pageSize: 5 },
    { q: 'name:charizard subtypes:Basic', pageSize: 5 },
  ];
  for (const {q, pageSize} of tests) {
    const url = 'https://api.pokemontcg.io/v2/cards?q=' + encodeURIComponent(q) + '&pageSize=' + pageSize;
    const res = await fetch(url, { headers: {Accept:'application/json'} });
    const d = await res.json();
    console.log('Q:', q, 'pageSize:', pageSize, 'status:', res.status, 'count:', d.count);
    if (d.data) d.data.slice(0, 3).forEach(c => console.log('  ', c.name, c.set.name, c.number, c.id));
  }
}
t();
