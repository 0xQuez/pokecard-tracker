import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/* ── Server-side Supabase client (needs SERVICE_ROLE_KEY for cron writes) ── */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

type HuntRow = {
  id: number;
  card_name: string;
  card_number: string | null;
  set_name: string;
  edition: string | null;
  raw_price: number;
  psa6_price: number | null;
  psa7_price: number | null;
  psa8_price: number | null;
  psa9_price: number | null;
  margin: number;
  passes_filter: boolean;
  week_start_date: string;
  created_at: string;
};

function getWeekStart(d = new Date()): Date {
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day;
  const sunday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
  sunday.setUTCHours(0, 0, 0, 0);
  return sunday;
}

function nextRunHint(): string {
  const now = new Date();
  const nextWed = new Date(now);
  nextWed.setUTCDate(now.getUTCDate() + ((3 - now.getUTCDay() + 7) % 7 || 7));
  nextWed.setUTCHours(9, 0, 0, 0);
  return nextWed.toLocaleDateString("en-US", { weekday: "long", hour: "numeric" });
}

export async function GET(_req: NextRequest) {
  const weekStart = getWeekStart();
  const weekIso = weekStart.toISOString().slice(0, 10);

  let data: HuntRow[] = [];
  let tableExists = true;

  try {
    const { data: rows, error } = await supabase
      .from("weekly_hunt")
      .select("*")
      .eq("week_start_date", weekIso)
      .order("margin", { ascending: false });

    if (error) {
      // Table missing = PGRST116 or similar Postgres error
      if (error.code === "42P01" || error.message?.includes("does not exist") || error.message?.includes("weekly_hunt")) {
        console.warn("weekly_hunt table not found — returning empty state");
        tableExists = false;
      } else {
        console.error("weekly-hunt fetch error:", error.message);
      }
    } else {
      data = (rows ?? []) as HuntRow[];
    }
  } catch (e) {
    console.error("weekly-hunt unexpected error:", e);
    tableExists = false;
  }

  const sorted = [...data].sort((a, b) => b.margin - a.margin);

  return NextResponse.json({
    weekStart: weekIso,
    count: sorted.length,
    picks: sorted.filter((r) => r.passes_filter).length,
    results: sorted,
    tableReady: tableExists,
    nextRun: nextRunHint(),
  });
}
