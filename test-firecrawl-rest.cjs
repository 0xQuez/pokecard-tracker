const fs = require('fs');
const apiKey = fs.readFileSync('.env.local', 'utf8').match(/FIRECRAWL_API_KEY=(.+)/)?.[1]?.trim();

async function main() {
  const url = 'https://www.ebay.com/sch/i.html?_nkw=psyduck+104%2F147+reverse+holo+pokemon+card&LH_Sold=1&LH_Complete=1';
  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ url, formats: ["markdown"] }),
  });
  console.log('status:', res.status);
  const data = await res.json();
  console.log('data keys:', Object.keys(data));
  console.log('markdown length:', data?.data?.markdown?.length);
  console.log('first 500 chars:', data?.data?.markdown?.slice(0, 500));
}
main().catch(console.error);
