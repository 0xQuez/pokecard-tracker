const fs = require("fs");
const md = fs.readFileSync("/Users/quez/.hermes/profiles/coding/cache/web/www.ebay.com-e473c0ec91.md", "utf8");
const lines = md.split("\n");

console.log("Total lines:", lines.length);
console.log("Line 276:", JSON.stringify(lines[276]));
console.log("Line 277:", JSON.stringify(lines[277]));
console.log("Line 284:", JSON.stringify(lines[284]));
console.log("Line 285:", JSON.stringify(lines[285]));
console.log("Match test:", /^Sold [A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(lines[276]));

const regex = /^Sold [A-Z][a-z]{2} \d{1,2}, \d{4}$/;
let count = 0;
for (let i = 0; i < lines.length; i++) {
  if (regex.test(lines[i].trim())) count++;
}
console.log("Sold matches:", count);
