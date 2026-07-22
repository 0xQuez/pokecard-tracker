import { NextRequest } from "next/server";
import { GET as searchHandler } from "./src/app/api/hunter/search/route";
import { GET as lookupHandler } from "./src/app/api/hunter/lookup/route";

async function testSearch() {
  const req = new NextRequest("http://localhost:3000/api/hunter/search?q=psyduck");
  const res = await searchHandler(req);
  const data = await res.json();
  console.log("=== Search (psyduck) ===");
  console.log("Status:", res.status);
  console.log("Results count:", data.results?.length);
  if (data.results?.length > 0) {
    data.results.slice(0, 5).forEach((c: any, i: number) => {
      console.log(`  ${i + 1}. ${c.name} | ${c.set || "no set"} | #${c.cardNumber || "?"} | $${c.marketPrice || "N/A"}`);
    });
  }
}

async function testLookup() {
  const req = new NextRequest("http://localhost:3000/api/hunter/lookup?id=ecard2-104&name=Psyduck");
  const res = await lookupHandler(req);
  const data = await res.json();
  console.log("\n=== Lookup (Psyduck ecard2-104) ===");
  console.log("Status:", res.status);
  console.log("Has error:", !!data.error);
  console.log("Prices count:", data.prices?.length);
  console.log("eBay sold count:", data.consolidated?.recentSoldCount);
  console.log("eBay range:", JSON.stringify(data.consolidated?.ebaySoldRange));
  console.log("PSA prices:");
  (data.psaPrices || []).forEach((p: any) => {
    console.log(`  ${p.grade}: avg=$${p.avgSold} count=${p.count}`);
  });
  console.log("Hunt best grade:", data.hunt?.bestMarginGrade);
  console.log("Hunt best margin:", data.hunt?.bestMargin);
}

async function main() {
  await testSearch();
  await testLookup();
}

main().catch(console.error);
