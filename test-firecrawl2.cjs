const { Firecrawl } = require('@mendable/firecrawl-js');

async function main() {
  const app = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY });
  try {
    const doc = await app.scrapeUrl("https://www.tcgplayer.com/search/pokemon/product?q=charizard", { formats: ["markdown"] });
    console.log("status:", doc.metadata?.statusCode);
    console.log("markdown length:", doc.markdown?.length);
    console.log("first 2000 chars:");
    console.log(doc.markdown?.slice(0, 2000));
  } catch (e) {
    console.error("Error:", e.message);
  }
}
main();
