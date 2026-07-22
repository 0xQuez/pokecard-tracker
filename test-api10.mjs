async function t() {
  const url = 'https://api.pokemontcg.io/v2/cards/ecard2-104';
  const res = await fetch(url, { headers: {Accept:'application/json'} });
  console.log('status:', res.status);
  const d = await res.json();
  console.log('keys:', Object.keys(d));
  console.log('data:', d.data ? 'present' : 'missing');
  if (d.data) {
    const c = d.data;
    console.log(c.name, c.set?.name, c.number, c.id);
    console.log('tcgplayer prices:', JSON.stringify(c.tcgplayer?.prices, null, 2));
  }
}
t();
