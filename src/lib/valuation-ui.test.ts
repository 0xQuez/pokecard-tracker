// Unit tests for src/lib/valuation-ui.ts (pure, offline). Runs under BOTH:
//   - node --test src/lib/valuation-ui.test.ts   (Node 22+ native type stripping)
//   - npm test                                    (vitest)
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import test from "node:test";
import assert from "node:assert/strict";

import {
  RECENT_WINDOW_MS,
  buildSources,
  confidenceFor,
  deriveCurveRows,
  findRecentValuation,
  formatTimestamp,
  identityTitle,
  isRecent,
  money,
  queueValuation,
  statusMeta,
  type SupabaseClientLike,
  type ValuationRequestRow,
  type ValuationResultRow,
} from "./valuation-ui.ts";

// ── Mock supabase-js-shaped client ────────────────────────────────────────────

interface MockOptions {
  /** Rows returned for the select-based recent lookup (done requests w/ results). */
  recentRows?: (ValuationRequestRow & { valuation_results: ValuationResultRow[] })[];
  /** If set, insert() resolves to an error. */
  insertError?: { message: string } | null;
  /** The row insert() should return (default: a fresh pending row). */
  insertRow?: ValuationRequestRow;
  /** Record every builder call for assertions. */
  log?: string[];
}

function makeMockClient(opts: MockOptions): SupabaseClientLike {
  const { recentRows = [], insertError = null, insertRow, log } = opts;
  const pendingId = { next: 100 };

  return {
    from(table: string) {
      const base = {
        order() {
          return { limit: () => ({ then: async (resolve: (r: any) => void) => resolve({ data: recentRows, error: null }) }) };
        },
        limit() {
          return { then: async (resolve: (r: any) => void) => resolve({ data: recentRows, error: null }) };
        },
        select(cols: string) {
          const q = {
            eq(_col: string, _v: unknown) {
              return q;
            },
            gte(_col: string, _v: string) {
              return q;
            },
            order() {
              return { limit: () => ({ then: async (resolve: (r: any) => void) => resolve({ data: recentRows, error: null }) }) };
            },
            limit() {
              return { then: async (resolve: (r: any) => void) => resolve({ data: recentRows, error: null }) };
            },
            single() {
              const row = insertRow ?? {
                id: pendingId.next++,
                user_id: null,
                card_query: "",
                card_id: null,
                status: "pending",
                priority: 0,
                claimed_by: null,
                created_at: new Date().toISOString(),
                started_at: null,
                completed_at: null,
                error: null,
              } as ValuationRequestRow;
              if (insertError) return { then: async (resolve: (r: any) => void) => resolve({ data: null, error: insertError }) };
              return { then: async (resolve: (r: any) => void) => resolve({ data: row, error: null }) };
            },
          };
          return q;
        },
        insert(row: { card_query?: string; card_id?: number | null; user_id?: string | null }) {
          if (log) log.push("insert");
          return { select: (cols: string) => ({ single: () => ({ then: async (resolve: (r: any) => void) => resolve(insertError ? { data: null, error: insertError } : { data: insertRow ?? { id: pendingId.next++, status: "pending", card_query: row.card_query, card_id: row.card_id ?? null, user_id: row.user_id ?? null, priority: 0, claimed_by: null, created_at: new Date().toISOString(), started_at: null, completed_at: null, error: null }, error: null }) }) }) };
        },
      };
      return base;
    },
  };
}

// ── isRecent ──────────────────────────────────────────────────────────────────

test("isRecent: true for timestamps inside the 24h window", () => {
  const now = Date.now();
  assert.equal(isRecent(new Date(now - 1000).toISOString(), now), true);
  assert.equal(isRecent(new Date(now - RECENT_WINDOW_MS + 1000).toISOString(), now), true);
});

test("isRecent: false for null, invalid, or outside the window", () => {
  const now = Date.now();
  assert.equal(isRecent(null, now), false);
  assert.equal(isRecent("not-a-date", now), false);
  assert.equal(isRecent(new Date(now - RECENT_WINDOW_MS - 1000).toISOString(), now), false);
  assert.equal(isRecent(new Date(now + 5000).toISOString(), now), false);
});

// ── confidenceFor ─────────────────────────────────────────────────────────────

test("confidenceFor: sample-count drives level", () => {
  assert.equal(confidenceFor(8, true).level, "high");
  assert.equal(confidenceFor(3, true).level, "medium");
  assert.equal(confidenceFor(1, true).level, "low");
  assert.equal(confidenceFor(0, true).level, "none");
  assert.equal(confidenceFor(8, false).level, "none");
  assert.equal(confidenceFor(null, true).level, "none");
});

// ── deriveCurveRows ───────────────────────────────────────────────────────────

test("deriveCurveRows: full curve produces 5 rows with estimates + sample counts", () => {
  const rows = deriveCurveRows(
    {
      NM: { estimated_price: 850, sample_count: 8 },
      LP: { estimated_price: 690, sample_count: 6 },
      MP: { estimated_price: 520, sample_count: 7 },
      HP: { estimated_price: 380, sample_count: 4 },
      DMG: { estimated_price: 240, sample_count: 3 },
    },
    []
  );
  assert.equal(rows.length, 5);
  assert.equal(rows[0].condition, "NM");
  assert.equal(rows[0].estimatedPrice, 850);
  assert.equal(rows[0].sampleCount, 8);
  assert.equal(rows[0].confidence.level, "high");
  assert.equal(rows[4].condition, "DMG");
});

test("deriveCurveRows: missing/null cells render as no-data but keep the row", () => {
  const rows = deriveCurveRows({ NM: null, MP: { estimated_price: null, sample_count: 0 } }, []);
  assert.equal(rows.length, 5);
  const nm = rows.find((r) => r.condition === "NM")!;
  assert.equal(nm.hasData, false);
  assert.equal(nm.estimatedPrice, null);
  assert.equal(nm.confidence.level, "none");
});

test("deriveCurveRows: no curve at all → all rows no-data, order preserved", () => {
  const rows = deriveCurveRows(null, null);
  assert.deepEqual(
    rows.map((r) => r.condition),
    ["NM", "LP", "MP", "HP", "DMG"]
  );
  assert.ok(rows.every((r) => r.hasData === false));
});

// ── buildSources ──────────────────────────────────────────────────────────────

test("buildSources: keeps only url-bearing points with verified condition + price", () => {
  const src = buildSources([
    { source: "ebay", url: "https://ebay.com/itm/1", price: 10, condition_verified: "NM", is_trust_anchor: true },
    { source: "ebay", url: null, price: 20, condition_verified: "LP" }, // dropped: no url
    { source: "tcgplayer", url: "https://tcg.com/p/2", price: 9.99 },
    { source: "ebay", url: "https://ebay.com/itm/3", price: 5, condition_verified: "MP", is_best_offer: true },
  ]);
  assert.equal(src.length, 3);
  assert.equal(src[0].isTrustAnchor, true);
  assert.equal(src[1].conditionVerified, null);
  assert.equal(src[2].isBestOffer, true);
  assert.ok(src.every((s) => s.url.startsWith("http")));
});

test("buildSources: empty/null points → empty list", () => {
  assert.deepEqual(buildSources(null), []);
  assert.deepEqual(buildSources([]), []);
});

// ── statusMeta ────────────────────────────────────────────────────────────────

test("statusMeta: every status maps to a sensible label/tone", () => {
  assert.equal(statusMeta("pending", null).tone, "pending");
  assert.equal(statusMeta("pending", null).spinner, true);
  assert.equal(statusMeta("claimed", null).tone, "running");
  assert.equal(statusMeta("running", null).spinner, true);
  assert.equal(statusMeta("done", null).tone, "done");
  assert.equal(statusMeta("done", null).spinner, false);
  assert.equal(statusMeta("failed", "boom").tone, "failed");
  assert.ok(statusMeta("failed", "boom").label.includes("boom"));
  assert.equal(statusMeta("blocked", null).tone, "blocked");
});

// ── formatting ────────────────────────────────────────────────────────────────

test("money: formats USD, handles missing values", () => {
  assert.equal(money(850), "$850.00");
  assert.equal(money(9.9), "$9.90");
  assert.equal(money(null), "—");
  assert.equal(money(undefined), "—");
});

test("formatTimestamp: human-friendly, tolerates bad input", () => {
  assert.equal(formatTimestamp(null), "—");
  assert.equal(formatTimestamp("junk"), "—");
  const iso = "2026-08-12T10:03:00Z";
  const expected = new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  assert.equal(formatTimestamp(iso), expected);
});

test("identityTitle: composes name/set/number/variant", () => {
  assert.equal(identityTitle({ name: "Charizard", set: "Base", number: "4/102" }), "Charizard · Base · #4/102");
  assert.equal(identityTitle({ name: "Dragonite ex", set: "Dragon", number: "90/97", variant: "1st Edition" }), "Dragonite ex · Dragon · #90/97 · 1st Edition");
  assert.equal(identityTitle(null), "");
});

// ── queueValuation ────────────────────────────────────────────────────────────

test("queueValuation: queues a fresh pending request when no recent exists", async () => {
  const log: string[] = [];
  const client = makeMockClient({ recentRows: [], log });
  const out = await queueValuation(client, { cardQuery: "Dragonite ex", userId: "Quez" });
  assert.equal(out.kind, "queued");
  if (out.kind !== "queued") return;
  assert.equal(out.request.status, "pending");
  assert.ok(out.requestId > 0);
  assert.ok(log.includes("insert"));
  assert.match(out.message, /queued/i);
});

test("queueValuation: shows recent result instead of queuing a duplicate", async () => {
  const log: string[] = [];
  const request = { id: 7, user_id: "Quez", card_query: "Dragonite ex", card_id: null, status: "done", priority: 0, claimed_by: "w", created_at: "2026-08-12T08:00:00Z", started_at: null, completed_at: "2026-08-12T08:02:00Z", error: null } as ValuationRequestRow;
  const result = { id: 7, request_id: 7, card_identity: { name: "Dragonite ex" }, price_points: [], condition_curve: { NM: { estimated_price: 850, sample_count: 8 } }, created_at: "2026-08-12T08:02:00Z" } as ValuationResultRow;
  const client = makeMockClient({ recentRows: [{ ...request, valuation_results: [result] }], log });
  const out = await queueValuation(client, { cardQuery: "Dragonite ex" });
  assert.equal(out.kind, "shown_recent");
  if (out.kind !== "shown_recent") return;
  assert.equal(out.result.card_identity?.name, "Dragonite ex");
  assert.equal(out.requestId, 7);
  assert.ok(!log.includes("insert"));
});

test("queueValuation: surfaces insert errors", async () => {
  const client = makeMockClient({ insertError: { message: "db down" } });
  const out = await queueValuation(client, { cardQuery: "Charizard" });
  assert.equal(out.kind, "error");
  if (out.kind !== "error") return;
  assert.match(out.message, /db down/);
});

test("queueValuation: rejects an empty query", async () => {
  const out = await queueValuation(makeMockClient({}), { cardQuery: "   " });
  assert.equal(out.kind, "error");
});

// ── findRecentValuation ───────────────────────────────────────────────────────

test("findRecentValuation: returns a recent done result matching card_query", async () => {
  const request = { id: 7, card_query: "Dragonite ex", status: "done", completed_at: new Date(Date.now() - 1000).toISOString() } as ValuationRequestRow;
  const result = { id: 7, request_id: 7, card_identity: { name: "Dragonite ex" } } as ValuationResultRow;
  const client = makeMockClient({ recentRows: [{ ...request, valuation_results: [result] }] });
  const found = await findRecentValuation(client, { cardQuery: "Dragonite ex" });
  assert.ok(found);
  assert.equal(found!.request.id, 7);
});

test("findRecentValuation: returns null when nothing matches", async () => {
  const client = makeMockClient({ recentRows: [] });
  const found = await findRecentValuation(client, { cardQuery: "Mewtwo" });
  assert.equal(found, null);
});
