import { NextRequest, NextResponse } from "next/server";
import {
  runIdentifyPipeline,
  type IdentifyOutcome,
} from "../../../../lib/hunter/identify-pipeline";

export const runtime = "nodejs";

/**
 * POST /api/hunter/identify
 *
 * Body:   { imageUrl: string }
 * Output (200):
 *   {
 *     candidates: [{ id, name, set, number, imageSmall, imageLarge, score,
 *                    variantHints }],
 *     needsConfirmation: boolean,
 *     extracted: { name, setName, setCode?, collectorNumber, variant, print,
 *                  stamp, confidence }
 *   }
 *
 * Pipeline (T22.5): fetch the photo -> vision extraction (T22.3) -> tcg
 * matching (T22.4) -> stamp/variant tiebreaker. pokemontcg.io does NOT split
 * svp-44 (regular vs Pokemon Center Exclusive) — that record is kept as ONE
 * candidate and `variantHints` lets the confirmation UI present the print
 * choices. `needsConfirmation` is true when the top-2 scores are within 0.15
 * or the vision model read a pricing-relevant stamp/variant signal.
 *
 * Error states (all carry a machine-readable `code`):
 *   400 UNREADABLE_IMAGE        — photo not readable / no name or number
 *   404 NO_MATCH                — no catalog match (extracted returned for manual entry)
 *   502 TCG_API_UNAVAILABLE     — pokemontcg.io down after retries
 *   503 VISION_NOT_CONFIGURED   — no vision provider configured on this server
 *   500                         — unexpected failure
 */
export async function POST(req: NextRequest) {
  let body: { imageUrl?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body", code: "INVALID_BODY" },
      { status: 400 }
    );
  }

  const imageUrl = body?.imageUrl;
  if (typeof imageUrl !== "string" || !imageUrl.trim()) {
    return NextResponse.json(
      { error: "Missing imageUrl in body", code: "MISSING_IMAGE_URL" },
      { status: 400 }
    );
  }

  let outcome: IdentifyOutcome;
  try {
    outcome = await runIdentifyPipeline(imageUrl.trim());
  } catch (e) {
    console.error("identify pipeline failed:", e);
    return NextResponse.json(
      { error: "Card identification failed. Try again.", code: "INTERNAL" },
      { status: 500 }
    );
  }

  switch (outcome.status) {
    case "ok":
      return NextResponse.json({
        candidates: outcome.candidates,
        needsConfirmation: outcome.needsConfirmation,
        extracted: outcome.extracted,
      });
    case "unreadable":
      return NextResponse.json(
        {
          error: "Could not read a card identity from this image. Try a clearer photo.",
          code: outcome.code,
        },
        { status: 400 }
      );
    case "no-match":
      return NextResponse.json(
        {
          error: "No card matched the identity read from the image.",
          code: outcome.code,
          // Return the extracted identity so the UI can offer manual entry.
          extracted: outcome.extracted,
        },
        { status: 404 }
      );
    case "tcg-down":
      return NextResponse.json(
        { error: "Card catalog is temporarily unavailable. Try again shortly.", code: outcome.code },
        { status: 502 }
      );
    case "vision-down":
      return NextResponse.json(
        {
          error: "Vision provider not configured on this server.",
          code: outcome.code,
        },
        { status: 503 }
      );
  }
}
