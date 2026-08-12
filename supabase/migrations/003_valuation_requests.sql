-- Card Valuation — on-demand valuation request queue + results (T18)
-- Run in Supabase Dashboard > SQL Editor (or `supabase db push`).
--
-- Purpose: the PokeCard Tracker frontend queues an on-demand valuation request
-- when a user searches a card. A Hermes agent worker picks the request up
-- asynchronously (no weekly cron), researches prices, and writes back a
-- result. This migration is the schema CONTRACT between the frontend, the
-- agent worker, and the database. It contains no API keys / scrapers.
--
-- Auth model note: the app authenticates client-side via an anon key + a
-- sessionStorage gate (there is no Supabase Auth / auth.uid()). To match the
-- existing tables in this project, RLS allows the anon role to INSERT requests
-- and SELECT results (the app's own reads/writes). The agent worker connects
-- with the SERVICE ROLE key (see src/app/api/weekly-hunt/route.ts), which
-- bypasses RLS to claim/update/write. If real Supabase Auth is added later,
-- tighten the policies to `auth.uid() = user_id`.

-- ── 1. Status enum ──────────────────────────────────────────────────────
-- Idempotent enum creation (Postgres has no CREATE TYPE IF NOT EXISTS).
do $$
begin
  if not exists (select 1 from pg_type where typname = 'valuation_request_status') then
    create type public.valuation_request_status as enum (
      'pending',    -- queued, waiting for a worker to claim
      'claimed',    -- a worker has claimed it and is working
      'running',    -- worker is actively researching (heartbeat)
      'done',       -- result written; worker finished
      'failed',     -- worker hit an error; error column has detail
      'blocked'     -- requires human input / permanently stuck
    );
  end if;
end $$;

-- ── 2. valuation_requests ───────────────────────────────────────────────
-- One row per on-demand valuation the user asked for.
create table if not exists public.valuation_requests (
  id            bigint generated always as identity primary key,
  user_id       text,                      -- app-level profile label (e.g. "Quez"); nullable until real auth
  card_query    text not null,             -- the raw search string the user typed, e.g. "Charizard Base Set 4/102"
  card_id       bigint references public.cards(id) on delete set null,  -- optional link to an owned card
  status        public.valuation_request_status not null default 'pending',
  priority      int not null default 0,    -- higher = claimed first; agent may bump for retries
  claimed_by    text,                      -- worker name that claimed it, e.g. "hermes-valuation-worker"
  created_at    timestamptz not null default now(),
  started_at    timestamptz,               -- set when claimed
  completed_at  timestamptz,               -- set when done/failed/blocked
  error         text                       -- failure detail for 'failed'/'blocked'
);

comment on table public.valuation_requests is
  'On-demand card valuation queue. Frontend inserts; Hermes agent worker claims via claim_next_valuation_request and writes results.';

-- The agent's claim query: oldest first within priority, skip already-claimed rows.
create index if not exists idx_valuation_requests_claim
  on public.valuation_requests (status, priority desc, created_at asc);

-- ── 3. valuation_results ────────────────────────────────────────────────
-- One row per completed request (1:1 with valuation_requests).
--
-- card_identity  JSONB shape:
--   { "set": "Base Set", "number": "4/102", "variant": "1st Edition"|null,
--     "name": "Charizard" }
--
-- price_points   JSONB array; each element:
--   { "source": "ebay"|"tcgplayer"|"psa",
--     "url": "https://...",
--     "price": 249.99,                       -- numeric USD
--     "condition_claimed": "NM"|"LP"|...|null,   -- seller's stated condition
--     "condition_verified": "NM"|...|null,        -- confirmed by worker from listing
--     "sold_at": "2026-07-30T..."|null,           -- for sold listings
--     "is_best_offer": true|false|null,           -- best-offer accepted price
--     "is_trust_anchor": true|false,              -- high-confidence anchor used for the curve
--     "flags": ["auction","low_ball","damaged","relisted","graded_slab", ...] }
--
-- condition_curve JSONB object; keys NM/LP/MP/HP/DMG, each:
--   { "estimated_price": 220.0, "sample_count": 5 }
--   (null entries or missing keys = no data for that condition)
create table if not exists public.valuation_results (
  id              bigint generated always as identity primary key,
  request_id      bigint not null references public.valuation_requests(id) on delete cascade,
  card_identity   jsonb,                    -- resolved card identity (see shape above)
  price_points    jsonb,                    -- array of price points (see shape above)
  condition_curve jsonb,                    -- per-condition estimate map (see shape above)
  created_at      timestamptz not null default now(),
  constraint valuation_results_request_unique unique (request_id)
);

comment on table public.valuation_results is
  'Result of a completed valuation request. JSONB shapes documented in migration comments.';

create index if not exists idx_valuation_results_request on public.valuation_results (request_id);

-- ── 4. Row Level Security ───────────────────────────────────────────────
alter table public.valuation_requests enable row level security;
alter table public.valuation_results  enable row level security;

-- NOTE: PostgreSQL has NO `CREATE POLICY IF NOT EXISTS` (the repo's 001/002 use
-- that clause and will fail on it). To keep this migration idempotent we guard
-- each policy behind a pg_policies existence check.
do $$
begin
  -- Frontend (anon key) can queue a request.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='valuation_requests' and policyname='valuation_requests_anon_insert') then
    create policy "valuation_requests_anon_insert"
      on public.valuation_requests for insert
      to anon
      with check (true);
  end if;

  -- Frontend (anon key) can read request statuses. The app authenticates
  -- client-side (sessionStorage gate) and the anon key carries no JWT identity,
  -- so like the existing cards / weekly_hunt tables this is a public read.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='valuation_requests' and policyname='valuation_requests_anon_select') then
    create policy "valuation_requests_anon_select"
      on public.valuation_requests for select
      to anon
      using (true);
  end if;

  -- Frontend (anon key) can read results.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='valuation_results' and policyname='valuation_results_anon_select') then
    create policy "valuation_results_anon_select"
      on public.valuation_results for select
      to anon
      using (true);
  end if;
end $$;

-- Base-table privileges. Supabase's default grants would add these automatically,
-- but we grant explicitly so the migration is self-contained regardless of
-- project defaults. The policies above scope what these privileges may touch.
grant usage on schema public to anon;
grant select, insert on public.valuation_requests to anon;
grant usage, select on sequence public.valuation_requests_id_seq to anon;
grant select on public.valuation_results to anon;

-- The agent worker uses the service role key (see src/app/api/weekly-hunt/route.ts),
-- which bypasses RLS entirely, so it can claim/update requests and write results
-- with no additional policy. If real Supabase Auth is added later, add explicit
-- `authenticated` policies here scoped to auth.uid() = user_id.

-- ── 5. claim_next_valuation_request(worker_name) ─────────────────────────
-- Atomic, race-safe claim: grabs ONE pending request (highest priority, then
-- oldest), flips it to 'claimed' (recording the worker + started_at), and
-- returns the full row. Uses FOR UPDATE SKIP LOCKED so concurrent workers
-- never double-claim. Call via PostgREST RPC:
--   supabase.rpc('claim_next_valuation_request', { p_worker_name: 'worker-1' })
create or replace function public.claim_next_valuation_request(p_worker_name text)
returns public.valuation_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.valuation_requests%rowtype;
begin
  select *
    into v_row
    from public.valuation_requests
   where status = 'pending'
   order by priority desc, created_at asc
   limit 1
     for update skip locked;

  if v_row.id is not null then
    update public.valuation_requests
       set status     = 'claimed',
           claimed_by = p_worker_name,
           started_at = now()
     where id = v_row.id
     returning * into v_row;
  end if;

  return v_row;
end;
$$;

-- Worker connects as service role, so allow it to call the RPC; deny anon.
revoke execute on function public.claim_next_valuation_request(text) from public;
grant  execute on function public.claim_next_valuation_request(text) to service_role;
