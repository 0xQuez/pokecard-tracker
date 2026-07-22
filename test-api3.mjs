async function t() {
  const url = 'https://api.pokemontcg.io/v2/cards?q=' + encodeURIComponent('name:psyduck* number:104') + '&pageSize=10';
  const res = await fetch(url, { headers: {Accept:'application/json'} });
  console.log('status:', res.status);
  const d = await res.json();
  console.log('count:', d.count);
  if (d.data) d.data.forEach(c => console.log(c.name, c.set.name, c.number, c.id));
}
t();
