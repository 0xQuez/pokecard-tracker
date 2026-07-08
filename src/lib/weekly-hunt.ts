import type { NextRequest, NextResponse } from "next/server";

// ── Weekly Hunt DB model ───────────────────────────────────────────────────────

export type WeeklyHuntRow = {
  id: number;
  card_name: string;
  set_name: string;
  edition: string;
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

// ── Weekly Hunt Supabase table (SQL migration to apply in Supabase Dashboard) ──
/*
-- Run this in Supabase Dashboard (SQL Editor)
create table if not exists public.weekly_hunt (
  id               bigint generated always as identity primary key,
  card_name        text not null,
  set_name         text not null,
  edition          text,
  raw_price        numeric not null,
  psa6_price       numeric,
  psa7_price       numeric,
  psa8_price       numeric,
  psa9_price       numeric,
  margin           numeric not null default 0,
  passes_filter    boolean not null default false,
  week_start_date  date not null,
  created_at       timestamptz not null default now()
);

-- Index for fast latest-week lookups
create index if not exists idx_weekly_hunt_week on public.weekly_hunt(week_start_date desc, passes_filter desc, margin desc);
create index if not exists idx_weekly_hunt_card on public.weekly_hunt(card_name, week_start_date desc);

-- Enable RLS for public read-only
create policy public_weekly_hunt_select on public.weekly_hunt
  for select using (true);
*/

