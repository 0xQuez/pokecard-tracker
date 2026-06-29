import { NextRequest, NextResponse } from "next/server";
import { searchCards } from "../../../../lib/scrapers/tcgplayer";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q");
  if (!q || q.length < 2) {
    return NextResponse.json({ error: "Query too short" }, { status: 400 });
  }

  try {
    const results = await searchCards(q);
    return NextResponse.json({ results });
  } catch (e) {
    console.error("Search failed:", e);
    return NextResponse.json(
      { error: "Search failed. Try a different query." },
      { status: 500 }
    );
  }
}
