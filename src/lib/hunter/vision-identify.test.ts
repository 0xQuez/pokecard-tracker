// Unit tests for src/lib/hunter/vision-identify.ts (T22.3) — pure, offline.
// Runs under: node --test src/lib/hunter/vision-identify.test.ts (Node 22+ type stripping)
import test from "node:test";
import assert from "node:assert/strict";

import {
  extractCardIdentity,
  parseVisionText,
  buildVisionPrompt,
  VISION_STRICT_JSON,
  VisionNotConfigured,
  type CardIdentity,
  type CardIdentityResult,
} from "./vision-identify.ts";

// ── parseVisionText ───────────────────────────────────────────────────────────

test("parseVisionText: strict JSON produces a full identity", () => {
  const r = parseVisionText(
    '{"name":"Charmander","setName":"Scarlet & Violet Black Star Promos","setCode":"SVP","collectorNumber":"044/SVP 44","variant":"holo","print":null,"stamp":"Pokemon Center","confidence":0.92}'
  ) as CardIdentity;
  assert.equal(r.name, "Charmander");
  assert.equal(r.setName, "Scarlet & Violet Black Star Promos");
  assert.equal(r.setCode, "SVP");
  assert.equal(r.collectorNumber, "044/SVP 44");
  assert.equal(r.variant, "holo");
  assert.equal(r.print, null);
  assert.equal(r.stamp, "Pokemon Center");
  assert.ok(Math.abs(r.confidence - 0.92) < 1e-9);
});

test("parseVisionText: strips markdown code fences", () => {
  const r = parseVisionText("```json\n{\"name\":\"Pikachu\",\"collectorNumber\":\"25\"}\n```") as CardIdentity;
  assert.equal(r.name, "Pikachu");
  assert.equal(r.collectorNumber, "25");
});

test("parseVisionText: tolerant fallback pulls key:value from prose", () => {
  const r = parseVisionText(
    'I read the card. name: "Charizard", number: "4", variant: "holo", stamp: null'
  ) as CardIdentity;
  assert.equal(r.name, "Charizard");
  assert.equal(r.collectorNumber, "4");
  assert.equal(r.variant, "holo");
  assert.equal(r.stamp, null);
});

test("parseVisionText: unreadable photo -> { error: unreadable }, never a guess", () => {
  const r = parseVisionText("I can't read this card, it's too blurry");
  assert.deepEqual(r, { error: "unreadable" });
});

test("parseVisionText: non-card image (no name, no number) -> unreadable", () => {
  const r = parseVisionText('{"name":null,"collectorNumber":null,"confidence":0.1}');
  assert.deepEqual(r, { error: "unreadable" });
});

test("parseVisionText: variant synonyms normalize", () => {
  assert.equal((parseVisionText('{"name":"X","collectorNumber":"1","variant":"Reverse Holo"}') as CardIdentity).variant, "reverse_holo");
  assert.equal((parseVisionText('{"name":"X","collectorNumber":"1","variant":"normal"}') as CardIdentity).variant, "regular");
  assert.equal((parseVisionText('{"name":"X","collectorNumber":"1","variant":"holofoil"}') as CardIdentity).variant, "holo");
});

test("parseVisionText: print synonyms normalize", () => {
  assert.equal((parseVisionText('{"name":"X","collectorNumber":"1","print":"1st edition"}') as CardIdentity).print, "1st_edition");
  assert.equal((parseVisionText('{"name":"X","collectorNumber":"1","print":"Shadowless"}') as CardIdentity).print, "shadowless");
  assert.equal((parseVisionText('{"name":"X","collectorNumber":"1","print":"unlimited"}') as CardIdentity).print, "unlimited");
  assert.equal((parseVisionText('{"name":"X","collectorNumber":"1","print":null}') as CardIdentity).print, null);
});

test("parseVisionText: stamp passes through (Pokemon Center tiebreaker)", () => {
  assert.equal((parseVisionText('{"name":"X","collectorNumber":"1","stamp":"Pokemon Center"}') as CardIdentity).stamp, "Pokemon Center");
  assert.equal((parseVisionText('{"name":"X","collectorNumber":"1","stamp":"none"}') as CardIdentity).stamp, null);
});

test("parseVisionText: confidence coerced to 0..1, default 0.5", () => {
  assert.equal((parseVisionText('{"name":"X","collectorNumber":"1","confidence":2}') as CardIdentity).confidence, 1);
  assert.equal((parseVisionText('{"name":"X","collectorNumber":"1","confidence":-1}') as CardIdentity).confidence, 0);
  assert.equal((parseVisionText('{"name":"X","collectorNumber":"1"}') as CardIdentity).confidence, 0.5);
  assert.equal((parseVisionText('{"name":"X","collectorNumber":"1","confidence":"0.8"}') as CardIdentity).confidence, 0.8);
});

test("parseVisionText: number alias works for models that use 'number'", () => {
  const r = parseVisionText('{"name":"Charizard","number":"4"}') as CardIdentity;
  assert.equal(r.collectorNumber, "4");
});

test("parseVisionText: model junk (garbage) does not throw", () => {
  const r = parseVisionText("!!! completely unreadable garbage ###");
  assert.deepEqual(r, { error: "unreadable" });
});

// ── buildVisionPrompt ─────────────────────────────────────────────────────────

test("buildVisionPrompt: demands stamp/variant/print tiebreakers", () => {
  const p = buildVisionPrompt();
  assert.ok(p.includes("Pokemon Center"));
  assert.ok(p.includes("collectorNumber"));
  assert.ok(p.includes("reverse_holo"));
  assert.ok(p.includes("1st_edition"));
  assert.ok(p.includes("shadowless"));
  assert.ok(VISION_STRICT_JSON.includes("single JSON object"));
});

// ── extractCardIdentity (injection pattern) ───────────────────────────────────

test("extractCardIdentity: wires vision fn -> parse", async () => {
  const r = await extractCardIdentity(
    "https://example.com/card.png",
    () => '{"name":"Charmander","collectorNumber":"044/SVP 44","stamp":"Pokemon Center","confidence":0.95}'
  ) as CardIdentity;
  assert.equal(r.name, "Charmander");
  assert.equal(r.collectorNumber, "044/SVP 44");
  assert.equal(r.stamp, "Pokemon Center");
});

test("extractCardIdentity: async vision fn supported", async () => {
  const r = await extractCardIdentity(
    "https://example.com/card.png",
    async () => '{"name":"Pikachu","collectorNumber":"25"}'
  ) as CardIdentity;
  assert.equal(r.name, "Pikachu");
});

test("extractCardIdentity: unreadable vision reply -> unreadable result", async () => {
  const r = await extractCardIdentity("https://example.com/blur.png", () => "cannot see the card clearly");
  assert.deepEqual(r, { error: "unreadable" });
});

test("defaultVisionFn: fails loudly when unconfigured", async () => {
  const oldKey = process.env.VISION_API_KEY;
  const oldBase = process.env.VISION_API_BASE_URL;
  delete process.env.VISION_API_KEY;
  try {
    await assert.rejects(() => extractCardIdentity("https://example.com/card.png"), VisionNotConfigured);
  } finally {
    if (oldKey) process.env.VISION_API_KEY = oldKey;
    if (oldBase) process.env.VISION_API_BASE_URL = oldBase;
  }
});

// ── Type-level check (compiles only when the union is correct) ────────────────

function _typeCheck(): CardIdentityResult {
  return { error: "unreadable" };
}
void _typeCheck;
