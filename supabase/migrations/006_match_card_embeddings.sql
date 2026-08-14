-- Scan-time embedding lookup — nearest-neighbor search over card_embeddings (T23.2)
-- Run in Supabase Dashboard > SQL Editor (or `supabase db push`) AFTER 005.
--
-- Purpose: the camera scan flow embeds the user's card photo with the same CLIP
-- model the backfill used (Xenova/clip-vit-base-patch32, 512-dim, L2-normalized)
-- and asks this function for the top-k catalog cards by cosine distance. It is the
-- primary candidate source at scan time (T23.2); the pokemontcg.io text matcher
-- becomes a fallback only when the embeddings table is empty/unavailable.
--
-- Similarity semantics: embeddings are L2-normalized, so cosine distance
-- (`<=>` operator) and Euclidean distance agree in ranking, and
--   similarity = 1 - distance  ∈  [-1, 1]  (cosine similarity).
-- We clamp negatives to 0 so the returned score is a 0..1 similarity the
-- pipeline can feed straight into its candidate score field (monotonic in
-- ranking, so it never changes the ORDER BY). The `<=>` ORDER BY is served by
-- the HNSW vector_cosine_ops index from migration 005.
--
-- Idempotent: `create or replace`. The anon role is granted EXECUTE (the app's
-- no-real-auth model — see migration 005).

create or replace function public.match_card_embeddings(
  query_embedding vector(512),
  match_count int default 20
) returns table (
  card_id    text,
  set_id     text,
  number     text,
  name       text,
  image_url  text,
  similarity float
) language plpgsql as $$
begin
  return query
    select ce.card_id,
           ce.set_id,
           ce.number,
           ce.name,
           ce.image_url,
           greatest(0::float, 1 - (ce.embedding <=> query_embedding)) as similarity
    from public.card_embeddings ce
    order by ce.embedding <=> query_embedding asc
    limit match_count;
end;
$$;

grant execute on function public.match_card_embeddings(vector, int) to anon;
-- Note: no sequence here — this is a pure read-only search function.
