import { NextRequest, NextResponse } from "next/server";
import { getMarketPrice } from "../../../../lib/scrapers/tcgplayer";
import { searchSoldItems } from "../../../../lib/scrapers/ebay";
import { consolidatePrices } from "../../../../lib/price-engine";
import { CardIdentity } from "../../../../lib/models";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const name = req.nextUrl.searchParams.get("name") || "Unknown card";

  if (!id) {
    return NextResponse.json({ error: "Missing product id" }, { status: 400 });
  }

  try {
    const card: CardIdentity = {
      name,
      set: null,
      cardNumber: null,
      setId: id,
    };

    // Fetch TCGPlayer market price and eBay sold prices in parallel
    const [tcgpResult, ebayPrices] = await Promise.all([
      getMarketPrice(parseInt(id)),
      searchSoldItems(name),
    ]);

    const result = consolidatePrices(card, tcgpResult, ebayPrices);
    return NextResponse.json(result);
  } catch (e) {
    console.error("Price lookup failed:", e);
    return NextResponse.json(
      { error: "Price lookup failed. Try again." },
      { status: 500 }
    );
  }
}
