# Card artwork embedding backfill (T23.1)

Builds the pgvector knowledge base that powers image-based card matching in the
camera scan flow (`src/lib/hunter`). For every Pokemon card in the
[pokemontcg.io](https://pokemontcg.io) catalog it downloads the canonical art,
computes a CLIP image embedding **locally** (no per-image API cost), and upserts
it into Supabase.

- Schema: `supabase/migrations/005_card_embeddings.sql`
- Script: `scripts/embed-cards.mjs`
- Model: `Xenova/clip-vit-base-patch32` via `@huggingface/transformers`
  (`CLIPVisionModelWithProjection`), 512-dim embeddings. Weights download once
  to the HuggingFace cache on first run.

## Prereqs

- `node` (v18+; repo runs v22).
- `@huggingface/transformers` installed (added to `package.json` dependencies).
- `.env.local` with `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`) and a key.
  The script prefers `SUPABASE_SERVICE_ROLE_KEY` if set, else the anon key —
  migration 005 grants the anon role read/write on `card_embeddings`, matching
  the repo's no-real-auth model.
- Migration 005 applied. See "Apply the migration" below.

## Commands

### Smoke run (verification, ~50 cards)

```bash
node scripts/embed-cards.mjs --limit=50
```

Runs the whole pipeline end-to-end on a 50-card subset. Because the catalog is
ordered deterministically (sorted by card id), `--limit=50` always targets the
**same 50 cards**, so re-running it once they're embedded inserts 0 new rows —
that's the idempotency check. Expect output like:

```
[embed-cards] 20479 cards in catalog, 50 targeted, 50 new to embed
[embed-cards] 50 embedded, 0 failed
[embed-cards] upserted 50/50
[embed-cards] done. 50 rows upserted, 0 failed, 0 skipped.
```

Verify the rows landed:

```sql
select count(*), count(*) filter (where embedding is null) as null_emb,
       count(distinct vector_dims(embedding)) as dims
from card_embeddings;
-- 50 | 0 | 1   (50 rows, no null embeddings, all dim=512)
```

### Full backfill (~19k cards)

```bash
node scripts/embed-cards.mjs
```

With no `--limit` it enumerates the entire catalog and embeds every card not yet
in the table. This is the long-running job the operator runs once; it can take
hours on CPU and is designed to be resumed.

### Re-running for new sets (incremental)

When a new set drops, just run the full command again. The script:
1. Fetches every `card_id` already in the table and skips those.
2. Enumerates the catalog (any card added since the last run gets picked up).
3. Upserts with `ON CONFLICT (card_id) DO UPDATE`.

New sets flow in automatically; nothing to reconfigure.

## Resilience & idempotency notes

- **Retry with backoff:** every HTTP request retries with jittered exponential
  backoff on 429/5xx (pokemontcg.io 500s under bursts). Downloads and embeds
  run at bounded concurrency (5) so the API isn't hammered.
- **Enumeration completeness:** catalog pages that fail are retried across
  several rounds until every page succeeds; the run aborts (exit 1) if any page
  is still unreachable after retries, rather than silently shipping a partial
  catalog. Re-running resumes cleanly.
- **Crash resume:** `card_id` is the primary key and upserts are idempotent, so
  re-running after a crash or timeout continues where it left off — already-
  embedded cards are skipped, interrupted ones are re-embedded.
- **Per-card failures:** an image that can't be downloaded/embedded is logged as
  FAILED and skipped (doesn't kill the run). Re-running retries it.

## Apply the migration

The script needs the `card_embeddings` table to exist first. Apply
`supabase/migrations/005_card_embeddings.sql` in the Supabase Dashboard SQL
Editor (or `supabase db push`). It's idempotent — safe to re-run. It enables
the `vector` extension, creates the table with an HNSW `vector_cosine_ops`
index, enables RLS, and grants the anon role select/insert/update.
