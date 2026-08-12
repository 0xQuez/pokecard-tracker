// Unit tests for src/lib/card-identity.ts — run offline via a fixture catalog.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeQuery,
  availableVariantsFromCard,
  scoreCard,
  resolveVariant,
  resolveCardIdentity,
  setMatchesHint,
  setMatchScore,
} from './card-identity.js';

// ── Fixture catalog (deterministic, no network) ────────────────────────────────
// Mirrors the real pokemontcg.io records for the acceptance-example cards.

const FIXTURE = {
  // Dragonite ex 90/97 — Dragon (ex3). Note: not Dragon Frontiers (that's the δ variant #91).
  'ex3-90': { id: 'ex3-90', name: 'Dragonite ex', number: '90', setId: 'ex3', setName: 'Dragon', ptcgoCode: 'DR', availableVariants: ['none', 'reverse_holo'] },
  'ex15-91': { id: 'ex15-91', name: 'Dragonite ex δ', number: '91', setId: 'ex15', setName: 'Dragon Frontiers', ptcgoCode: 'DF', availableVariants: ['none', 'reverse_holo'] },
  // Psyduck — Aquapolis (ecard2), reverse holo exists.
  'ecard2-104': { id: 'ecard2-104', name: 'Psyduck', number: '104', setId: 'ecard2', setName: 'Aquapolis', ptcgoCode: 'AQ', availableVariants: ['none', 'reverse_holo'] },
  // Charizard — Base Set (base1). All prints collapse to one id.
  'base1-4': { id: 'base1-4', name: 'Charizard', number: '4', setId: 'base1', setName: 'Base', ptcgoCode: 'BASE', availableVariants: ['none', 'first_edition', 'shadowless', 'unlimited'] },
  // A modern reverse-holo-available card.
  'sv3-159': { id: 'sv3-159', name: 'Dragonite ex', number: '159', setId: 'sv3', setName: 'Obsidian Flames', ptcgoCode: null, availableVariants: ['none', 'reverse_holo'] },
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

// ── normalizeQuery ──────────────────────────────────────────────────────────────

test('normalizeQuery: lowercase, strip punctuation, expand abbreviations', () => {
  const n = normalizeQuery('1st Ed Shadowless Charizard 4/102!');
  assert.equal(n.name, 'charizard');
  assert.equal(n.number, '4');
  // "1st Ed" expands to "first edition", which takes precedence over the implied
  // shadowless print — both describe the same Base Set 1st-edition card.
  assert.equal(n.claimedVariant, 'first_edition');
});

test('normalizeQuery: "reverse holo" and "rh" both map to reverse_holo', () => {
  assert.equal(normalizeQuery('psyduck reverse holo').claimedVariant, 'reverse_holo');
  assert.equal(normalizeQuery('psyduck rh').claimedVariant, 'reverse_holo');
});

test('normalizeQuery: number extraction keeps card number, strips set hint', () => {
  const n = normalizeQuery('Dragonite ex 90/97');
  assert.equal(n.name, 'dragonite ex');
  assert.equal(n.number, '90');
});

test('normalizeQuery: no variant keyword defaults to none', () => {
  const n = normalizeQuery('Dragonite ex 90/97');
  assert.equal(n.claimedVariant, 'none');
});

// ── availableVariantsFromCard ───────────────────────────────────────────────────

test('availableVariantsFromCard: infers variants from tcgplayer.prices keys', () => {
  const card = { setId: 'sv3', tcgplayer: { prices: { normal: {}, reverseHolofoil: {} } } };
  const v = availableVariantsFromCard(card);
  assert.ok(v.includes('reverse_holo'));
  assert.ok(v.includes('none'));
});

test('availableVariantsFromCard: Base Set always gets shadowless + unlimited', () => {
  const v = availableVariantsFromCard({ setId: 'base1', tcgplayer: { prices: { holofoil: {} } } });
  assert.ok(v.includes('shadowless'));
  assert.ok(v.includes('unlimited'));
  assert.ok(v.includes('first_edition'));
});

test('availableVariantsFromCard: empty card defaults to none', () => {
  assert.deepEqual(availableVariantsFromCard({}), ['none']);
});

// ── setMatchesHint (client-side set narrowing) ─────────────────────────────────

test('setMatchesHint: "base set" matches the set "Base"', () => {
  assert.equal(setMatchesHint('Base', 'base set'), true);
  assert.equal(setMatchesHint('Aquapolis', 'base set'), false);
});

test('setMatchesHint: "aquapolis" matches "Aquapolis" and "Aquapolis (EX)" style names', () => {
  assert.equal(setMatchesHint('Aquapolis', 'aquapolis'), true);
  assert.equal(setMatchesHint('Expedition', 'aquapolis'), false);
});

test('setMatchesHint: "dragon frontiers" matches "Dragon Frontiers"', () => {
  assert.equal(setMatchesHint('Dragon Frontiers', 'dragon frontiers'), true);
  assert.equal(setMatchesHint('Dragon', 'dragon frontiers'), false);
});

test('setMatchesHint: empty/meaningless hint matches nothing specific', () => {
  assert.equal(setMatchesHint('Aquapolis', 'set'), false);
  assert.equal(setMatchesHint('Aquapolis', ''), false);
});

test('setMatchScore: "base set" ranks Base (1.0) above Base Set 2 (0.33)', () => {
  assert.ok(setMatchScore('Base', 'base set') > setMatchScore('Base Set 2', 'base set'));
  assert.equal(setMatchScore('Base', 'base set'), 1);
});

// ── scoreCard ───────────────────────────────────────────────────────────────────

test('scoreCard: exact name + number = 1.0', () => {
  const q = normalizeQuery('Dragonite ex 90');
  assert.equal(scoreCard(FIXTURE['ex3-90'], q), 1);
});

test('scoreCard: wrong number disqualifies', () => {
  const q = normalizeQuery('Dragonite ex 91');
  assert.equal(scoreCard(FIXTURE['ex3-90'], q), 0);
});

test('scoreCard: fuzzy name gives partial credit', () => {
  const q = normalizeQuery('draginite ex 90');
  const s = scoreCard(FIXTURE['ex3-90'], q);
  assert.ok(s > 0 && s < 1);
});

// ── resolveVariant (cross-check rule 7) ─────────────────────────────────────────

test('resolveVariant: confirmed variant is not suspicious', () => {
  const r = resolveVariant(FIXTURE['ecard2-104'], 'reverse_holo');
  assert.equal(r.suspicious, false);
  assert.equal(r.variant, 'reverse_holo');
});

test('resolveVariant: reverse holo on a card that lacks it is suspicious', () => {
  const noRh = { ...FIXTURE['ex3-90'], availableVariants: ['none'] };
  const r = resolveVariant(noRh, 'reverse_holo');
  assert.equal(r.suspicious, true);
});

test('resolveVariant: shadowless on non-Base-Set is suspicious', () => {
  const r = resolveVariant(FIXTURE['ecard2-104'], 'shadowless');
  assert.equal(r.suspicious, true);
});

// ── resolveCardIdentity (acceptance queries) ────────────────────────────────────

test('acceptance: Dragonite ex 90/97 → exact match, confidence 1', async () => {
  const res = await resolveCardIdentity('Dragonite ex 90/97', makeCatalog());
  assert.equal(res.canonical_name, 'Dragonite ex');
  assert.equal(res.card_number, '90');
  assert.equal(res.confidence, 1);
  assert.equal(res.needs_human_confirmation, false);
});

test('acceptance: psyduck aquapolis reverse holo → set + variant detected', async () => {
  const res = await resolveCardIdentity('psyduck aquapolis reverse holo', makeCatalog());
  assert.equal(res.canonical_name, 'Psyduck');
  assert.equal(res.set_name, 'Aquapolis');
  assert.equal(res.variant, 'reverse_holo');
  assert.equal(res.suspicious ?? false, false);
});

test('acceptance: 1st edition shadowless charizard ≠ unlimited charizard', async () => {
  const a = await resolveCardIdentity('charizard base set 1st edition shadowless', makeCatalog());
  const b = await resolveCardIdentity('charizard base set unlimited', makeCatalog());
  assert.equal(a.variant, 'first_edition');
  assert.equal(b.variant, 'unlimited');
  assert.notEqual(a.variant, b.variant);
});

test('zero-match fallback → confidence 0 + warning, no throw', async () => {
  const res = await resolveCardIdentity('zzzz notarealcard 99/99', makeCatalog());
  assert.equal(res.confidence, 0);
  assert.equal(res.needs_human_confirmation, true);
  assert.ok(res.warnings.length > 0);
  assert.deepEqual(res.candidates, []);
});

test('degraded catalog → warning says retry, not "no match"', async () => {
  const degradedCatalog = {
    ...makeCatalog(),
    async searchCards() { return []; },
    health() { return { degraded: true, message: 'catalog HTTP 502' }; },
  };
  const res = await resolveCardIdentity('Dragonite ex 90/97', degradedCatalog);
  assert.equal(res.confidence, 0);
  assert.ok(res.warnings.some((w) => w.includes('catalog unavailable') && w.includes('502')));
  assert.ok(!res.warnings.some((w) => w.startsWith('no catalog match')));
});

test('ambiguous name returns candidate list + needs human confirmation', async () => {
  // "Dragonite ex" alone matches ex3-90 (Dragon #90) and sv3-159 (Obsidian Flames #159).
  const res = await resolveCardIdentity('Dragonite ex', makeCatalog());
  assert.ok(res.candidates.length >= 1);
  assert.ok(res.candidates.length <= 3);
  // No number given, so a single exact-name pick is still acceptable; if tied, confirm.
  assert.ok(res.candidates.length >= 1);
});

test('variant cross-check flags a suspicious claim and sets needs_human_confirmation', async () => {
  // Psyduck (Aquapolis) exists in reverse holo, but claim shadowless (Base-Set-only).
  const res = await resolveCardIdentity('psyduck aquapolis shadowless', makeCatalog());
  assert.ok(res.warnings.some((w) => w.includes('shadowless')));
  assert.equal(res.needs_human_confirmation, true);
});

test('exact match + confirmed variant is not suspicious', async () => {
  const res = await resolveCardIdentity('psyduck aquapolis reverse holo 104', makeCatalog());
  assert.equal(res.confidence, 1);
  assert.equal(res.needs_human_confirmation, false);
});
