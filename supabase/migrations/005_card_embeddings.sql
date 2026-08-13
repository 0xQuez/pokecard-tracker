-- Card artwork embeddings — pgvector knowledge base for image-based card matching (T23.1)
-- Run in Supabase Dashboard > SQL Editor (or `supabase db push`).
--
-- Purpose: the camera scan flow (src/lib/hunter) currently text-matches vision-extracted
-- card text against pokemontcg.io and mispicks (e.g. SVP Charmander 044 returned Detective
-- Pikachu's Charmander). The fix is artwork-embedding matching: every card's canonical art
-- gets a CLIP image embedding here, and at scan time the photo's embedding is compared
-- against this table with approximate nearest-neighbor search.
--
-- EMBEDDING MODEL / DIMENSION: this table is sized for CLIP ViT-B/32
-- (Xenova/clip-vit-base-patch32 via @huggingface/transformers), which produces a 512-dim
-- image embedding (CLIPVisionModelWithProjection.image_embeds). If the model is ever
-- swapped, the column type below and scripts/embed-cards.mjs must change together.
--   embedding vector(512)
--
-- This is a read-mostly reference table: the offline backfill script (scripts/embed-cards.mjs)
-- writes it once, and the scan-time matcher reads it. The app has no real Supabase Auth
-- (anon key + sessionStorage gate, matching every other table in this repo), so anon is
-- granted read/write. Idempotent — safe to run more than once.

-- 1. pgvector extension (vector type + HNSW operator class).
create extension if not exists vector with schema public;

-- 2. Embedding table. card_id is the pokemontcg.io card id (unique per printing), which is
--    the natural primary key and lets the backfill upsert idempotently.
create table if not exists public.card_embeddings (
  card_id    text primary key,               -- pokemontcg.io card id, e.g. 'hgss4-1'
  set_id     text,                           -- set.code from pokemontcg.io, e.g. 'hgss4'
  number     text,                           -- card number within set, e.g. '1'
  name       text,                           -- card name, e.g. 'Charizard'
  image_url  text,                           -- canonical art URL embedded (images.large)
  embedding  vector(512) not null,           -- CLIP ViT-B/32 image embedding
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Approximate nearest-neighbor index. HNSW is chosen over ivfflat because it does not
--    require a separate training/insert phase, gives better recall at this scale (~19k rows),
--    and is the pgvector-recommended default for static-ish reference tables that are
--    appended incrementally when new sets drop. Cosine distance matches the L2-normalized
--    CLIP embeddings the backfill stores.
create index if not exists idx_card_embeddings_hnsw
  on public.card_embeddings
  using hnsw (embedding vector_cosine_ops);

-- 4. RLS + privileges. Enable RLS and let the anon role read + write, consistent with the
--    rest of this repo (no real Supabase Auth; anon key is the app identity). The backfill
--    script connects with the anon key (or service role if supplied), so it needs insert +
--    update to upsert; the scan-time matcher needs select.
alter table public.card_embeddings enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_embeddings' and policyname='card_embeddings_anon_select') then
    create policy "card_embeddings_anon_select"
      on public.card_embeddings for select
      to anon
      using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_embeddings' and policyname='card_embeddings_anon_insert') then
    create policy "card_embeddings_anon_insert"
      on public.card_embeddings for insert
      to anon
      with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_embeddings' and policyname='card_embeddings_anon_update') then
    create policy "card_embeddings_anon_update"
      on public.card_embeddings for update
      to anon
      using (true)
      with check (true);
  end if;
end $$;

grant usage on schema public to anon;
grant select, insert, update on public.card_embeddings to anon;
-- Note: no sequence here — card_id is a natural text key, not a generated identity.
