const API_BASE = "https://api.pokemontcg.io/v2";

async function searchCards(query) {
  const q = query.trim().toLowerCase();
  const numberMatch = q.match(/(\d+\/\d+[a-z]?)/i);
  const number = numberMatch ? numberMatch[1] : null;

  // Set aliases
  const setHints = {
    "aquapolis": "ecard2",
    "base set": "base",
    "base set 2": "base2",
  };
  let set = null;
  for (const [hint, code] of Object.entries(setHints)) {
    if (q.includes(hint)) { set = code; break; }
  }

  let name = q;
  if (number) name = name.replace(number, "").trim();
  name = name
    .replace(/\b(reverse holo|holo|foil|1st edition|first edition|shadowless|unlimited|promo|psa \d+|graded|pokemon card)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const parts = [];
  if (name) parts.push(`name:${name}*`);
  if (number) parts.push(`number:${number}`);
  if (set) parts.push(`set.id:${set}`);

  const url = `${API_BASE}/cards?q=${encodeURIComponent(parts.join(" "))}&pageSize=20`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();

  return data.data.map(c => ({
    name: c.name,
    set: c.set?.name || null,
    cardNumber: c.number || null,
    setId: c.id,
    marketPrice: c.tcgplayer?.prices?.normal?.market || c.tcgplayer?.prices?.reverseHolofoil?.market || c.tcgplayer?.prices?.holofoil?.market || undefined,
  }));
}

async function main() {
  console.log("=== Search: psyduck 104/147 reverse holo ===");
  const results = await searchCards("psyduck 104/147 reverse holo");
  console.log(JSON.stringify(results, null, 2));

  if (results.length > 0) {
    console.log("\n=== Lookup:", results[0].setId, "===");
    const url = `${API_BASE}/cards/${results[0].setId}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const data = await res.json();
    const card = data.data;
    console.log("card:", card.name, "set:", card.set?.name, "number:", card.number);
    console.log("tcgplayer prices:", JSON.stringify(card.tcgplayer?.prices, null, 2));
  }

  console.log("\n=== Search: charizard ===");
  const cResults = await searchCards("charizard");
  console.log(JSON.stringify(cResults.slice(0, 5), null, 2));
}

main().catch(console.error);
