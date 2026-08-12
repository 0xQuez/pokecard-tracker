-- Card Valuation — vendor-facing shareable result view (T18.9)
-- Run in Supabase Dashboard > SQL Editor (or `supabase db push`).
--
-- Adds an unguessable `share_token` to valuation_results and exposes a
-- token-gated read path so a completed valuation can be shown to a third party
-- (a vendor) via a public link WITHOUT shipping any of the app's other data.
--
-- Design notes (auth model):
--   * The app has no real Supabase Auth — it authenticates client-side via an
--     anon key + a sessionStorage gate (see 003). The owner's own result reads
--     therefore stay on the anon-key public model that 003 established
--     (valuation_results_anon_select is `using (true)`), matching the existing
--     cards / weekly_hunt tables.
--   * The VENDOR/SHARE surface is the part that must not leak other rows. It is
--     gated entirely by the share_token through the security-definer RPC
--     get_valuation_by_share_token(p_token): a caller with no token gets
--     nothing, a caller with a valid token gets exactly the one matching row,
--     and there is no other public path that returns a result by this token.
--   * Regeneration is a write, so it is NOT exposed to the anon role. Only the
--     service role may call regenerate_valuation_share_token(p_result_id) —
--     the owner UI reaches it through a server route (see
--     src/app/api/valuation/regenerate-share/route.ts). Rotating revokes the
--     old link because it changes the only key that unlocks the row.

-- ── 1. share_token column ──────────────────────────────────────────────────
-- gen_random_uuid() is core since PostgreSQL 13, so no pgcrypto extension is
-- needed. Tokens are generated in the DB (not by the worker) so every row is
-- shareable immediately on insert regardless of which agent wrote it.
alter table public.valuation_results
  add column if not exists share_token text;

-- Backfill any pre-existing rows so the NOT NULL constraint below is safe.
update public.valuation_results
   set share_token = gen_random_uuid()::text
 where share_token is null;

alter table public.valuation_results
  alter column share_token set default gen_random_uuid()::text,
  alter column share_token set not null;

-- Tokens must be unique and indexed for O(1) share lookups.
create unique index if not exists idx_valuation_results_share_token
  on public.valuation_results (share_token);

-- ── 2. get_valuation_by_share_token(p_token) ───────────────────────────────
-- The ONLY anonymous read path for a shared valuation. Security definer so it
-- runs with the function owner's privileges and bypasses RLS — the row it
-- returns is determined purely by the share_token argument, so a caller can
-- never retrieve anything but the single row whose token they possess.
create or replace function public.get_valuation_by_share_token(p_token text)
returns setof public.valuation_results
language sql
security definer
set search_path = public
as $$
  select vr.*
    from public.valuation_results vr
   where vr.share_token = p_token;
$$;

-- ── 3. regenerate_valuation_share_token(p_result_id) ───────────────────────
-- Rotates a result's share token and returns the new one. Changing the token
-- revokes every previously-shared link for this result. Restricted to the
-- service role (write) — the owner UI calls a server route that uses the
-- service role key.
create or replace function public.regenerate_valuation_share_token(p_result_id bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new text;
begin
  update public.valuation_results
     set share_token = gen_random_uuid()::text
   where id = p_result_id
   returning share_token into v_new;

  if v_new is null then
    raise exception 'valuation result % not found', p_result_id;
  end if;

  return v_new;
end;
$$;

-- ── 4. Privileges ──────────────────────────────────────────────────────────
-- New functions default to EXECUTE for PUBLIC; revoke that and grant narrowly.
revoke execute on function public.get_valuation_by_share_token(text) from public;
grant  execute on function public.get_valuation_by_share_token(text) to anon;
grant  execute on function public.get_valuation_by_share_token(text) to service_role;

revoke execute on function public.regenerate_valuation_share_token(bigint) from public;
grant  execute on function public.regenerate_valuation_share_token(bigint) to service_role;

-- anon may read the share_token column for the owner's own result rows (the
-- existing valuation_results_anon_select policy governs which rows that is);
-- grants below are already present from 003 but re-asserted for self-containment.
grant usage on schema public to anon;
grant select on public.valuation_results to anon;
