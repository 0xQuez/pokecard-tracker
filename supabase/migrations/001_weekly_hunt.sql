-- Weekly Hunt table migration
-- Run in Supabase Dashboard > SQL Editor

create table if not exists public.weekly_hunt (
  id               bigint generated always as identity primary key,
  card_name        text not null,
  card_number      text,                         -- e.g. "4/102"
  set_name         text not null,
  edition          text,                         -- "1st Edition", "Unlimited", "Shadowless"
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

-- Fast lookups: latest week, best margins, card history
comment on table public.weekly_hunt is 'Weekly researched card picks with grading margins';
create index if not exists idx_weekly_hunt_week on public.weekly_hunt(week_start_date desc, passes_filter desc, margin desc);
create index if not exists idx_weekly_hunt_card on public.weekly_hunt(card_name, week_start_date desc);

-- Enable RLS
alter table public.weekly_hunt enable row level security;

-- Allow public read-only (app reads without auth)
create policy if not exists public_weekly_hunt_select on public.weekly_hunt
  for select using (true);

-- ── Cleanup: delete rogue weekly_hunt data that leaked into cards table ──
delete from public.cards
where notes like 'weekly_hunt:%';
