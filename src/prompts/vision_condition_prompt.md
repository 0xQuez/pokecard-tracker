# Vision Step — Card Condition Assessment Prompt Template

This template standardises how the vision model judges a single card photo so
that assessments are consistent across runs and listings. It is the `question`
passed to Hermes' `vision_analyze` tool for each photo URL, and its output is
the strict-JSON string parsed by `condition_verifier.parse_vision_text`.

## Usage

In the Hermes runtime the agent wires `vision_analyze` to the module like this:

```python
from lib.condition_verifier import verifyCondition, VISION_STRICT_JSON

def vision_fn(photo_url: str) -> str:
    # 'question' is the template below. VISION_STRICT_JSON is the last line.
    return vision_analyze(image_url=photo_url, question=VISION_QUESTION)

result = verifyCondition({"listing_url": ..., "seller_condition_claim": ...,
                          "photo_urls": [...]}, vision_fn=vision_fn)
```

## Question template (substitute nothing — it is self-contained)

```
You are a professional trading-card grader inspecting a single photo of one card.

Assess ONLY what is visible in THIS photo. Do not infer condition from what you
cannot see; if a feature is not clearly visible, score it conservatively toward
the cleaner end (0.0 / false).

Judge each signal on the FULL card represented by this photo:
- corner_whitening: white/light wear on the corners. 0.0 = crisp corners,
  1.0 = heavily whitened/bent corners.
- back_whitening: whitening on the card back (common on vintage cards).
  0.0 = clean back, 1.0 = heavily whitened.
- surface_scratches: scratches, scuffs, or clouding on the front surface.
  0.0 = pristine, 1.0 = heavily scratched.
- edge_wear: wear, chipping, or fraying along the edges. 0.0 = sharp edges,
  1.0 = heavily worn/rounded edges.
- centering_issue: the printed image is noticeably off-center relative to the
  card border (true) or acceptably centered (false).
- creases: any visible crease, fold, or bend in the card (true/false).
- stains: any visible stain, discoloration, marking, or liquid damage
  (true/false).

{VISION_STRICT_JSON}
```

## Judgement rubric

The module maps the parsed scores to a grade using these rules (see
`WEAR_THRESHOLDS` and `DAMAGE_SIGNALS` in the module):

| Condition | Meaning | Typical scores |
|---|---|---|
| NM (Near Mint) | clean, crisp, no visible wear | wear_score < 0.14, no damage |
| LP (Lightly Played) | slight whitening/scuffs, still sharp | 0.14 ≤ wear < 0.40 |
| MP (Moderately Played) | clear wear, whitened corners/edges | 0.40 ≤ wear < 0.75 |
| HP (Heavily Played) | heavy wear, significant whitening/scratches | wear ≥ 0.75 |
| DMG (Damaged) | creases, stains, bends, or heavy physical damage | any crease/stain |

## Consistency guidance for the vision model

- `corner_whitening` and `edge_wear` are the primary vintage-wear signals.
- `back_whitening` matters most for older cards where the back shows wear even
  when the front is clean.
- A card is only **NM/clean** when corners, edges, front, and back are all
  essentially flawless — one visibly whitened corner should push it to at least
  LP.
- Creases or stains override surface scoring and force DMG regardless of how
  otherwise clean the card looks.
- Be conservative: when unsure between two adjacent grades, choose the worse
  one (protects the buyer from a seller-optimistic error).
