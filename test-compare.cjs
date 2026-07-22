// Quick test: check what eBay direct fetch returns vs Firecrawl
const fs = require('fs');
const apiKey = fs.readFileSync('.env.local', 'utf8').match(/FIRECRAWL_API_KEY=(.+)/)?.[1]?.trim();

const EBAY_URL = 'https://www.ebay.com/sch/i.html?_nkw=psyduck+pokemon+card&LH_Sold=1&LH_Complete=1&_ipg=50';

async function testDirectFetch() {
  console.log('=== DIRECT FETCH ===');
  const res = await fetch(EBAY_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
    }
  });
  const text = await res.text();
  console.log('Status:', res.status, 'Length:', text.length);
  console.log('Has <ul:', text.includes('<ul'));
  console.log('Has srp-results:', text.includes('class="srp-results'));
  console.log('Has _nkw:', text.includes('_nkw='));
  console.log('Has "Sold Jul":', text.includes('Sold Jul'));
  console.log('Has "Sold Jun":', text.includes('Sold Jun'));
  // Check if it has actual listing titles
  console.log('First 300 chars:', text.slice(0, 300));
  
  // Does it have actual content or just JS?
  const hasListings = text.includes('Sold') && text.includes('$');
  console.log('Has listings with prices:', hasListings);
  return text;
}

async function testFirecrawl() {
  console.log('\n=== FIRECRAWL ===');
  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ url: EBAY_URL, formats: ["markdown"] }),
  });
  const data = await res.json();
  const markdown = data?.data?.markdown || '';
  console.log('Status:', res.status, 'Markdown length:', markdown.length);
  console.log('Has "Sold":', markdown.includes('Sold'));
  
  // Check lines
  const lines = markdown.split('\n');
  const soldLines = lines.filter(l => l.trim().startsWith('Sold '));
  const priceLines = lines.filter(l => l.trim().match(/^\$[\d,]+\.\d{2}$/));
  console.log('Sold lines count:', soldLines.length);
  console.log('Price lines count:', priceLines.length);
  
  if (soldLines.length > 0) {
    console.log('First 3 sold lines:', soldLines.slice(0, 3));
  }
  if (priceLines.length > 0) {
    console.log('First 3 price lines:', priceLines.slice(0, 3));
  }
  return markdown;
}

async function main() {
  await testDirectFetch();
  await testFirecrawl();
}
main().catch(console.error);
