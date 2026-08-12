import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/* ── Server-side Supabase client (service role — needed to rotate share tokens) ── */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * POST /api/valuation/regenerate-share
 * Body: { resultId: number }
 *
 * Rotates a valuation result's share token (revoking any previously-shared
 * links) and returns the new token. Runs server-side with the service role key
 * because the anon key must not be able to rotate tokens — see
 * supabase/migrations/004_valuation_share.sql.
 */
export async function POST(req: NextRequest) {
  let resultId: number;
  try {
    const body = await req.json();
    resultId = Number(body?.resultId);
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!Number.isInteger(resultId) || resultId <= 0) {
    return NextResponse.json({ error: "resultId is required." }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("regenerate_valuation_share_token", {
    p_result_id: resultId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Could not regenerate the share token." }, { status: 404 });
  }

  return NextResponse.json({ shareToken: data });
}
