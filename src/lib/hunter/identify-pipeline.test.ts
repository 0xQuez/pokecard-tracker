// Unit tests for src/lib/hunter/identify-pipeline.ts (T22.5) — pure, offline.
// Runs under: node --test src/lib/hunter/identify-pipeline.test.ts (Node 22+ type stripping)
import test from "node:test";
import assert from "node:assert/strict";

import {
  runIdentifyPipeline,
  applyStampTiebreak,
  decideNeedsConfirmation,
  trimCandidates,
  buildVariantHints,
  stampCategory,
  hasStampConflict,
  CONFIRMATION_GAP,
  AMBIGUOUS_CANDIDATE_LIMIT,
  CLEAR_CANDIDATE_LIMIT,
  type IdentifyCandidate,
  type ExtractedIdentity,
} from "./identify-pipeline.ts";
import { HttpError } from "./tcg-match.ts";
import { VisionNotConfigured } from "./vision-identify.ts";

// ── helpers ──────────────────────────────────────────────────────────────────

/** A full-ish vision identity for a Pokemon-Center-stamped svp-44 Charmander. */
const charmanderPC: ExtractedIdentity = {
  name: "Charmander",
  setName: "Scarlet & Violet Black Star Promos",
  setCode: "SVP",
  collectorNumber: "044/SVP 44",
  variant: "holo",
  print: null,
  stamp: "Pokemon Center",
  confidence: 0.92,
};

/** A plain Charmander svp-44 with no stamp. */
const charmanderPlain: ExtractedIdentity = {
  ...charmanderPC,
  stamp: null,
};

/** A visionFn that returns raw model JSON for the given identity. */
function visionReturning(
  identity: ExtractedIdentity | { error: "unreadable" },
): (url: string) => Promise<string> {
  if ("error" in identity) {
    return async () => '{"name":null,"collectorNumber":null}';
  }
  return async () => JSON.stringify(identity);
}

/** A match fetch that returns the given raw cards. */
function matchReturning(raw: unknown[]) {
  return {
    matchOptions: {
      fetchFn: async () => ({ data: raw }),
      logger: () => {},
    },
  };
}

const svp44Raw = {
  id: "svp-44",
  name: "Charmander",
  number: "44",
  set: { id: "svp", name: "Scarlet & Violet Black Star Promos", series: "Scarlet & Violet" },
  images: { small: "https://images.pokemontcg.io/svp/44.png", large: "https://images.pokemontcg.io/svp/44_hires.png" },
};

// ── stampCategory / buildVariantHints ────────────────────────────────────────

test("stampCategory classifies Pokemon Center", () => {
  assert.equal(stampCategory("Pokemon Center"), "pokemon-center");
  assert.equal(stampCategory("Pokemon Center Exclusive"), "pokemon-center");
  assert.equal(stampCategory(null), null);
});

test("buildVariantHints: PC stamp -> regular + PC Exclusive", () => {
  assert.deepEqual(buildVariantHints({ variant: "holo", print: null, stamp: "Pokemon Center" }), [
    "regular",
    "Pokemon Center Exclusive",
  ]);
});

test("buildVariantHints: no stamp -> variant reading", () => {
  assert.deepEqual(buildVariantHints({ variant: "holo", print: null, stamp: null }), ["Holo"]);
  assert.deepEqual(buildVariantHints({ variant: "reverse_holo", print: null, stamp: null }), ["Reverse Holo"]);
  assert.deepEqual(buildVariantHints({ variant: null, print: null, stamp: null }), []);
});

test("hasStampConflict: PC stamp is a conflict", () => {
  assert.equal(hasStampConflict({ stamp: "Pokemon Center" }), true);
  assert.equal(hasStampConflict({ stamp: null }), false);
});

// ── applyStampTiebreak ───────────────────────────────────────────────────────

test("applyStampTiebreak enriches top PC candidate + bumps its score", () => {
  const out = applyStampTiebreak(
    [{ ...toCard(svp44Raw, charmanderPC) }],
    charmanderPC,
  );
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].variantHints, ["regular", "Pokemon Center Exclusive"]);
  assert.ok(out[0].score > toCard(svp44Raw, charmanderPC).score);
});

// ── decideNeedsConfirmation / trimCandidates ────────────────────────────────

test("decideNeedsConfirmation: close top-2 gap (< 0.15) -> true", () => {
  const c: IdentifyCandidate[] = [
    { id: "a", name: "A", set: { id: "s", name: "S" }, number: "1", score: 0.9, variantHints: [] },
    { id: "b", name: "B", set: { id: "s", name: "S" }, number: "2", score: 0.85, variantHints: [] },
  ];
  assert.equal(c[0].score - c[1].score < CONFIRMATION_GAP, true);
  assert.equal(decideNeedsConfirmation(c, charmanderPlain), true);
});

test("decideNeedsConfirmation: wide gap + no stamp -> false (auto-resolve)", () => {
  const c: IdentifyCandidate[] = [
    { id: "a", name: "A", set: { id: "s", name: "S" }, number: "1", score: 0.99, variantHints: [] },
    { id: "b", name: "B", set: { id: "s", name: "S" }, number: "2", score: 0.5, variantHints: [] },
  ];
  assert.equal(decideNeedsConfirmation(c, charmanderPlain), false);
});

test("decideNeedsConfirmation: PC stamp forces confirmation even alone", () => {
  const c: IdentifyCandidate[] = [
    { id: "svp-44", name: "Charmander", set: { id: "svp", name: "SVP" }, number: "44", score: 0.99, variantHints: [] },
  ];
  assert.equal(decideNeedsConfirmation(c, charmanderPC), true);
});

test("trimCandidates: unambiguous -> 1; ambiguous -> up to 3", () => {
  const list: IdentifyCandidate[] = [
    { id: "1", name: "A", set: { id: "s", name: "S" }, number: "1", score: 0.9, variantHints: [] },
    { id: "2", name: "B", set: { id: "s", name: "S" }, number: "2", score: 0.85, variantHints: [] },
    { id: "3", name: "C", set: { id: "s", name: "S" }, number: "3", score: 0.8, variantHints: [] },
  ];
  assert.equal(trimCandidates(list, false).length, CLEAR_CANDIDATE_LIMIT);
  assert.equal(trimCandidates(list, true).length, AMBIGUOUS_CANDIDATE_LIMIT);
});

// ── runIdentifyPipeline ──────────────────────────────────────────────────────

test("pipeline: unambiguous -> 1 candidate, needsConfirmation false", async () => {
  const out = await runIdentifyPipeline("https://img/x.png", {
    visionFn: visionReturning(charmanderPlain),
    ...matchReturning([svp44Raw]),
  });
  assert.equal(out.status, "ok");
  if (out.status !== "ok") return;
  assert.equal(out.candidates.length, 1);
  assert.equal(out.candidates[0].id, "svp-44");
  assert.equal(out.needsConfirmation, false);
  assert.equal(out.extracted.name, "Charmander");
});

test("pipeline: PC stamp -> needsConfirmation true + variantHints present", async () => {
  const out = await runIdentifyPipeline("https://img/x.png", {
    visionFn: visionReturning(charmanderPC),
    ...matchReturning([svp44Raw]),
  });
  assert.equal(out.status, "ok");
  if (out.status !== "ok") return;
  assert.equal(out.needsConfirmation, true);
  assert.deepEqual(out.candidates[0].variantHints, ["regular", "Pokemon Center Exclusive"]);
});

test("pipeline: ambiguous tie -> 2-3 candidates + needsConfirmation true", async () => {
  const out = await runIdentifyPipeline("https://img/x.png", {
    visionFn: visionReturning(charmanderPlain),
    ...matchReturning([
      svp44Raw,
      { ...svp44Raw, id: "svp-44b", name: "Charmander", number: "44", images: {} },
    ]),
  });
  assert.equal(out.status, "ok");
  if (out.status !== "ok") return;
  assert.equal(out.needsConfirmation, true);
  assert.ok(out.candidates.length >= 2 && out.candidates.length <= 3);
});

test("pipeline: unreadable -> UNREADABLE_IMAGE", async () => {
  const out = await runIdentifyPipeline("https://img/blurry.png", {
    visionFn: visionReturning({ error: "unreadable" }),
  });
  assert.equal(out.status, "unreadable");
  if (out.status === "unreadable") assert.equal(out.code, "UNREADABLE_IMAGE");
});

test("pipeline: no match -> NO_MATCH with extracted identity", async () => {
  const out = await runIdentifyPipeline("https://img/x.png", {
    visionFn: visionReturning(charmanderPlain),
    ...matchReturning([]),
  });
  assert.equal(out.status, "no-match");
  if (out.status !== "no-match") return;
  assert.equal(out.code, "NO_MATCH");
  assert.equal(out.extracted.name, "Charmander");
});

test("pipeline: tcg down after retries -> TCG_API_UNAVAILABLE", async () => {
  const failingFetch = async () => {
    throw new HttpError(502, "HTTP 502");
  };
  const out = await runIdentifyPipeline("https://img/x.png", {
    visionFn: visionReturning(charmanderPlain),
    matchOptions: { fetchFn: failingFetch, logger: () => {}, sleep: async () => {} },
  });
  assert.equal(out.status, "tcg-down");
  if (out.status === "tcg-down") assert.equal(out.code, "TCG_API_UNAVAILABLE");
});

test("pipeline: vision not configured -> VISION_NOT_CONFIGURED", async () => {
  const out = await runIdentifyPipeline("https://img/x.png", {
    visionFn: async () => {
      throw new VisionNotConfigured();
    },
  });
  assert.equal(out.status, "vision-down");
  if (out.status === "vision-down") assert.equal(out.code, "VISION_NOT_CONFIGURED");
});

// ── helper (mirrors toCandidate in the pipeline) ─────────────────────────────

function toCard(raw: any, identity: ExtractedIdentity): IdentifyCandidate {
  return {
    id: raw.id,
    name: raw.name,
    set: { id: raw.set?.id ?? "", name: raw.set?.name ?? "", series: raw.set?.series },
    number: raw.number,
    imageSmall: raw.images?.small,
    imageLarge: raw.images?.large,
    score: 0.95,
    variantHints: buildVariantHints(identity),
  };
}
