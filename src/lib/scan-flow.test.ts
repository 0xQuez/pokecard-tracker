// Unit tests for src/lib/scan-flow.ts (pure, offline). Runs under:
//   - node --test src/lib/scan-flow.test.ts  (Node 22+ native type stripping)
//   - npm test                               (node --test + vitest)
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCardQuery,
  buildQueueParams,
  confidenceFromScore,
  identifyCard,
  mapRawCandidate,
  mapRawCandidates,
  resolveIdentity,
  topCandidates,
  type IdentifyCandidate,
  type IdentifyResponse,
  type RawIdentifyCandidate,
} from "./scan-flow.ts";

const REGULAR: IdentifyCandidate = {
  name: "Charmander",
  set: "Scarlet & Violet Promo",
  number: "044",
  variant: null,
  price: 61,
  imageUrl: "https://img/charmander.jpg",
  confidence: "high",
};

const PC_EXCLUSIVE: IdentifyCandidate = {
  name: "Charmander",
  set: "Scarlet & Violet Promo",
  number: "044",
  variant: "Pokemon Center Exclusive",
  price: 245,
  imageUrl: "https://img/charmander-pc.jpg",
  confidence: "high",
};

// The shape the POST /api/hunter/identify route ACTUALLY returns (pipeline
// shape: set object, imageSmall/Large, score, variantHints[]).
const RAW_REGULAR = {
  id: "svp-44",
  name: "Charmander",
  set: { id: "svp", name: "Scarlet & Violet Promo" },
  number: "44",
  imageSmall: "https://img/charmander.jpg",
  imageLarge: "https://img/charmander-lg.jpg",
  score: 0.93,
  variantHints: ["regular", "Pokemon Center Exclusive"],
};

const RAW_OTHER = {
  id: "sv2-23",
  name: "Pikachu",
  set: { id: "sv2", name: "Paldea Evolved" },
  number: "23",
  imageSmall: "https://img/pikachu.jpg",
  score: 0.5,
  variantHints: [],
};

function resp(partial: Partial<IdentifyResponse> & { candidates: IdentifyCandidate[] }): IdentifyResponse {
  return { needsConfirmation: false, ...partial };
}

// ── resolveIdentity ─────────────────────────────────────────────────────────

test("resolveIdentity: auto-resolves a single high-confidence match", () => {
  const out = resolveIdentity(resp({ candidates: [REGULAR], needsConfirmation: false }));
  assert.equal(out.mode, "auto");
  if (out.mode === "auto") assert.equal(out.identity, REGULAR);
});

test("resolveIdentity: returns the full ranked list when confirmation is needed", () => {
  const candidates = [REGULAR, PC_EXCLUSIVE, REGULAR, PC_EXCLUSIVE];
  const out = resolveIdentity(resp({ candidates, needsConfirmation: true }));
  assert.equal(out.mode, "pick");
  if (out.mode === "pick") {
    // T23.4: no pre-clamp — the picker owns progressive disclosure.
    assert.equal(out.candidates.length, 4);
    assert.equal(out.candidates[0], REGULAR);
    assert.equal(out.candidates[1], PC_EXCLUSIVE);
  }
});

test("resolveIdentity: returns empty pick when there are no candidates", () => {
  const out = resolveIdentity(resp({ candidates: [], needsConfirmation: false }));
  assert.equal(out.mode, "pick");
  if (out.mode === "pick") assert.deepEqual(out.candidates, []);
});

// ── topCandidates ───────────────────────────────────────────────────────────

test("topCandidates: clamps to the requested size", () => {
  const list = [REGULAR, PC_EXCLUSIVE, REGULAR, PC_EXCLUSIVE];
  assert.equal(topCandidates(list, 3).length, 3);
  assert.equal(topCandidates(list, 2).length, 2);
  assert.equal(topCandidates([REGULAR], 3).length, 1);
});

// ── confidenceFromScore / mapRawCandidate ───────────────────────────────────

test("confidenceFromScore: maps score bands to labels", () => {
  assert.equal(confidenceFromScore(0.93), "high");
  assert.equal(confidenceFromScore(0.85), "high");
  assert.equal(confidenceFromScore(0.7), "medium");
  assert.equal(confidenceFromScore(0.6), "medium");
  assert.equal(confidenceFromScore(0.4), "low");
  assert.equal(confidenceFromScore(null), "low");
  assert.equal(confidenceFromScore(undefined), "low");
  assert.equal(confidenceFromScore(NaN), "low");
});

test("mapRawCandidate: expands variantHints into one row per print", () => {
  const out = mapRawCandidate(RAW_REGULAR as RawIdentifyCandidate);
  assert.equal(out.length, 2);
  // regular print row
  assert.equal(out[0].name, "Charmander");
  assert.equal(out[0].set, "Scarlet & Violet Promo"); // object -> string
  assert.equal(out[0].number, "44");
  assert.equal(out[0].variant, "regular");
  assert.equal(out[0].imageUrl, "https://img/charmander.jpg"); // imageSmall
  assert.equal(out[0].confidence, "high"); // score 0.93
  assert.equal(out[0].score, 0.93); // T23.4: numeric score carried to the picker
  assert.equal(out[0].price, null);
  // PC-exclusive print row — same card, distinct print
  assert.equal(out[1].variant, "Pokemon Center Exclusive");
  assert.equal(out[1].set, "Scarlet & Violet Promo");
});

test("mapRawCandidate: collapses to a single row when variantHints empty", () => {
  const out = mapRawCandidate(RAW_OTHER as RawIdentifyCandidate);
  assert.equal(out.length, 1);
  assert.equal(out[0].variant, null);
  assert.equal(out[0].name, "Pikachu");
  assert.equal(out[0].set, "Paldea Evolved");
  assert.equal(out[0].confidence, "low"); // score 0.5
});

test("mapRawCandidate: uses imageLarge when imageSmall absent", () => {
  const out = mapRawCandidate({
    ...RAW_OTHER,
    imageSmall: undefined,
    imageLarge: "https://img/pikachu-lg.jpg",
  } as unknown as RawIdentifyCandidate);
  assert.equal(out[0].imageUrl, "https://img/pikachu-lg.jpg");
});

test("mapRawCandidates: flatMaps multiple raw candidates", () => {
  const out = mapRawCandidates([
    RAW_REGULAR as RawIdentifyCandidate,
    RAW_OTHER as RawIdentifyCandidate,
  ]);
  // 2 (from variantHints) + 1 (no hints) = 3 display rows
  assert.equal(out.length, 3);
  assert.equal(out[0].variant, "regular");
  assert.equal(out[2].name, "Pikachu");
});

test("mapRawCandidates: tolerates empty/undefined input", () => {
  assert.deepEqual(mapRawCandidates([]), []);
  assert.deepEqual(mapRawCandidates(undefined as unknown as RawIdentifyCandidate[]), []);
});

// ── buildCardQuery ──────────────────────────────────────────────────────────

test("buildCardQuery: name + set + number + variant, empty parts dropped", () => {
  assert.equal(
    buildCardQuery({ name: "Charmander", set: "SVP", number: "044", variant: "Pokemon Center Exclusive" }),
    "Charmander SVP 044 Pokemon Center Exclusive"
  );
});

test("buildCardQuery: handles missing fields", () => {
  assert.equal(buildCardQuery({ name: "Pikachu", set: null, number: null, variant: null }), "Pikachu");
  assert.equal(buildCardQuery({ name: "  ", set: "", number: undefined, variant: undefined }), "");
});

// ── buildQueueParams ────────────────────────────────────────────────────────

test("buildQueueParams: cardQuery from identity, cardId null, userId threaded", () => {
  const p = buildQueueParams(PC_EXCLUSIVE, "Quez");
  assert.equal(p.cardId, null);
  assert.equal(p.cardQuery, "Charmander Scarlet & Violet Promo 044 Pokemon Center Exclusive");
  assert.equal(p.userId, "Quez");
});

test("buildQueueParams: userId null when omitted", () => {
  const p = buildQueueParams(REGULAR);
  assert.equal(p.userId, null);
});

// ── identifyCard ────────────────────────────────────────────────────────────

function makeFetch(opts: {
  ok?: boolean;
  status?: number;
  body?: any;
  throwErr?: boolean;
  log?: { url: string; init: any }[];
}): typeof fetch {
  const { ok = true, status = 200, body = {}, throwErr = false, log = [] } = opts;
  return (async (url: any, init?: any) => {
    log.push({ url, init });
    if (throwErr) throw new Error("network down");
    return {
      ok,
      status,
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

test("identifyCard: POSTs the image URL and maps raw candidates", async () => {
  const log: { url: string; init: any }[] = [];
  const fetchImpl = makeFetch({
    log,
    body: { candidates: [RAW_REGULAR, RAW_OTHER], needsConfirmation: true },
  });
  const res = await identifyCard("https://img/scan.jpg", fetchImpl);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(log.length, 1);
  assert.equal(log[0].url, "/api/hunter/identify");
  assert.equal(log[0].init.method, "POST");
  assert.equal(JSON.parse(log[0].init.body).imageUrl, "https://img/scan.jpg");
  assert.equal(res.data.needsConfirmation, true);
  // variantHint expansion: 2 (Charmander) + 1 (Pikachu) = 3 display rows
  assert.equal(res.data.candidates.length, 3);
  assert.equal(res.data.candidates[0].set, "Scarlet & Violet Promo");
  assert.equal(res.data.candidates[0].variant, "regular");
  assert.equal(res.data.candidates[0].confidence, "high");
  assert.equal(res.data.candidates[1].variant, "Pokemon Center Exclusive");
});

test("identifyCard: maps an HTTP error to a message", async () => {
  const fetchImpl = makeFetch({ ok: false, status: 500, body: { error: "vision busy" } });
  const res = await identifyCard("https://img/scan.jpg", fetchImpl);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.error, "vision busy");
});

test("identifyCard: maps a non-2xx without an error body to a default message", async () => {
  const fetchImpl = makeFetch({ ok: false, status: 404, body: {} });
  const res = await identifyCard("https://img/scan.jpg", fetchImpl);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.match(res.error, /could not identify/i);
});

test("identifyCard: rejects when candidates is missing/malformed", async () => {
  const fetchImpl = makeFetch({ ok: true, body: { needsConfirmation: false } });
  const res = await identifyCard("https://img/scan.jpg", fetchImpl);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.match(res.error, /candidate data/i);
});

test("identifyCard: never throws on network failure", async () => {
  const fetchImpl = makeFetch({ throwErr: true });
  const res = await identifyCard("https://img/scan.jpg", fetchImpl);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.error, "network down");
});

test("identifyCard: rejects an empty/missing image url", async () => {
  const fetchImpl = makeFetch({});
  const res = await identifyCard("", fetchImpl);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.match(res.error, /no captured image/i);
});
