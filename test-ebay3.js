const fs = require("fs");
const md = fs.readFileSync("/Users/quez/.hermes/profiles/coding/cache/web/www.ebay.com-e473c0ec91.md", "utf8");
const lines = md.split("\n");

for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  if (line.match(/^Sold [A-Z][a-z]{2} \d{1,2}, \d{4}$/)) {
    console.log("=== Sold line", i, ":", line);
    for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
      const l = lines[j].trim();
      if (l.match(/^\$([\d,]+\.\d{2})$/)) {
        console.log("  Price line", j, ":", l, "-> next:", lines[j+1]?.trim());
      }
      if (l.match(/^Sold /)) {
        console.log("  Next sold at", j);
        break;
      }
    }
    break; // just first one
  }
}
