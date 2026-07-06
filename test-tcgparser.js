const content = `
| Product | Set | Rarity | Number | Market Price | Listed Median |
| [Pikachu](https://www.tcgplayer.com/product/12345) | Base Set | Common | 25/102 | $1.23 | $1.50 |
| [Charizard](https://www.tcgplayer.com/product/67890) | Base Set | Holo Rare | 4/102 | $450.00 | $500.00 |
| [Lugia Neo Genesis](https://www.tcgplayer.com/product/99999) | Neo Genesis | Holo Rare | 9/111 | $120.00 | $130.00 |
`;

function extractTableRows(content) {
  const rows = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|")) {
      const cells = trimmed.split("|").map(c => c.trim()).filter(c => c.length > 0);
      if (cells.length >= 2 && !/^[-:]+$/.test(cells[0])) rows.push(cells);
    }
  }
  return rows;
}

function cleanPrice(raw) {
  const cleaned = raw.replace(/,/g, "");
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
}

function extractLabeledPrice(text, label) {
  const rx = new RegExp(label.source + "[:\\s\\$]*([\\d,.]+)", "i");
  const m = text.match(rx);
  if (!m) return null;
  return cleanPrice(m[1]);
}

function extractFirstPrice(text) {
  const m = text.match(/\\$([\d,.]+)/);
  if (!m) return null;
  return cleanPrice(m[1]);
}

function isLikelySetName(cell) {
  const trimmed = cell.trim();
  if (!trimmed || trimmed.length < 3 || trimmed.length > 60) return false;
  if (/[\\$\\[\\]]/.test(trimmed)) return false;
  if (/^\\d{1,3}\\/\\d{1,3}[a-z]?$/i.test(trimmed)) return false;
  if (/^\\d+$/.test(trimmed)) return false;
  const rarityWords = /\\b(common|uncommon|rare|holo rare|secret rare|ultra rare|promo|shiny|basic|stage 1|stage 2|vstar|vmax|ex|gx|v)\\b/i;
  if (rarityWords.test(trimmed)) return false;
  return true;
}

function extractFromTableRow(cells) {
  let name = null, productId = null, setName = null, marketPrice = null;
  for (const cell of cells) {
    const linkMatch = cell.match(/\\[([^\\]]+)\\]\\([^)]*\\/product\\/(\\d+)[^)]*\\)/);
    if (linkMatch && !name) {
      name = linkMatch[1].trim();
      productId = linkMatch[2];
    }
    if (!setName && isLikelySetName(cell)) setName = cell;
    if (marketPrice === null) marketPrice = extractLabeledPrice(cell, /market/i) ?? extractFirstPrice(cell);
  }
  if (!name || !productId) return null;
  return { name, productId, setName, marketPrice };
}

const rows = extractTableRows(content);
console.log("Rows found:", rows.length);
for (const row of rows) {
  console.log(extractFromTableRow(row));
}

const pricePage = `Normal Market Price: $123.45
Foil Market Price: $150.00
Listed Median (Near Mint): $130.00`;

let normalMarket = null, foilMarket = null, listedMedian = null;
for (const line of pricePage.split("\n")) {
  const nm = line.match(/Normal\\s+Market\\s*Price[:\\s\\$]*([\\d,.]+)/i);
  if (nm) normalMarket = cleanPrice(nm[1]);
  const fm = line.match(/Foil\\s+Market\\s*Price[:\\s\\$]*([\\d,.]+)/i);
  if (fm) foilMarket = cleanPrice(fm[1]);
  const lm = line.match(/Listed\\s+Median\\s*\\((?:Near\\s+Mint|NM)\\)[:\\s\\$]*([\\d,.]+)/i);
  if (lm) listedMedian = cleanPrice(lm[1]);
}
console.log("market:", normalMarket ?? foilMarket, "median:", listedMedian);
