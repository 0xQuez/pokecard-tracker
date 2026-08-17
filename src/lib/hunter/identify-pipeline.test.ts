// Unit tests for src/lib/hunter/identify-pipeline.ts (T22.5) — pure, offline.
// Runs under: node --test src/lib/hunter/identify-pipeline.test.ts (Node 22+ type stripping)
import test from "node:test";
import assert from "node:assert/strict";

import {
  runIdentifyPipeline,
  runEmbeddingLookup,
  embeddingToCandidate,
  applyStampTiebreak,
  applyHybridTiebreak,
  decideNeedsConfirmation,
  trimCandidates,
  buildVariantHints,
  stampCategory,
  hasStampConflict,
  hardFilterByVisionName,
  CONFIRMATION_GAP,
  AMBIGUOUS_CANDIDATE_LIMIT,
  CLEAR_CANDIDATE_LIMIT,
  EMBEDDING_CANDIDATE_LIMIT,
  type IdentifyCandidate,
  type ExtractedIdentity,
  type EmbeddingLookupDeps,
} from "./identify-pipeline.ts";
import { HttpError } from "./tcg-match.ts";
import { VisionNotConfigured } from "./vision-identify.ts";
import type { EmbeddingCandidate } from "./embedding-lookup.ts";
import { normalizeName } from "./hybrid-matcher.ts";

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

test("trimCandidates: unambiguous -> 1; ambiguous -> up to 20", () => {
  const list: IdentifyCandidate[] = Array.from({ length: 20 }, (_, i) => ({
    id: String(i + 1),
    name: "A",
    set: { id: "s", name: "S" },
    number: String(i + 1),
    score: 1 - i * 0.01,
    variantHints: [],
  }));
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
  assert.ok(out.candidates.length >= 2 && out.candidates.length <= AMBIGUOUS_CANDIDATE_LIMIT);
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

// ── embeddingToCandidate / runEmbeddingLookup (T23.2) ───────────────────────

function embCand(partial: Partial<EmbeddingCandidate> = {}): EmbeddingCandidate {
  return {
    cardId: "svp-44",
    name: "Charmander",
    setId: "svp",
    setName: "Scarlet & Violet Black Star Promos",
    number: "44",
    imageUrl: "https://images.pokemontcg.io/svp/44.png",
    similarity: 0.9,
    ...partial,
  };
}

test("embeddingToCandidate maps embedding candidate -> IdentifyCandidate", () => {
  const c = embeddingToCandidate(embCand(), charmanderPlain);
  assert.equal(c.id, "svp-44");
  assert.equal(c.name, "Charmander");
  assert.deepEqual(c.set, { id: "svp", name: "Scarlet & Violet Black Star Promos" });
  assert.equal(c.number, "44");
  assert.equal(c.score, 0.9);
  assert.equal(c.imageSmall, "https://images.pokemontcg.io/svp/44.png");
  assert.equal(c.imageLarge, "https://images.pokemontcg.io/svp/44.png");
  // variantHints come from the vision identity (T23.3 needs this).
  assert.deepEqual(c.variantHints, ["Holo"]); // charmanderPlain is variant holo
});

test("runEmbeddingLookup returns ranked candidates via injected nearest", async () => {
  const deps: EmbeddingLookupDeps = {
    client: {} as never,
    embed: async () => new Float32Array(512),
    nearest: async () => [
      embCand({ similarity: 0.9 }),
      embCand({ cardId: "svp-45", number: "45", similarity: 0.8 }),
    ],
    k: 20,
  };
  const out = await runEmbeddingLookup("https://img/x.png", deps, charmanderPlain);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, "svp-44");
  assert.equal(out[0].score, 0.9);
});

test("runEmbeddingLookup returns [] when embedding throws (fallback)", async () => {
  const deps: EmbeddingLookupDeps = {
    client: {} as never,
    embed: async () => {
      throw new Error("model failed to load");
    },
    nearest: async () => [],
  };
  const out = await runEmbeddingLookup("https://img/x.png", deps, charmanderPlain);
  assert.deepEqual(out, []);
});

test("runEmbeddingLookup returns [] when no client (table not configured)", async () => {
  const out = await runEmbeddingLookup("https://img/x.png", {}, charmanderPlain);
  assert.deepEqual(out, []);
});

// ── runIdentifyPipeline embedding path ──────────────────────────────────────

test("pipeline (embedding): populated table -> up to 20 candidates, text skipped", async () => {
  // Candidates DO match the vision name, so the T28.1 name-first fallback must
  // NOT fire — the embedding path is authoritative and returns up to 20.
  const cands = Array.from({ length: 25 }, (_, i) =>
    embCand({ cardId: `c${i}`, name: "Charmander", number: String(i), similarity: 1 - i * 0.01 }),
  );
  const out = await runIdentifyPipeline("https://img/x.png", {
    visionFn: visionReturning(charmanderPlain),
    embedding: {
      client: {} as never,
      embed: async () => new Float32Array(512),
      nearest: async () => cands,
    },
    matchOptions: {
      // If the text matcher were reached, this would blow up the test.
      fetchFn: async () => {
        throw new Error("text matcher must NOT run when embedding path succeeds");
      },
      logger: () => {},
    },
  });
  assert.equal(out.status, "ok");
  if (out.status !== "ok") return;
  assert.equal(out.candidates.length, EMBEDDING_CANDIDATE_LIMIT);
  assert.equal(out.candidates[0].id, "c0");
  assert.equal(out.extracted.name, "Charmander");
});

test("pipeline (embedding): svp-44 photo returns svp-44 rank 1 by similarity", async () => {
  const out = await runIdentifyPipeline("https://images.pokemontcg.io/svp/44.png", {
    visionFn: visionReturning(charmanderPlain),
    embedding: {
      client: {} as never,
      embed: async () => new Float32Array(512),
      nearest: async () => [
        embCand({ similarity: 0.94 }),
        embCand({ cardId: "det1-4", name: "Detective Pikachu's Charmander", setName: "Detective Pikachu", number: "4", similarity: 0.88 }),
        embCand({ cardId: "base1-46", name: "Charmander", number: "46", similarity: 0.87 }),
      ],
    },
  });
  assert.equal(out.status, "ok");
  if (out.status !== "ok") return;
  assert.equal(out.candidates[0].id, "svp-44");
});

test("pipeline (embedding): artwork-misleading — vision attributes correct the ranking", async () => {
  // Same/similar art, different set: the impostor's art similarity is HIGHER
  // than the true card's, so a pure artwork ranking would pick it. The vision
  // reading (name + set + number) must correct the ranking to the true card.
  const out = await runIdentifyPipeline("https://images.pokemontcg.io/det1/4.png", {
    visionFn: visionReturning(charmanderPlain), // name "Charmander", num 44, set SVP
    embedding: {
      client: {} as never,
      embed: async () => new Float32Array(512),
      nearest: async () => [
        // Wrong card, but more art-similar to the photo.
        embCand({
          cardId: "det1-4",
          name: "Detective Pikachu's Charmander",
          setId: "det1",
          setName: "Detective Pikachu",
          number: "4",
          similarity: 0.95,
        }),
        // True card, slightly lower art similarity.
        embCand({ cardId: "svp-44", name: "Charmander", number: "44", similarity: 0.9 }),
      ],
    },
  });
  assert.equal(out.status, "ok");
  if (out.status !== "ok") return;
  // The vision identity corrected the artwork ranking.
  assert.equal(out.candidates[0].id, "svp-44");
  assert.equal(out.candidates[0].name, "Charmander");
  // Clear identity winner -> no spurious confirmation from the impostor's art sim.
  assert.equal(out.needsConfirmation, false);
  assert.equal(out.confirmationReason, null);
  // Unambiguous -> trimmed to the single clear match (auto-advance path).
  assert.equal(out.candidates.length, CLEAR_CANDIDATE_LIMIT);
});

test("pipeline (embedding): none match vision name -> name-first re-query returns only matching candidates (T28.1)", async () => {
  // The top-20 artwork-embedding candidates are ALL Slugma — a similar-art
  // impostor that dominated the art ranking — and NONE match the vision name
  // "Onix". T28.1: the pipeline must NOT trust that mismatched artwork; it
  // re-queries the catalog BY NAME and returns only the Onix prints.
  let textQueryRan = false;
  const out = await runIdentifyPipeline("https://images.pokemontcg.io/base1/56.png", {
    visionFn: visionReturning({
      name: "Onix",
      setName: "",
      setCode: null,
      collectorNumber: "",
      variant: null,
      print: null,
      stamp: null,
      confidence: 0.85,
    }),
    embedding: {
      client: {} as never,
      embed: async () => new Float32Array(512),
      nearest: async () => [
        embCand({ cardId: "neo1-61", name: "Slugma", setName: "Neo Genesis", number: "61", similarity: 0.96 }),
        embCand({ cardId: "neo1-62", name: "Slugma", setName: "Neo Genesis", number: "62", similarity: 0.94 }),
      ],
    },
    matchOptions: {
      fetchFn: async () => {
        textQueryRan = true;
        return {
          data: [
            { id: "base1-56", name: "Onix", number: "56", set: { id: "base1", name: "Base Set" }, images: { small: "https://images.pokemontcg.io/base1/56.png" } },
            { id: "ex-61", name: "Onix", number: "61", set: { id: "ex", name: "Expedition" }, images: { small: "https://images.pokemontcg.io/ex/61.png" } },
          ],
        };
      },
      logger: () => {},
    },
  });
  assert.equal(out.status, "ok");
  if (out.status !== "ok") return;
  // The name query ran, and the result is the Onix prints — never Slugma.
  assert.equal(textQueryRan, true);
  assert.ok(out.candidates.length >= 1);
  assert.ok(out.candidates.every((c) => c.name === "Onix"), "every candidate must be name-matching Onix");
  assert.equal(out.candidates[0].id, "base1-56");
  // Multiple same-name prints -> the user must confirm which variant/print.
  assert.equal(out.needsConfirmation, true);
});

// ── T28.1 name-first fallback: containment rule + activation coverage ──────
//
// DECISION (T28.2): the name match that gates the name-first fallback (and the
// T26.5 identity veto) is STRICT EXACT normalized-name equality
// (`normalizeName(candidate) === normalizeName(visionName)`). Containment /
// substring matching is explicitly REJECTED: "Brock's Onix" (Gym Heroes) and
// "Onix EX" are genuinely distinct, differently-valued cards from base "Onix",
// so treating vision "Onix" as matching "Brock's Onix" would resurrect the
// mismatched-name-impostor bug T28.1 was built to eliminate. The tests below
// pin this exact-equality rule.

test("T28.1 containment rule: name match is strict exact equality (no substring/containment)", () => {
  // Exact same-name match -> equal.
  assert.equal(normalizeName("Makuhita"), normalizeName("Makuhita"));
  // Containment (vision name is a substring of candidate name) -> NOT a match.
  assert.notEqual(normalizeName("Onix"), normalizeName("Brock's Onix"));
  // Reverse containment (candidate name is a substring of vision name) -> NOT a match.
  assert.notEqual(normalizeName("Brock's Onix"), normalizeName("Onix"));
  // Partial-word suffix ("Onix EX") -> NOT a match under strict equality.
  assert.notEqual(normalizeName("Onix"), normalizeName("Onix EX"));
});

test("pipeline (T28.1): Makuhita — no embedding name match (Numel/Eevee/Ampharos/Stunfisk) -> name-first re-query returns only Makuhita", async () => {
  const impostors = [
    embCand({ cardId: "ex1-80", name: "Numel", setId: "ex1", setName: "Ruby & Sapphire", number: "80", similarity: 0.96 }),
    embCand({ cardId: "base1-58", name: "Eevee", setId: "base1", setName: "Base Set", number: "58", similarity: 0.94 }),
    embCand({ cardId: "ex1-24", name: "Ampharos", setId: "ex1", setName: "Ruby & Sapphire", number: "24", similarity: 0.92 }),
    embCand({ cardId: "ex3-59", name: "Stunfisk", setId: "ex3", setName: "Dragon", number: "59", similarity: 0.9 }),
  ];
  let textQueryRan = false;
  const out = await runIdentifyPipeline("https://images.pokemontcg.io/ex7/61.png", {
    visionFn: visionReturning({
      name: "Makuhita",
      setName: "",
      setCode: null,
      collectorNumber: "",
      variant: null,
      print: null,
      stamp: null,
      confidence: 0.85,
    }),
    embedding: { client: {} as never, embed: async () => new Float32Array(512), nearest: async () => impostors },
    matchOptions: {
      fetchFn: async () => {
        textQueryRan = true;
        return {
          data: [
            { id: "ex7-61", name: "Makuhita", number: "61", set: { id: "ex7", name: "Crystal Guardians" }, images: { small: "https://images.pokemontcg.io/ex7/61.png", large: "https://images.pokemontcg.io/ex7/61_hires.png" } },
            { id: "ex10-58", name: "Makuhita", number: "58", set: { id: "ex10", name: "Unseen Forces" }, images: { small: "https://images.pokemontcg.io/ex10/58.png", large: "https://images.pokemontcg.io/ex10/58_hires.png" } },
            { id: "ex9-66", name: "Makuhita", number: "66", set: { id: "ex9", name: "Emerald" }, images: { small: "https://images.pokemontcg.io/ex9/66.png", large: "https://images.pokemontcg.io/ex9/66_hires.png" } },
          ],
        };
      },
      logger: () => {},
    },
  });
  assert.equal(out.status, "ok");
  if (out.status !== "ok") return;
  assert.equal(textQueryRan, true, "name-first fallback must re-query the catalog by name");
  assert.ok(out.candidates.length >= 1);
  assert.ok(
    out.candidates.every((c) => c.name === "Makuhita"),
    "every candidate must be exactly 'Makuhita' — no impostor",
  );
  // Multiple same-name prints -> user must confirm the variant/print.
  assert.equal(out.needsConfirmation, true);
});

test("pipeline (T28.1): Onix — no embedding name match (Slugma/Lickitung/Celebi/Milotic/Zubat) -> returns only Onix", async () => {
  const impostors = [
    embCand({ cardId: "neo1-61", name: "Slugma", setId: "neo1", setName: "Neo Genesis", number: "61", similarity: 0.96 }),
    embCand({ cardId: "base1-57", name: "Lickitung", setId: "base1", setName: "Base Set", number: "57", similarity: 0.94 }),
    embCand({ cardId: "neo3-6", name: "Celebi", setId: "neo3", setName: "Neo Revelation", number: "6", similarity: 0.93 }),
    embCand({ cardId: "ex10-58", name: "Milotic", setId: "ex10", setName: "Unseen Forces", number: "58", similarity: 0.91 }),
    embCand({ cardId: "base1-63", name: "Zubat", setId: "base1", setName: "Base Set", number: "63", similarity: 0.9 }),
  ];
  let textQueryRan = false;
  const out = await runIdentifyPipeline("https://images.pokemontcg.io/base1/56.png", {
    visionFn: visionReturning({
      name: "Onix",
      setName: "",
      setCode: null,
      collectorNumber: "",
      variant: null,
      print: null,
      stamp: null,
      confidence: 0.85,
    }),
    embedding: { client: {} as never, embed: async () => new Float32Array(512), nearest: async () => impostors },
    matchOptions: {
      fetchFn: async () => {
        textQueryRan = true;
        return {
          data: [
            { id: "base1-56", name: "Onix", number: "56", set: { id: "base1", name: "Base Set" }, images: { small: "https://images.pokemontcg.io/base1/56.png", large: "https://images.pokemontcg.io/base1/56_hires.png" } },
            { id: "ex-61", name: "Onix", number: "61", set: { id: "ex", name: "Expedition" }, images: { small: "https://images.pokemontcg.io/ex/61.png", large: "https://images.pokemontcg.io/ex/61_hires.png" } },
          ],
        };
      },
      logger: () => {},
    },
  });
  assert.equal(out.status, "ok");
  if (out.status !== "ok") return;
  assert.equal(textQueryRan, true);
  assert.ok(out.candidates.length >= 1);
  assert.ok(out.candidates.every((c) => c.name === "Onix"), "every candidate must be exactly 'Onix'");
});

test("pipeline (T28.1): embedding HAS a name match -> fallback does NOT fire (identity veto handles it)", async () => {
  // Impostor has HIGHER art similarity, but a real Charmander is present in the
  // candidates -> the identity veto ranks the true card first AND the name-first
  // fallback must NOT re-query the catalog (that would be redundant).
  const out = await runIdentifyPipeline("https://images.pokemontcg.io/svp/44.png", {
    visionFn: visionReturning(charmanderPlain),
    embedding: {
      client: {} as never,
      embed: async () => new Float32Array(512),
      nearest: async () => [
        embCand({ cardId: "det1-4", name: "Detective Pikachu's Charmander", setId: "det1", setName: "Detective Pikachu", number: "4", similarity: 0.97 }),
        embCand({ cardId: "svp-44", name: "Charmander", number: "44", similarity: 0.9 }),
      ],
    },
    matchOptions: {
      // If the name-first fallback (or any text path) ran, this would blow up the test.
      fetchFn: async () => {
        throw new Error("text matcher must NOT run when an embedding candidate matches the vision name");
      },
      logger: () => {},
    },
  });
  assert.equal(out.status, "ok");
  if (out.status !== "ok") return;
  assert.equal(out.candidates[0].id, "svp-44", "identity veto picks the name-matching Charmander");
  assert.equal(out.candidates[0].name, "Charmander");
  assert.equal(out.needsConfirmation, false);
});

test("pipeline (T28.1): empty embedding table -> full-identity text fallback (NOT name-first)", async () => {
  // When embedding returns [], the pipeline falls through to the T22.4 text
  // matcher with the FULL identity (set + number), not the name-only query the
  // name-first fallback uses. Assert on the URL to prove which path ran.
  let seenUrl = "";
  const out = await runIdentifyPipeline("https://img/x.png", {
    visionFn: visionReturning(charmanderPlain),
    embedding: { client: {} as never, embed: async () => new Float32Array(512), nearest: async () => [] },
    matchOptions: {
      fetchFn: async (url: string) => {
        seenUrl = url;
        return { data: [svp44Raw] };
      },
      logger: () => {},
    },
  });
  assert.equal(out.status, "ok");
  if (out.status !== "ok") return;
  assert.ok(
    decodeURIComponent(seenUrl).includes("set.id:svp"),
    "text fallback must carry the full identity (set code)",
  );
  assert.equal(out.candidates[0].id, "svp-44");
});

test("pipeline (T28.1): containment does NOT create a false match — Brock's Onix / Onix EX still trigger fallback", async () => {
  // Vision reads "Onix". The embedding candidates are "Brock's Onix" and "Onix EX"
  // — neither equals "Onix" under strict equality, so the fallback re-queries by
  // name and presents only exact "Onix" prints. The distinct cards are never
  // surfaced as if they were the base Onix.
  let textQueryRan = false;
  const out = await runIdentifyPipeline("https://images.pokemontcg.io/gym2/13.png", {
    visionFn: visionReturning({
      name: "Onix",
      setName: "",
      setCode: null,
      collectorNumber: "",
      variant: null,
      print: null,
      stamp: null,
      confidence: 0.85,
    }),
    embedding: {
      client: {} as never,
      embed: async () => new Float32Array(512),
      nearest: async () => [
        embCand({ cardId: "gym2-13", name: "Brock's Onix", setId: "gym2", setName: "Gym Challenge", number: "13", similarity: 0.98 }),
        embCand({ cardId: "ex15-62", name: "Onix EX", setId: "ex15", setName: "Dragon Frontiers", number: "62", similarity: 0.95 }),
      ],
    },
    matchOptions: {
      fetchFn: async () => {
        textQueryRan = true;
        return {
          data: [
            { id: "base1-56", name: "Onix", number: "56", set: { id: "base1", name: "Base Set" }, images: { small: "https://images.pokemontcg.io/base1/56.png" } },
          ],
        };
      },
      logger: () => {},
    },
  });
  assert.equal(out.status, "ok");
  if (out.status !== "ok") return;
  assert.equal(textQueryRan, true, "containment must NOT suppress the fallback");
  assert.ok(out.candidates.length >= 1);
  assert.ok(out.candidates.every((c) => c.name === "Onix"), "no Brock's Onix / Onix EX surfaced as Onix");
});

test("pipeline (T28.1): name-first with single clear match -> needsConfirmation false", async () => {
  // The name re-query returns exactly one print -> unambiguous, no confirmation.
  const out = await runIdentifyPipeline("https://images.pokemontcg.io/ex7/61.png", {
    visionFn: visionReturning({
      name: "Makuhita",
      setName: "",
      setCode: null,
      collectorNumber: "",
      variant: null,
      print: null,
      stamp: null,
      confidence: 0.85,
    }),
    embedding: { client: {} as never, embed: async () => new Float32Array(512), nearest: async () => [
      embCand({ cardId: "ex1-80", name: "Numel", setId: "ex1", setName: "Ruby & Sapphire", number: "80", similarity: 0.96 }),
    ] },
    matchOptions: {
      fetchFn: async () => ({
        data: [
          { id: "ex7-61", name: "Makuhita", number: "61", set: { id: "ex7", name: "Crystal Guardians" }, images: { small: "https://images.pokemontcg.io/ex7/61.png", large: "https://images.pokemontcg.io/ex7/61_hires.png" } },
        ],
      }),
      logger: () => {},
    },
  });
  assert.equal(out.status, "ok");
  if (out.status !== "ok") return;
  assert.equal(out.needsConfirmation, false);
  assert.equal(out.candidates.length, CLEAR_CANDIDATE_LIMIT);
  assert.equal(out.candidates[0].name, "Makuhita");
});

test("pipeline (T28.1): name-first candidates carry valid 0..1 scores and images", async () => {
  const out = await runIdentifyPipeline("https://images.pokemontcg.io/base1/56.png", {
    visionFn: visionReturning({
      name: "Onix",
      setName: "",
      setCode: null,
      collectorNumber: "",
      variant: null,
      print: null,
      stamp: null,
      confidence: 0.85,
    }),
    embedding: { client: {} as never, embed: async () => new Float32Array(512), nearest: async () => [
      embCand({ cardId: "neo1-61", name: "Slugma", setId: "neo1", setName: "Neo Genesis", number: "61", similarity: 0.96 }),
    ] },
    matchOptions: {
      fetchFn: async () => ({
        data: [
          { id: "base1-56", name: "Onix", number: "56", set: { id: "base1", name: "Base Set" }, images: { small: "https://images.pokemontcg.io/base1/56.png", large: "https://images.pokemontcg.io/base1/56_hires.png" } },
        ],
      }),
      logger: () => {},
    },
  });
  assert.equal(out.status, "ok");
  if (out.status !== "ok") return;
  assert.ok(out.candidates.length >= 1);
  for (const c of out.candidates) {
    assert.ok(typeof c.score === "number" && c.score >= 0 && c.score <= 1, `score ${c.score} must be within 0..1`);
    assert.ok(c.imageSmall && c.imageSmall.length > 0, "name-first candidate must carry an image");
  }
});

test("applyHybridTiebreak: identity boost + set/number refinement apply to name-fallback candidates", () => {
  // Both candidates match the vision name (they came from the name-first re-query),
  // so the identity boost applies to both; the one whose set/number also matches
  // the vision reading gets the extra SET_NUMBER_MATCH_BONUS and ranks first even
  // with identical artwork similarity.
  const identity = { ...charmanderPlain, name: "Makuhita", setCode: "ex7", collectorNumber: "61", stamp: null };
  const out = applyHybridTiebreak(
    [
      { id: "ex10-58", name: "Makuhita", set: { id: "ex10", name: "Unseen Forces" }, number: "58", score: 0.78, imageSmall: "https://images.pokemontcg.io/ex10/58.png", imageLarge: "https://images.pokemontcg.io/ex10/58_hires.png", variantHints: [] },
      { id: "ex7-61", name: "Makuhita", set: { id: "ex7", name: "Crystal Guardians" }, number: "61", score: 0.78, imageSmall: "https://images.pokemontcg.io/ex7/61.png", imageLarge: "https://images.pokemontcg.io/ex7/61_hires.png", variantHints: [] },
    ],
    identity,
  );
  assert.equal(out.candidates[0].id, "ex7-61", "set/number match must refine same-name prints");
  assert.ok(out.candidates[0].score > out.candidates[1].score, "identity boost must give the refined candidate a higher score");
  // Scores clamped into 0..1 for the UI contract.
  for (const c of out.candidates) assert.ok(c.score >= 0 && c.score <= 1);
});

test("pipeline (embedding): empty table falls back to text matcher", async () => {
  let textMatchRan = false;
  const out = await runIdentifyPipeline("https://img/x.png", {
    visionFn: visionReturning(charmanderPlain),
    embedding: {
      client: {} as never,
      embed: async () => new Float32Array(512),
      nearest: async () => [],
    },
    matchOptions: {
      fetchFn: async () => {
        textMatchRan = true;
        return { data: [svp44Raw] };
      },
      logger: () => {},
    },
  });
  assert.equal(out.status, "ok");
  if (out.status !== "ok") return;
  assert.equal(textMatchRan, true);
  assert.equal(out.candidates[0].id, "svp-44");
});

// ── hybrid matcher wiring (T23.3) ─────────────────────────────────────────

test("applyHybridTiebreak: same-art stamp tie -> grouped + needsConfirmation", () => {
  const out = applyHybridTiebreak(
    [
      embeddingToCandidate(embCand({ similarity: 0.94 }), charmanderPC),
      embeddingToCandidate(
        embCand({ cardId: "svp-44b", similarity: 0.93 }),
        charmanderPC,
      ),
    ],
    charmanderPC,
  );
  assert.equal(out.needsConfirmation, true);
  assert.ok(out.confirmationReason);
  // Both retained (never collapse an ambiguous tie to a single candidate).
  assert.equal(out.candidates.length, 2);
  // Hybrid order: the higher-similarity one stays first (no distinguishing
  // metadata in the catalog, so no bonus — same-art group preserved).
  assert.equal(out.candidates[0].id, "svp-44");
});

test("applyHybridTiebreak: distinct art -> unambiguous single winner", () => {
  const out = applyHybridTiebreak(
    [
      embeddingToCandidate(embCand({ similarity: 0.99 }), charmanderPlain),
      embeddingToCandidate(
        embCand({ cardId: "det1-4", name: "Detective Pikachu's Charmander", similarity: 0.7 }),
        charmanderPlain,
      ),
    ],
    charmanderPlain,
  );
  assert.equal(out.needsConfirmation, false);
  assert.equal(out.confirmationReason, null);
  assert.equal(out.candidates[0].id, "svp-44");
});

test("pipeline (embedding): PC-stamped same-art tie -> confirm + reason surfaced", async () => {
  const out = await runIdentifyPipeline("https://images.pokemontcg.io/svp/44.png", {
    visionFn: visionReturning(charmanderPC),
    embedding: {
      client: {} as never,
      embed: async () => new Float32Array(512),
      nearest: async () => [
        embCand({ similarity: 0.94 }),
        embCand({ cardId: "svp-44b", similarity: 0.93 }),
      ],
    },
  });
  assert.equal(out.status, "ok");
  if (out.status !== "ok") return;
  assert.equal(out.needsConfirmation, true);
  assert.ok(out.confirmationReason && out.confirmationReason.includes("variant"));
  // Both same-art candidates kept for the user to pick the actual print.
  assert.ok(out.candidates.length >= 2);
});

test("pipeline (embedding): clear-cut -> needsConfirmation false, single candidate", async () => {
  const out = await runIdentifyPipeline("https://images.pokemontcg.io/svp/44.png", {
    visionFn: visionReturning(charmanderPlain),
    embedding: {
      client: {} as never,
      embed: async () => new Float32Array(512),
      nearest: async () => [
        embCand({ similarity: 0.99 }),
        embCand({ cardId: "det1-4", name: "Detective Pikachu's Charmander", similarity: 0.7 }),
      ],
    },
  });
  assert.equal(out.status, "ok");
  if (out.status !== "ok") return;
  assert.equal(out.needsConfirmation, false);
  assert.equal(out.confirmationReason, null);
  assert.equal(out.candidates.length, CLEAR_CANDIDATE_LIMIT);
  assert.equal(out.candidates[0].id, "svp-44");
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

// ── T29 hard name filter ─────────────────────────────────────────────────────
//
// T29.1: `hardFilterByVisionName` keeps ONLY candidates whose normalized name
// EXACTLY equals the normalized vision name. This closes the user-reported
// Psyduck bug where a scan surfaced 2 Psyduck + Jolteon + "Sabrina's Psyduck" +
// 16 other cards in the picker. The rule is strict equality AFTER
// normalizeName() — NOT substring/containment — so "Brock's Onix" and
// "Sabrina's Psyduck" are deliberately dropped (an apostrophe collapsing to a
// space does not rescue a possessive card). The tests below pin this rule and
// prove the impostor scenario can never regress.

/** A plain identity with a given vision name (and no set/number refinement). */
function idWithName(name: string | null): ExtractedIdentity {
  return {
    name: name ?? "",
    setName: "",
    setCode: null,
    collectorNumber: "",
    variant: null,
    print: null,
    stamp: null,
    confidence: 0.9,
  };
}

/** A full-ish vision identity reading a Psyduck. */
const psyduckIdentity: ExtractedIdentity = idWithName("Psyduck");

/** A bare IdentifyCandidate factory (distinct ids so hybrid matching never dedupes). */
function cand(name: string, id: string): IdentifyCandidate {
  return {
    id,
    name,
    set: { id: "base1", name: "Base Set" },
    number: "1",
    score: 0.9,
    variantHints: [],
  };
}

test("T29 hardFilterByVisionName: empty vision name -> candidates unchanged (no filter)", () => {
  const cands = [cand("Psyduck", "p1"), cand("Jolteon", "j1")];
  assert.equal(hardFilterByVisionName(cands, idWithName("")), cands, "empty name returns the same array");
  assert.equal(
    hardFilterByVisionName(cands, { name: null } as unknown as ExtractedIdentity),
    cands,
    "null name returns the same array",
  );
});

test("T29 hardFilterByVisionName: exact matches only — keeps the 2 Psyducks, drops Jolteon + Sabrina's Psyduck", () => {
  const out = hardFilterByVisionName(
    [
      cand("Psyduck", "p1"),
      cand("Jolteon", "j1"),
      cand("Sabrina's Psyduck", "g2-32"),
      cand("Psyduck", "p2"),
    ],
    idWithName("Psyduck"),
  );
  assert.equal(out.length, 2);
  assert.ok(out.every((c) => c.name === "Psyduck"));
  assert.deepEqual(out.map((c) => c.id).sort(), ["p1", "p2"]);
});

test("T29 hardFilterByVisionName: case/punct normalization — PSYDUCK matches Psyduck", () => {
  const out = hardFilterByVisionName([cand("Psyduck", "p1")], idWithName("PSYDUCK"));
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "Psyduck");
});

test("T29 hardFilterByVisionName: Brock's Onix does NOT match vision Onix (T28.2 containment rule)", () => {
  assert.equal(hardFilterByVisionName([cand("Brock's Onix", "g2-13")], idWithName("Onix")).length, 0);
});

test("T29 hardFilterByVisionName: Sabrina's Psyduck does NOT match vision Psyduck", () => {
  assert.equal(hardFilterByVisionName([cand("Sabrina's Psyduck", "g2-32")], idWithName("Psyduck")).length, 0);
});

test("T29 pipeline: Psyduck impostor scenario — only exact-name Psyducks survive, no name-first fallback, confirmation needed", async () => {
  // User-reported repro: 2 exact-name Psyduck + Jolteon + Sabrina's Psyduck +
  // 16 other distinct Pokemon names (20 embedding candidates total).
  const impostorNames = [
    "Jolteon",
    "Sabrina's Psyduck",
    "Pikachu", "Raichu", "Pidgey", "Rattata", "Meowth", "Mankey",
    "Growlithe", "Poliwag", "Machop", "Bellsprout", "Tentacool",
    "Geodude", "Ponyta", "Slowpoke", "Magnemite", "Farfetchd",
  ]; // 18 impostors (Jolteon + Sabrina's Psyduck + 16 others)
  const embedding: EmbeddingCandidate[] = [
    embCand({ cardId: "base1-70", name: "Psyduck", setId: "base1", setName: "Base Set", number: "70", similarity: 0.9 }),
    embCand({ cardId: "ex2-48", name: "Psyduck", setId: "ex2", setName: "Sandstorm", number: "48", similarity: 0.89 }),
    ...impostorNames.map((n, i) =>
      embCand({ cardId: `imp${i}`, name: n, setId: "base1", setName: "Base Set", number: String(i), similarity: 0.99 - i * 0.01 }),
    ),
  ];
  assert.equal(embedding.length, 20, "2 Psyduck + 18 impostor embedding candidates");

  const out = await runIdentifyPipeline("https://images.pokemontcg.io/base1/70.png", {
    visionFn: visionReturning(psyduckIdentity),
    embedding: {
      client: {} as never,
      embed: async () => new Float32Array(512),
      nearest: async () => embedding,
    },
    matchOptions: {
      // If the name-first fallback (or any text path) ran, this blows up the test.
      fetchFn: async () => {
        throw new Error("name-first fallback must NOT fire when exact Psyducks survive the filter");
      },
      logger: () => {},
    },
  });
  assert.equal(out.status, "ok");
  if (out.status !== "ok") return;
  assert.equal(out.candidates.length, 2, "only the 2 exact-name Psyducks survive");
  assert.ok(out.candidates.every((c) => c.name === "Psyduck"), "every candidate is exactly 'Psyduck'");
  assert.ok(
    out.candidates.every((c) => c.name !== "Jolteon" && c.name !== "Sabrina's Psyduck"),
    "neither Jolteon nor Sabrina's Psyduck appears anywhere",
  );
  // 2 same-name Psyducks is a variant tie -> the picker must ask which print.
  assert.equal(out.needsConfirmation, true);
});

test("T29 pipeline: embedding list has zero exact-Psyduck survivors -> T28.1 name-first fallback returns name-query Psyduck prints", async () => {
  // Embedding returns 20 candidates ALL with different names (none is Psyduck),
  // so the name filter (and the T28.1 gate) empties the art list -> re-query by
  // name and present ONLY the name-matching Psyduck prints.
  const distinct = [
    "Pikachu", "Raichu", "Sandshrew", "Nidoran", "Clefairy", "Vulpix",
    "Jigglypuff", "Zubat", "Oddish", "Paras", "Venonat", "Diglett",
    "Meowth", "Mankey", "Growlithe", "Poliwag", "Abra", "Machop",
    "Bellsprout", "Tentacool",
  ]; // 20 distinct, none "Psyduck"
  let seenUrl = "";
  const out = await runIdentifyPipeline("https://images.pokemontcg.io/base1/70.png", {
    visionFn: visionReturning(psyduckIdentity),
    embedding: {
      client: {} as never,
      embed: async () => new Float32Array(512),
      nearest: async () =>
        distinct.map((n, i) =>
          embCand({ cardId: `x${i}`, name: n, setId: "base1", setName: "Base Set", number: String(i), similarity: 1 - i * 0.01 }),
        ),
    },
    matchOptions: {
      fetchFn: async (url: string) => {
        seenUrl = url;
        return {
          data: [
            { id: "base1-70", name: "Psyduck", number: "70", set: { id: "base1", name: "Base Set" }, images: { small: "https://images.pokemontcg.io/base1/70.png", large: "https://images.pokemontcg.io/base1/70_hires.png" } },
            { id: "ex2-48", name: "Psyduck", number: "48", set: { id: "ex2", name: "Sandstorm" }, images: { small: "https://images.pokemontcg.io/ex2/48.png", large: "https://images.pokemontcg.io/ex2/48_hires.png" } },
          ],
        };
      },
      logger: () => {},
    },
  });
  assert.equal(out.status, "ok");
  if (out.status !== "ok") return;
  assert.ok(
    decodeURIComponent(seenUrl).includes('name:"psyduck"'),
    "name-first fallback must re-query the catalog by name only",
  );
  assert.ok(out.candidates.length >= 1);
  assert.ok(out.candidates.every((c) => c.name === "Psyduck"), "name-query result is only Psyduck prints");
});

test("T29 pipeline: text path — a Jolteon leaked into the name-query results is hard-filtered out", async () => {
  // Empty embedding table. Stub the pokemontcg fetch to return a Jolteon among
  // Psyduck results (simulating a catalog bug or future matcher change). The
  // T29.1 defensive filter on the text path must drop the Jolteon.
  const out = await runIdentifyPipeline("https://img/x.png", {
    visionFn: visionReturning(psyduckIdentity),
    embedding: { client: {} as never, embed: async () => new Float32Array(512), nearest: async () => [] },
    matchOptions: {
      fetchFn: async () => ({
        data: [
          { id: "base1-70", name: "Psyduck", number: "70", set: { id: "base1", name: "Base Set" }, images: { small: "https://images.pokemontcg.io/base1/70.png" } },
          { id: "base1-58", name: "Jolteon", number: "58", set: { id: "base1", name: "Base Set" }, images: { small: "https://images.pokemontcg.io/base1/58.png" } },
          { id: "ex2-48", name: "Psyduck", number: "48", set: { id: "ex2", name: "Sandstorm" }, images: { small: "https://images.pokemontcg.io/ex2/48.png" } },
        ],
      }),
      logger: () => {},
    },
  });
  assert.equal(out.status, "ok");
  if (out.status !== "ok") return;
  assert.ok(out.candidates.length >= 1);
  assert.ok(
    out.candidates.every((c) => c.name === "Psyduck"),
    "final candidates contain ONLY Psyduck — the Jolteon is filtered out",
  );
});

test("T29 pipeline: show-more (top-20) — 25 Psyduck prints + 5 interleaved impostors -> exactly 20 Psyducks, zero impostors", async () => {
  const embedding: EmbeddingCandidate[] = [];
  for (let i = 0; i < 30; i++) {
    const isImpostor = i === 3 || i === 8 || i === 13 || i === 18 || i === 23;
    if (isImpostor) {
      // Impostors carry HIGHER art similarity so they would rank in the top-20
      // on artwork alone — the name filter must still strip them.
      embedding.push(embCand({ cardId: `imp${i}`, name: "Jolteon", setId: "base1", setName: "Base Set", number: String(i), similarity: 0.99 }));
    } else {
      embedding.push(embCand({ cardId: `ps${i}`, name: "Psyduck", setId: "base1", setName: "Base Set", number: String(i), similarity: 0.9 - (i % 25) * 0.001 }));
    }
  }
  const out = await runIdentifyPipeline("https://images.pokemontcg.io/base1/70.png", {
    visionFn: visionReturning(psyduckIdentity),
    embedding: {
      client: {} as never,
      embed: async () => new Float32Array(512),
      nearest: async () => embedding,
      k: 30, // let all 30 through so filtering is exercised against impostors inside the top-20 window
    },
    matchOptions: {
      fetchFn: async () => {
        throw new Error("name query must NOT fire when Psyducks survive the filter");
      },
      logger: () => {},
    },
  });
  assert.equal(out.status, "ok");
  if (out.status !== "ok") return;
  assert.equal(out.candidates.length, AMBIGUOUS_CANDIDATE_LIMIT, "cap at 20");
  assert.ok(out.candidates.every((c) => c.name === "Psyduck"), "all 20 are Psyduck");
  assert.ok(out.candidates.every((c) => c.name !== "Jolteon"), "zero impostors in the top-20");
});

test("T29 pipeline: unusable (empty) vision name -> candidates pass through unfiltered", async () => {
  // A collector number is present so the scan is not "unreadable", but the name
  // is unusable — the artwork-similarity behavior must be preserved unchanged
  // (no name filter, no name-first fallback).
  const emptyNameIdentity: ExtractedIdentity = {
    ...psyduckIdentity,
    name: "",
    collectorNumber: "44",
    confidence: 0.5,
  };
  const out = await runIdentifyPipeline("https://img/x.png", {
    visionFn: visionReturning(emptyNameIdentity),
    embedding: {
      client: {} as never,
      embed: async () => new Float32Array(512),
      nearest: async () => [
        embCand({ cardId: "base1-70", name: "Psyduck", setId: "base1", setName: "Base Set", number: "70", similarity: 0.95 }),
        embCand({ cardId: "base1-58", name: "Jolteon", setId: "base1", setName: "Base Set", number: "58", similarity: 0.94 }),
        embCand({ cardId: "gym2-32", name: "Sabrina's Psyduck", setId: "gym2", setName: "Gym Challenge", number: "32", similarity: 0.93 }),
      ],
    },
    matchOptions: {
      fetchFn: async () => {
        throw new Error("no name -> must not re-query the catalog");
      },
      logger: () => {},
    },
  });
  assert.equal(out.status, "ok");
  if (out.status !== "ok") return;
  const names = out.candidates.map((c) => c.name);
  assert.ok(names.includes("Psyduck"), "Psyduck passes through");
  assert.ok(names.includes("Jolteon"), "Jolteon passes through (no name filter)");
  assert.ok(names.includes("Sabrina's Psyduck"), "Sabrina's Psyduck passes through (no name filter)");
});
