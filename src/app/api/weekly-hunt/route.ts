import { NextRequest, NextResponse } from "next/server";
import { supabase } from "../../../lib/supabaseClient";
import type { WeeklyHuntRow } from "../../../lib/weekly-hunt";

function getWeekStart(d = new Date()): Date {
  const day = d.getUTCDay(); // 0 = Sun, 3 = Wed
  const diff = d.getUTCDate() - day; // back to Sunday
  const sunday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
  sunday.setUTCHours(0, 0, 0, 0);
  return sunday;
}

export async function GET(_req: NextRequest) {
  const weekStart = getWeekStart();
  const weekIso = weekStart.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("weekly_hunt")
    .select("*")
    .eq("week_start_date", weekIso)
    .order("margin", { ascending: false });

  if (error) {
    console.error("weekly-hunt fetch error:", error.message);
    return NextResponse.json({ error: "Failed to load weekly hunt" }, { status: 500 });
  }

  return NextResponse.json({
    weekStart: weekIso,
    count: data?.length ?? 0,
    results: (data ?? []) as WeeklyHuntRow[],
  });
}
