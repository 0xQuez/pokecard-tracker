import { NextRequest, NextResponse } from "next/server";
import {
  defaultVisionFn,
  extractCardFeatures,
  VisionNotConfigured,
} from "../../../../lib/identify/card-vision";
import { matchCardIdentity } from "../../../../lib/identify/identity-matcher";
import { pokemontcgIdentifyCatalog } from "../../../../lib/identify/pokemontcg-catalog";
import type { VisionFeatures } from "../../../../lib/identify/card-vision";

export const runtime = "nodejs";

/**
 * POST /api/hunter/identify
 *
 * Body:   { imageUrl: string }
 * Output: {
 *   candidates: [{ name, set, setCode, setId, cardNumber, variant, print,
 *                  stamp, price, imageUrl, confidence, reason, synthetic }],
 *   needsConfirmation: boolean,
 *   warning: string | null,
 *   features: { name, set, number, variant, print, stamp, confidence }
 * }
 *
 * Vision extraction runs server-side via the configured vision provider
 * (VISION_API_BASE_URL / VISION_API_KEY / VISION_MODEL — OpenAI-compatible
 * chat completions with image_url support). Matching runs against the free
 * pokemontcg.io API with retry-with-backoff. When the vision model reads a
 * Pokemon Center stamp, the PC-exclusive candidate is surfaced for the user to
 * confirm (regular vs PC Exclusive are the same catalog id, svp-44, but very
 * different prices).
 */
export async function POST(req: NextRequest) {
  let body: { imageUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const imageUrl = body?.imageUrl;
  if (!imageUrl || typeof imageUrl !== "string") {
    return NextResponse.json(
      { error: "Missing imageUrl in body" },
      { status: 400 }
    );
  }

  let features: VisionFeatures;
  try {
    features = await extractCardFeatures(imageUrl, defaultVisionFn);
  } catch (e) {
    if (e instanceof VisionNotConfigured) {
      return NextResponse.json(
        { error: "Vision provider not configured on this server" },
        { status: 503 }
      );
    }
    console.error("vision extraction failed:", e);
    return NextResponse.json(
      { error: "Card identification failed. Try again." },
      { status: 500 }
    );
  }

  try {
    const result = await matchCardIdentity(features, pokemontcgIdentifyCatalog);
    return NextResponse.json({
      candidates: result.candidates,
      needsConfirmation: result.needsConfirmation,
      warning: result.warning,
      features,
    });
  } catch (e) {
    console.error("identify matching failed:", e);
    return NextResponse.json(
      { error: "Card identification failed. Try again." },
      { status: 500 }
    );
  }
}
