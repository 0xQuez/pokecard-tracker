# Card Valuation — Trigger Queue Flow

This is the data layer for **on-demand card valuation**. It is a pure trigger
queue: the frontend queues a request, a Hermes agent worker picks it up
asynchronously, researches the card, and writes back a result. There is **no
weekly cron** — work only happens when a user asks for it.

## Flow

```
User searches a card
        │
        ▼
Frontend (anon key) INSERTs a row into valuation_requests
        │   { card_query: "Charizard Base Set 4/102", user_id: "Quez" }
        ▼
Hermes agent worker (service role key) calls
        RPC  claim_next_valuation_request('worker-name')
        │
        ▼  atomically flips ONE pending → claimed (SKIP LOCKED),
        │  records claimed_by + started_at, returns the row
        ▼
Worker researches prices (eBay / TCGPlayer / PSA listings)
        │
        ▼  INSERTs into valuation_results (1:1 with the request)
        │   card_identity / price_points / condition_curve
        ▼  UPDATEs request → status='done' (+ completed_at), or
        │  'failed' with error detail
        ▼
Frontend (anon key) reads its result back
```

## Key objects

| Object | Purpose |
| ------ | ------- |
| `valuation_requests` | The queue. One row per user request; status drives claiming. |
| `valuation_results` | The result. One row per completed request (unique `request_id`). |
| `claim_next_valuation_request(worker_name)` | Atomic claim RPC for workers. See below. |
| `get_valuation_by_share_token(p_token)` | Token-gated read RPC for the vendor-facing share page. |
| `regenerate_valuation_share_token(p_result_id)` | Service-role-only RPC that rotates a result's share token. |
| index `idx_valuation_requests_claim` | `(status, priority desc, created_at asc)` — the worker's claim query. |
| index `idx_valuation_results_share_token` | Unique index backing the O(1) share-token lookup. |

## Vendor-facing share (004)

Each `valuation_results` row gets an unguessable `share_token` (a UUID, defaulted
in the DB so every result is shareable immediately on insert). The public share
page at `/valuation/share/<token>` is read-only and shows ONLY that valuation:

- The **only** anonymous read path is the security-definer RPC
  `get_valuation_by_share_token(p_token)` — it returns at most the single row
  whose token matches, so a bad/revoked token leaks nothing. The share page
  calls it with the anon key.
- **Rotating** a link (the "Regenerate link" button) is a write, so the anon
  key is NOT granted it. `regenerate_valuation_share_token(p_result_id)` is
  granted to `service_role` only and is reached through the server route
  `POST /api/valuation/regenerate-share` (see `src/app/api/valuation/regenerate-share/route.ts`).
  Changing the token revokes every previously-shared link for that result.
- The owner's own result card still reads its result directly with the anon key
  (the app has no real Supabase Auth — see the 003 note). Scoping that owner
  read per-row is the follow-up when real `auth.uid()` lands.

## How a worker claims

Use the service role key (`SUPABASE_SERVICE_ROLE_KEY`) — it bypasses RLS, so
it can both claim and write.

```ts
const supabase = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const { data: req, error } = await supabase.rpc("claim_next_valuation_request", {
  p_worker_name: "hermes-valuation-worker",
});
// req = the claimed valuation_requests row, or null when the queue is empty.
// It is guaranteed atomic: two concurrent workers never claim the same row.
```

Then:

1. Research the card from `req.card_query` (and `req.card_id` if you want to
   link to the user's owned card).
2. Build the `card_identity` / `price_points` / `condition_curve` JSONB (shapes
   documented inline in `003_valuation_requests.sql`).
3. `INSERT` into `valuation_results` with `request_id = req.id`.
4. `UPDATE valuation_requests SET status='done', completed_at=now() WHERE id = req.id`.
   On a hard error: `status='failed', error='<detail>', completed_at=now()`.

## Status lifecycle

`pending → claimed → running → done | failed | blocked`

- `pending`: queued, unclaimed.
- `claimed`: a worker grabbed it (claim RPC flips pending→claimed).
- `running`: worker is actively researching (optional heartbeat marker).
- `done`: result written.
- `failed`: worker hit an error; `error` column has detail.
- `blocked`: needs human input / permanently stuck.

## Running the migration

Apply in Supabase Dashboard > **SQL Editor** (paste `003_valuation_requests.sql`
then `004_valuation_share.sql`), or if the Supabase CLI is wired up,
`supabase db push`. Each is idempotent — safe to run more than once.

## Concurrency note

The claim RPC uses `SELECT ... FOR UPDATE SKIP LOCKED`, so any number of
worker processes can poll concurrently without double-claiming or blocking
each other. If a worker crashes after claiming, the request stays `claimed`
forever — a future enhancement is a reaper that flips stale `claimed`/`running`
rows back to `pending` after a timeout.

## Artwork embeddings (005)

Migration `005_card_embeddings.sql` is unrelated to the valuation queue — it
creates the pgvector table (`card_embeddings`) backing image-based card
matching in the camera scan flow. See `scripts/README.md` for the backfill
pipeline that populates it. Same idempotent-apply convention as the others.
