async function test() {
  const url = 'https://api.pokemontcg.io/v2/cards?q=' + encodeURIComponent('name:"charizard" number:"4"') + '&pageSize=20';
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await res.json();
  console.log('Status:', res.status, 'Count:', data.data?.length);
  data.data?.slice(0, 5).forEach(c => {
    console.log('  -', c.name, '|', c.set?.name, '| #', c.number, '| market:', c.tcgplayer?.prices?.normal?.market || c.tcgplayer?.prices?.holofoil?.market || 'N/A', '| url:', c.tcgplayer?.url ? 'yes' : 'NO');
  });
}
test();
