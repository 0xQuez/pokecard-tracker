const { Firecrawl } = require('@mendable/firecrawl-js');
const fs = require('fs');
const apiKey = fs.readFileSync('.env.local', 'utf8').match(/FIRECRAWL_API_KEY=(.+)/)?.[1]?.trim();
const app = new Firecrawl({ apiKey });

async function main() {
  const url = 'https://www.ebay.com/sch/i.html?_nkw=charizard+4%2F102+base+set+shadowless+pokemon+card&LH_Sold=1&LH_Complete=1';
  try {
    const doc = await app.scrapeUrl(url, { formats: ['markdown'] });
    console.log('status:', doc.metadata?.statusCode);
    console.log('markdown length:', doc.markdown?.length);
    console.log(doc.markdown?.slice(0, 3000));
  } catch (e) {
    console.error('Error:', e.message);
  }
}
main();
