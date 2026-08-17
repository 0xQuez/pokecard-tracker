-- T27: Ensure the realtime publication includes the valuation tables.
--
-- Supabase only broadcasts postgres_changes for tables explicitly added to the
-- `supabase_realtime` publication. If valuation_requests (or valuation_results)
-- is missing, the browser's anon client SUBSCRIBES but never receives the UPDATE
-- when a request flips to 'done' — the result card stays stuck at "queued".
--
-- Idempotent: safe to run any number of times in Supabase Dashboard > SQL Editor.
--
-- Verify membership:
--   select schemaname, tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' order by tablename;

do $$
begin
  -- Add each table to the realtime publication only if it exists and is not
  -- already a member (avoids "table ... is already member of publication").
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'valuation_requests'
  ) and not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'valuation_requests'
  ) then
    alter publication supabase_realtime add table public.valuation_requests;
  end if;

  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'valuation_results'
  ) and not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'valuation_results'
  ) then
    alter publication supabase_realtime add table public.valuation_results;
  end if;
end $$;
