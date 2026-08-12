# Card Identity Verification Gate

`src/lib/card-identity.ts` is the **first-class gate** in the valuation pipeline.
Before ANY price lookup (eBay, TCGPlayer, valuation math), the agent MUST resolve
the card's identity: **set + card number + print variant**. A wrong identity makes
every downstream price garbage, so this module exists to make that confirmation
explicit and scored.

## When the agent calls this

Always, and first. Feed the raw user/listing query into
`resolveCardIdentityLive(query)` and gate on the result before touching prices:

```ts
import { resolveCardIdentityLive } from '@/lib/card-identity';

const id = await resolveCardIdentityLive('charizard base set 1st edition shadowless');

// DO NOT proceed to pricing unless the identity is trustworthy:
if (id.confidence < 1 || id.needs_human_confirmation) {
  // Confirm the set/variant with the user first, or surface id.candidates.
  return;
}
// Only now is it safe to look up prices for id.set_code / id.card_number / id.variant.
```

### Gate rules

| Condition | Action |
|---|---|
| `confidence === 1 && !needs_human_confirmation` | Proceed to pricing. |
| `candidates.length > 1` (ambiguous) | Ask the user to pick; `needs_human_confirmation` is true. |
| `candidates.length === 0` | Zero matches — tell the user no card found; do not price. |
| `warnings` mention `catalog unavailable` | The catalog (pokemontcg.io) is down/rate-limited. Retry before trusting the zero-match. |
| `warnings` mention `cross-check` | The claimed variant isn't listed for that card (e.g. "reverse holo" on a card that has none). Flag it; a "reverse holo" eBay title that the catalog can't support is suspicious. |

## Output shape

```json
{
  "canonical_name": "Charizard",
  "set_name": "Base",
  "set_code": "BASE",
  "card_number": "4",
  "variant": "first_edition",
  "confidence": 0.65,
  "needs_human_confirmation": true,
  "candidates": [
    { "canonical_name": "Charizard", "set_name": "Base", "set_code": "BASE", "card_number": "4", "variant": "first_edition", "confidence": 0.65, "suspicious": false, "reason": "fuzzy match" }
  ],
  "warnings": []
}
```

`variant` is one of `reverse_holo | first_edition | shadowless | unlimited | none`.

## Print variants are DIFFERENT products

Vintage print variants carry wildly different prices, so the module treats them as
distinct identities:

- **1st Edition** vs **Unlimited**: different cards. `charizard base set 1st edition
  shadowless` resolves to variant `first_edition`; `charizard base set unlimited`
  resolves to `unlimited`. The acceptance test asserts they are never conflated.
- **Shadowless** is a Base Set-only phenomenon and is not represented in the
  pokemontcg.io price data, so it is gated by a hardcoded Base Set rule.
- pokemontcg.io collapses all prints of a card into ONE id (e.g. `base1-4`), so the
  variant layer is a dedicated detection + cross-check step, not a catalog field.

## Catalog choice: pokemontcg.io v2 API (free, no key)

We use the live API rather than a local JSON dump because:

1. It's already the catalog backend for this repo's scrapers, so we stay consistent.
2. The full catalog is ~20k cards and changes every set; a vendored dump goes stale
   and bloats the repo.
3. `tcgplayer.prices` is keyed by print variant (`holofoil`, `reverseHolofoil`,
   `firstEdition*`, `unlimited`), which drives the variant cross-check (rule 7).

The catalog is abstracted behind the `CardCatalog` interface so unit tests run
deterministically against an in-memory fixture (`src/lib/card-identity.test.mjs`),
matching the repo's injectable-settlement test pattern. Use the fixture in tests,
never the network.

### Known API caveat

pokemontcg.io's free tier is rate-limited and intermittently returns 5xx. Two things
handle this:

- `searchCards` fetches a larger page (up to 40) and ranks candidates **client-side**
  by set specificity, so a flaky `set.name:` filter can't drop the right card.
- The `health()` probe reports a degraded catalog, and the resolver surfaces
  `catalog unavailable … retry` in `warnings` instead of a misleading
  `no catalog match`. Never trust a zero-match while the catalog is unhealthy.

## Running the tests

```bash
node scripts/test-card-identity.mjs
```

Compiles `card-identity.ts` to CommonJS in a temp dir, copies the `.mjs` test over,
and runs `node --test`. Covers: exact match, fuzzy match, variant detection
(incl. 1st-edition vs unlimited), zero-match fallback, degraded-catalog fallback,
ambiguous candidate lists, and set-name ranking.
