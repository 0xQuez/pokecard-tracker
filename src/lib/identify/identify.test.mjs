// Unit tests for src/lib/identify/* — T20 vision card identification.
// Runs offline: vision parsing is fed canned model text; matching uses a
// fixture catalog (no network). Mirrors the card-identity.test.mjs pattern.
import test from "node:test";
import assert from "node:assert/strict";

import {
  parseVisionText,
  buildVisionPrompt,
  extractCardFeatures,
} from "./card-vision.js";
import {
  matchCardIdentity,
  scoreCatalogCard,
  applyStampTiebreak,
} from "./identity-matcher.js";
import { fetchWithRetry } from "./pokemontcg-catalog.js";

// ── Fixture catalog (deterministic, no network) ──────────────────────────────
// Mirrors the real pokemontcg.io records for the acceptance examples.
// svp-44 (Charmander, Scarlet & Violet Black Star Promos) is ONE entry — the
// regular and Pokemon Center Exclusive prints collapse to the same catalog id.
const FIXTURE = {
  // Charmander — Scarlet & Violet Black Star Promos. PC Exclusive shares this id.
  "svp-44": {
    id: "svp-44",
    name: "Charmander",
    number: "44",
    setId: "svp",
    setName: "Scarlet & Violet Black Star Promos",
    ptcgoCode: "PR-SV",
    price: 61.13,
    imageUrl: "https://images.pokemontcg.io/svp/44.png",
    availableVariants: ["holofoil"],
  },
  // Charmander — Obsidian Flames (sv3), a distinct modern print.
  "sv3-26": {
    id: "sv3-26",
    name: "Charmander",
    number: "26",
    setId: "sv3",
    setName: "Obsidian Flames",
    ptcgoCode: null,
    price: 0.5,
    imageUrl: "https://images.pokemontcg.io/sv3/26.png",
    availableVariants: ["normal", "reverseHolofoil"],
  },
  // Charizard — Base Set (vintage prints collapse to one id).
  "base1-4": {
    id: "base1-4",
    name: "Charizard",
    number: "4",
    setId: "base1",
    setName: "Base",
    ptcgoCode: "BASE",
    price: 400,
    imageUrl: "https://images.pokemontcg.io/base1/4.png",
    availableVariants: ["holofoil"],
  },
};

function makeCatalog() {
  return {
    async searchCards(q, limit = 10) {
      const qn = q.name.toLowerCase();
      const results = Object.values(FIXTURE).filter((c) => {
        const nameOk = c.name.toLowerCase().includes(qn) || qn.includes(c.name.toLowerCase());
        const numOk = !q.number || c.number === q.number;
        return nameOk && numOk;
      });
      return results.slice(0, limit);
    },
  };
}

// ── parseVisionText ───────────────────────────────────────────────────────────

test("parseVisionText: strict JSON is parsed", () => {
  const f = parseVisionText(
    '{"name":"Charmander","set":"Scarlet & Violet Black Star Promos","number":"44","variant":"holo","print":null,"stamp":"pokemon-center","confidence":0.9}'
  );
  assert.equal(f.name, "Charmander");
  assert.equal(f.number, "44");
  assert.equal(f.variant, "holo");
  assert.equal(f.stamp, "pokemon-center");
});

test("parseVisionText: strips markdown code fences", () => {
  const f = parseVisionText("```json\n{\"name\":\"Charmander\"}\n```");
  assert.equal(f.name, "Charmander");
});

test("parseVisionText: tolerant fallback pulls key:value from prose", () => {
  const f = parseVisionText(
    'I read the card. name: "Charizard", number: "4", variant: "holo", stamp: null'
  );
  assert.equal(f.name, "Charizard");
  assert.equal(f.number, "4");
  assert.equal(f.variant, "holo");
  assert.equal(f.stamp, null);
});

test("parseVisionText: unreadable fields become null (never crash)", () => {
  const f = parseVisionText("I can't read this card clearly");
  assert.equal(f.name, null);
  assert.equal(f.number, null);
  assert.equal(f.confidence, 0.5);
});

test("parseVisionText: variant synonyms normalize (reverse-holo, regular)", () => {
  assert.equal(parseVisionText('{"variant":"Reverse Holo"}').variant, "reverse-holo");
  assert.equal(parseVisionText('{"variant":"normal"}').variant, "regular");
});

test("buildVisionPrompt: demands stamp field (PC-exclusive tiebreak)", () => {
  const p = buildVisionPrompt();
  assert.ok(p.includes("pokemon-center"));
  assert.ok(p.includes("different product"));
});

// ── extractCardFeatures ───────────────────────────────────────────────────────

test("extractCardFeatures: wires vision fn -> parse", async () => {
  const features = await extractCardFeatures(
    "https://example.com/card.png",
    () => '{"name":"Charmander","number":"44","stamp":"pokemon-center","confidence":0.95}'
  );
  assert.equal(features.name, "Charmander");
  assert.equal(features.stamp, "pokemon-center");
});

// ── scoreCatalogCard ──────────────────────────────────────────────────────────

test("scoreCatalogCard: exact name+number+set scores 1.0", () => {
  const f = {
    name: "Charmander", set: "Scarlet & Violet Black Star Promos", number: "44",
    variant: "holo", print: null, stamp: null, confidence: 0.95,
  };
  assert.equal(scoreCatalogCard(FIXTURE["svp-44"], f), 1);
});

test("scoreCatalogCard: same name, wrong number disqualifies", () => {
  const f = {
    name: "Charmander", set: "Obsidian Flames", number: "26",
    variant: null, print: null, stamp: null, confidence: 0.9,
  };
  // svp-44 has number 44, not 26 -> real-number mismatch returns 0.
  assert.equal(scoreCatalogCard(FIXTURE["svp-44"], f), 0);
  assert.equal(scoreCatalogCard(FIXTURE["sv3-26"], f) > 0, true);
});

// ── applyStampTiebreak (the svp-44 rule) ──────────────────────────────────────

function baseCandidate(over = {}) {
  return {
    name: "Charmander", set: "Scarlet & Violet Black Star Promos", setCode: "PR-SV",
    setId: "svp", cardNumber: "44", variant: "holo", print: null, stamp: null,
    price: 61.13, imageUrl: "https://images.pokemontcg.io/svp/44.png",
    confidence: 0.95, reason: "exact match", synthetic: false, ...over,
  };
}

test("applyStampTiebreak: PC stamp surfaces the exclusive as top candidate", () => {
  const noStamp = applyStampTiebreak({ stamp: null }, baseCandidate());
  assert.equal(noStamp.length, 1);
  assert.equal(noStamp[0].synthetic, false);

  const pc = applyStampTiebreak(
    { stamp: "pokemon-center" },
    baseCandidate()
  );
  assert.equal(pc.length, 2);
  assert.equal(pc[0].synthetic, true);
  assert.equal(pc[0].variant, "pokemon-center-exclusive");
  assert.equal(pc[0].stamp, "pokemon-center");
  assert.ok(pc[0].confidence > pc[1].confidence); // exclusive ranks first
});

// ── matchCardIdentity ─────────────────────────────────────────────────────────

test("matchCardIdentity: regular Charmander photo -> high confidence, no confirmation", async () => {
  const f = {
    name: "Charmander", set: "Scarlet & Violet Black Star Promos", number: "44",
    variant: "holo", print: null, stamp: null, confidence: 0.95,
  };
  const r = await matchCardIdentity(f, makeCatalog());
  assert.equal(r.needsConfirmation, false);
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].name, "Charmander");
  assert.equal(r.candidates[0].synthetic, false);
  assert.equal(r.candidates[0].cardNumber, "44");
});

test("matchCardIdentity: PC stamp photo -> exclusive surfaces top, needs confirmation", async () => {
  const f = {
    name: "Charmander", set: "Scarlet & Violet Black Star Promos", number: "44",
    variant: "holo", print: null, stamp: "pokemon-center", confidence: 0.9,
  };
  const r = await matchCardIdentity(f, makeCatalog());
  assert.equal(r.needsConfirmation, true); // 4x price difference — must ask
  assert.equal(r.candidates.length, 2);
  assert.equal(r.candidates[0].synthetic, true);
  assert.equal(r.candidates[0].variant, "pokemon-center-exclusive");
  assert.equal(r.candidates[1].synthetic, false); // regular still offered
});

test("matchCardIdentity: unreadable photo -> empty + warning, needs confirmation", async () => {
  const r = await matchCardIdentity(
    { name: null, number: null, set: null, variant: null, print: null, stamp: null, confidence: 0.1 },
    makeCatalog()
  );
  assert.equal(r.candidates.length, 0);
  assert.equal(r.needsConfirmation, true);
  assert.ok(r.warning);
});

test("matchCardIdentity: wrong number read -> no match + warning", async () => {
  const f = {
    name: "Charmander", set: "Obsidian Flames", number: "999",
    variant: null, print: null, stamp: null, confidence: 0.8,
  };
  const r = await matchCardIdentity(f, makeCatalog());
  assert.equal(r.candidates.length, 0);
  assert.ok(r.warning);
});

test("matchCardIdentity: same name across sets -> multiple candidates, needs confirmation", async () => {
  const f = {
    name: "Charmander", set: null, number: null,
    variant: null, print: null, stamp: null, confidence: 0.6,
  };
  const r = await matchCardIdentity(f, makeCatalog());
  assert.ok(r.candidates.length >= 2, "both Charmanders should surface");
  assert.equal(r.needsConfirmation, true);
});

// ── fetchWithRetry (backoff) ─────────────────────────────────────────────────

test("fetchWithRetry: retries on 5xx, succeeds once the API recovers", async () => {
  const calls = [];
  const fake = async (url, init) => {
    calls.push(url);
    if (calls.length < 3) {
      return { ok: false, status: 503 };
    }
    return { ok: true, status: 200 };
  };
  // Attempts capped so the test stays fast.
  const res = await fetchWithRetry("https://x", { attempts: 3, baseDelayMs: 1, maxDelayMs: 2 }, undefined, fake);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 3);
});

test("fetchWithRetry: gives up and returns the last 5xx after exhausting attempts", async () => {
  const calls = [];
  const fake = async () => {
    calls.push(1);
    return { ok: false, status: 500 };
  };
  const res = await fetchWithRetry("https://x", { attempts: 2, baseDelayMs: 1, maxDelayMs: 2 }, undefined, fake);
  assert.equal(res.status, 500);
  assert.equal(calls.length, 2);
});

test("fetchWithRetry: returns immediately on a 4xx (no point retrying)", async () => {
  const calls = [];
  const fake = async () => {
    calls.push(1);
    return { ok: false, status: 404 };
  };
  const res = await fetchWithRetry("https://x", { attempts: 4, baseDelayMs: 1, maxDelayMs: 2 }, undefined, fake);
  assert.equal(res.status, 404);
  assert.equal(calls.length, 1);
});
