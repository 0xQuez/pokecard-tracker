// Unit tests for src/lib/hunter/hybrid-matcher.ts (T23.3) — pure, offline.
// Runs under: node --test src/lib/hunter/hybrid-matcher.test.ts (Node 22+ type stripping)
import test from "node:test";
import assert from "node:assert/strict";

import {
  hybridMatch,
  metadataMatchesVision,
  normalizeName,
  stampCategory,
  visionHasStamp,
  SAME_ART_VARIANT_REASON,
  CLOSE_MATCH_REASON,
  type HybridCandidateInput,
} from "./hybrid-matcher.ts";
import type { CardIdentity } from "./vision-identify.ts";

// ── helpers ─────────────────────────────────────────────────────────────────

type Identity = Pick<CardIdentity, "name" | "variant" | "print" | "stamp" | "setName" | "collectorNumber" | "setCode" | "confidence">;

function identity(partial: Partial<Identity>): Identity {
  return {
    name: "Charmander",
    setName: "Scarlet & Violet Black Star Promos",
    setCode: "SVP",
    collectorNumber: "044/SVP 44",
    variant: "holo",
    print: null,
    stamp: null,
    confidence: 0.9,
    ...partial,
  };
}

function cand(partial: Partial<HybridCandidateInput>): HybridCandidateInput {
  return {
    id: "svp-44",
    name: "Charmander",
    similarity: 0.94,
    variant: null,
    stamp: null,
    ...partial,
  };
}

// ── helpers: normalization ──────────────────────────────────────────────────

test("normalizeName strips case/spaces/punct", () => {
  assert.equal(normalizeName("Charmander"), "charmander");
  assert.equal(normalizeName("Detective Pikachu's Charmander"), "detective pikachu s charmander");
  assert.equal(normalizeName("  Mewtwo EX  "), "mewtwo ex");
  assert.equal(normalizeName(null), "");
  assert.equal(normalizeName(""), "");
});

test("stampCategory classifies pricing stamps", () => {
  assert.equal(stampCategory("Pokemon Center"), "pokemon-center");
  assert.equal(stampCategory("Pokemon Center Exclusive"), "pokemon-center");
  assert.equal(stampCategory("1st Edition"), "1st-edition");
  assert.equal(stampCategory("Shadowless"), "shadowless");
  assert.equal(stampCategory("Professor"), "professor");
  assert.equal(stampCategory(null), null);
  assert.equal(stampCategory("none"), null);
});

test("visionHasStamp true only for pricing stamp", () => {
  assert.equal(visionHasStamp({ stamp: "Pokemon Center" }), true);
  assert.equal(visionHasStamp({ stamp: null }), false);
  assert.equal(visionHasStamp({ stamp: "some random logo" }), false);
});

// ── metadataMatchesVision ───────────────────────────────────────────────────

test("metadataMatchesVision: stamp category match", () => {
  const vision = identity({ stamp: "Pokemon Center" });
  assert.equal(
    metadataMatchesVision({ stamp: "Pokemon Center" }, vision),
    true,
  );
  assert.equal(metadataMatchesVision({ stamp: "pokemon-center" }, vision), true);
  assert.equal(metadataMatchesVision({ stamp: null }, vision), false);
  assert.equal(metadataMatchesVision({ stamp: "1st Edition" }, vision), false);
});

test("metadataMatchesVision: variant match when no stamp", () => {
  const vision = identity({ stamp: null, variant: "holo" });
  assert.equal(metadataMatchesVision({ variant: "holo" }, vision), true);
  assert.equal(metadataMatchesVision({ variant: "regular" }, vision), false);
  assert.equal(metadataMatchesVision({ variant: null }, vision), false);
});

// ── ACCEPTANCE 1: synthetic same-art stamp vs no-stamp ─────────────────────

test("ACCEPTANCE: stamp vs no-stamp tie -> both retained, stamped first, confirm", () => {
  const identityPC = identity({ stamp: "Pokemon Center" });
  const out = hybridMatch(
    [
      // Same artwork (near-identical similarity), one regular, one PC-stamped.
      cand({ id: "svp-44", name: "Charmander", similarity: 0.94, stamp: null }),
      cand({ id: "svp-44-pc", name: "Charmander", similarity: 0.93, stamp: "Pokemon Center" }),
    ],
    identityPC,
  );

  // Both retained (the ambiguous tie is never collapsed to a single candidate).
  assert.equal(out.ranked.length, 2);
  // The stamped one is ranked first.
  assert.equal(out.ranked[0].candidate.id, "svp-44-pc");
  assert.equal(out.ranked[0].variantMatch, true);
  // needsConfirmation + reason.
  assert.equal(out.needsConfirmation, true);
  assert.equal(out.reason, SAME_ART_VARIANT_REASON);
  assert.equal(out.tieDetected, true);
  // The stamped candidate's final score beats the regular one.
  assert.ok(out.ranked[0].finalScore > out.ranked[1].finalScore);
});

test("ACCEPTANCE variant: vision sees stamp but NO candidate metadata distinguishes -> keep group + confirm", () => {
  const identityPC = identity({ stamp: "Pokemon Center" });
  // Two same-art candidates, neither carries stamp metadata (catalog case —
  // pokemontcg.io does not split svp-44 regular vs PC-exclusive).
  const out = hybridMatch(
    [
      cand({ id: "svp-44", similarity: 0.94, stamp: null }),
      cand({ id: "svp-45", similarity: 0.93, stamp: null }),
    ],
    identityPC,
  );

  assert.equal(out.ranked.length, 2);
  assert.equal(out.ranked[0].candidate.id, "svp-44"); // original sim order kept
  assert.equal(out.needsConfirmation, true);
  assert.equal(out.reason, SAME_ART_VARIANT_REASON);
  assert.equal(out.tieDetected, true);
  // No variantMatch boost applied (no metadata to match against).
  assert.equal(out.ranked[0].variantMatch, false);
  // Both final scores are within the name-bonus-only band (close) — and even
  // if we'd broken the tie we still confirm.
  assert.ok(out.ranked[0].finalScore - out.ranked[1].finalScore < 0.02);
});

// ── ACCEPTANCE 2: clear-cut distinct art ────────────────────────────────────

test("ACCEPTANCE: clear-cut (distinct art, high top-1) -> no confirmation", () => {
  const out = hybridMatch(
    [
      cand({ id: "svp-44", name: "Charmander", similarity: 0.99 }),
      cand({
        id: "det1-4",
        name: "Detective Pikachu's Charmander",
        similarity: 0.7,
      }),
    ],
    identity({ stamp: null }),
  );

  assert.equal(out.ranked[0].candidate.id, "svp-44");
  assert.equal(out.needsConfirmation, false);
  assert.equal(out.reason, null);
  assert.equal(out.tieDetected, false);
  // Single candidate when unambiguous is the pipeline's trim job, but the
  // matcher itself must surface just one clear winner as rank 1.
  assert.equal(out.ranked.length, 2);
  // The gap is decisive.
  assert.ok(out.ranked[0].finalScore - out.ranked[1].finalScore > 0.02);
});

// ── name bonus ──────────────────────────────────────────────────────────────

test("name bonus: vision name match nudges, does not override similarity", () => {
  // Two distinct-art candidates, same sim; only one has a matching name.
  const out = hybridMatch(
    [
      cand({ id: "other", name: "Different Card", similarity: 0.9 }),
      cand({ id: "svp-44", name: "Charmander", similarity: 0.9 }),
    ],
    identity({ stamp: null, name: "Charmander" }),
  );
  // svp-44 got the name bonus, so it ranks first.
  assert.equal(out.ranked[0].candidate.id, "svp-44");
  assert.equal(out.ranked[0].nameMatched, true);
  assert.equal(out.ranked[1].nameMatched, false);
  assert.ok(Math.abs(out.ranked[0].finalScore - out.ranked[1].finalScore - 0.02) < 1e-9);
});

// ── confirmation margin ─────────────────────────────────────────────────────

test("close top-2 final scores -> confirm even without a stamp tie", () => {
  const out = hybridMatch(
    [
      cand({ id: "a", name: "Card A", similarity: 0.8 }),
      cand({ id: "b", name: "Card B", similarity: 0.79 }),
    ],
    identity({ stamp: null, name: "Unknown" }),
  );
  assert.equal(out.needsConfirmation, true);
  assert.equal(out.reason, CLOSE_MATCH_REASON);
  assert.equal(out.tieDetected, false);
});

// ── single candidate ────────────────────────────────────────────────────────

test("single candidate -> no confirmation (no tie possible)", () => {
  const out = hybridMatch(
    [cand({ id: "svp-44", similarity: 0.97 })],
    identity({ stamp: null }),
  );
  assert.equal(out.ranked.length, 1);
  assert.equal(out.needsConfirmation, false);
  assert.equal(out.reason, null);
});

// ── empty input ─────────────────────────────────────────────────────────────

test("empty candidates -> empty ranked, no confirmation", () => {
  const out = hybridMatch([], identity({ stamp: null }));
  assert.deepEqual(out.ranked, []);
  assert.equal(out.needsConfirmation, false);
  assert.equal(out.reason, null);
});
