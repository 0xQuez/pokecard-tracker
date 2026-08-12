"""Photo-based card condition verifier (agent step).

Independent module. Given a listing's photo URLs and the seller's condition
claim, produce an agent-assisted, verified condition assessment.

Design notes
------------
`vision_analyze` is a Hermes *agent* tool, not a Python library. This module
therefore separates the two concerns cleanly:

1. **Vision acquisition** — a caller-supplied `vision_fn(photo_url) -> str`.
   In the Hermes runtime the agent passes a thin wrapper around its own
   `vision_analyze` tool (see `README.md`). The default implementation in this
   file is a stub that raises if you call it directly — it exists so the module
   is honest about the boundary and fails loudly instead of silently producing
   a result with no eyes on the photos.

2. **Judgement** — deterministic, offline-testable parsing and classification:
   parse the structured vision JSON, aggregate per-photo defect scores, map to
   a condition grade, compare to the seller's claim, and flag trust anchors.

The vision step is kept consistent by the system-prompt template in
`src/prompts/vision_condition_prompt.md`; that template instructs the vision
model to return strict JSON so this module can parse it reliably.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field, asdict
from typing import Any, Callable, Dict, List, Optional, Tuple

# Condition grades, ordered best -> worst. Higher index = worse condition.
GRADE_ORDER = ["NM", "LP", "MP", "HP", "DMG"]
GRADE_RANK = {g: i for i, g in enumerate(GRADE_ORDER)}
CLAIM_NORMALIZE = {
    "nm": "NM",
    "lp": "LP",
    "mp": "MP",
    "hp": "HP",
    "dmg": "DMG",
    "damaged": "DMG",
    "excellent": "NM",
    "mint": "NM",
    "near mint": "NM",
    "lightly played": "LP",
    "moderately played": "MP",
    "heavily played": "HP",
}

# Weighting of individual defect signals into a single wear score.
WEAR_WEIGHTS = {
    "corner_whitening": 0.35,
    "back_whitening": 0.15,
    "surface_scratches": 0.30,
    "edge_wear": 0.20,
}

# Physical damage that pushes a card straight to DMG regardless of wear score.
DAMAGE_SIGNALS = ("creases", "stains")

# Wear-score thresholds -> condition grade.
WEAR_THRESHOLDS = [
    (0.75, "HP"),
    (0.40, "MP"),
    (0.14, "LP"),
]

VISION_STRICT_JSON = (
    "Return ONLY a single JSON object, no prose, no markdown fences. "
    "Keys exactly: corner_whitening, back_whitening, surface_scratches, "
    "edge_wear (each a number 0.0-1.0), centering_issue (boolean), "
    "creases (boolean), stains (boolean), notes (string)."
)


class VisionToolNotProvided(RuntimeError):
    """Raised when verifyCondition is called with no way to see the photos."""


@dataclass
class PhotoAnalysis:
    """Structured, per-photo defect observation."""
    corner_whitening: float = 0.0
    back_whitening: float = 0.0
    surface_scratches: float = 0.0
    edge_wear: float = 0.0
    centering_issue: bool = False
    creases: bool = False
    stains: bool = False
    notes: str = ""

    @property
    def wear_score(self) -> float:
        """Weighted aggregate of surface wear, 0.0 (clean) -> ~1.0 (ruined)."""
        return (
            WEAR_WEIGHTS["corner_whitening"] * self.corner_whitening
            + WEAR_WEIGHTS["back_whitening"] * self.back_whitening
            + WEAR_WEIGHTS["surface_scratches"] * self.surface_scratches
            + WEAR_WEIGHTS["edge_wear"] * self.edge_wear
        )

    @property
    def has_damage(self) -> bool:
        return self.creases or self.stains

    @property
    def defects_observed(self) -> List[str]:
        out: List[str] = []
        if self.corner_whitening >= 0.2:
            out.append("corner_whitening")
        if self.back_whitening >= 0.2:
            out.append("back_whitening")
        if self.surface_scratches >= 0.2:
            out.append("surface_scratches")
        if self.edge_wear >= 0.2:
            out.append("edge_wear")
        if self.centering_issue:
            out.append("centering_issue")
        if self.creases:
            out.append("creases")
        if self.stains:
            out.append("stains")
        return out

    @property
    def is_clean(self) -> bool:
        """True when a card is visually clean enough to anchor seller trust."""
        return (
            not self.has_damage
            and self.wear_score < 0.14
            and not self.centering_issue
        )


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def _strip_code_fences(text: str) -> str:
    text = text.strip()
    # Remove ```json ... ``` or ``` ... ``` wrappers.
    m = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
    if m:
        text = m.group(1)
    return text.strip()


def _safe_float(v: Any, default: float = 0.0) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    return max(0.0, min(1.0, f))


def _safe_bool(v: Any) -> bool:
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        return v.strip().lower() in {"true", "1", "yes", "y"}
    return bool(v)


def parse_vision_text(text: str) -> PhotoAnalysis:
    """Parse the strict-JSON vision output into a PhotoAnalysis.

    Tolerant parser: tries strict JSON first, then falls back to extracting
    key:value pairs from the text so a slightly-off vision model still yields a
    usable analysis instead of crashing the pipeline.
    """
    text = _strip_code_fences(text)
    data: Dict[str, Any] = {}
    # Attempt strict JSON (possibly after removing a leading code fence).
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            data = parsed
    except (json.JSONDecodeError, ValueError):
        # Fallback: pull `key: value` pairs out of free text.
        for key in (
            "corner_whitening", "back_whitening", "surface_scratches",
            "edge_wear", "centering_issue", "creases", "stains",
        ):
            m = re.search(rf"{key}\s*[:=]\s*([0-9.]+|true|false|True|False)",
                          text, re.IGNORECASE)
            if m:
                raw = m.group(1)
                if raw.lower() in {"true", "false"}:
                    data[key] = raw.lower() == "true"
                else:
                    data[key] = float(raw)
        if "notes" not in data:
            # Capture trailing prose after the last recognized key as notes.
            tail = re.split(r"\b(?:corner_whitening|back_whitening|surface_"
                            r"scratches|edge_wear|centering_issue|creases|"
                            r"stains)\s*[:=]\s*[0-9.]+", text, maxsplit=1)
            if len(tail) > 1:
                data["notes"] = tail[-1].strip()

    return PhotoAnalysis(
        corner_whitening=_safe_float(data.get("corner_whitening")),
        back_whitening=_safe_float(data.get("back_whitening")),
        surface_scratches=_safe_float(data.get("surface_scratches")),
        edge_wear=_safe_float(data.get("edge_wear")),
        centering_issue=_safe_bool(data.get("centering_issue")),
        creases=_safe_bool(data.get("creases")),
        stains=_safe_bool(data.get("stains")),
        notes=str(data.get("notes", "")),
    )


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------

def classify_photo(analysis: PhotoAnalysis) -> str:
    """Map a single photo's defect analysis to a condition grade."""
    if analysis.has_damage:
        return "DMG"
    score = analysis.wear_score
    for threshold, grade in WEAR_THRESHOLDS:
        if score >= threshold:
            return grade
    return "NM"


def _decisiveness(analysis: PhotoAnalysis, grade: str) -> float:
    """How far the wear score sits from the nearest grade boundary, 0..1."""
    score = analysis.wear_score
    if grade == "DMG":
        return 1.0  # hard damage signals are decisive
    boundaries = {"NM": 0.14, "LP": 0.40, "MP": 0.75, "HP": 1.0}
    low = boundaries.get(grade, 0.0)
    high = 1.0
    # Distance from the class's lower threshold:
    if grade == "NM":
        return max(0.0, min(1.0, (low - score) / low)) if low > 0 else 1.0
    if grade == "HP":
        return max(0.0, min(1.0, (score - 0.75) / 0.25))
    # LP / MP: distance to nearest boundary, normalized to the ~0.35 band.
    return max(0.0, min(1.0, min(abs(score - low), abs(score - high)) / 0.35))


def aggregate_grade(analyses: List[PhotoAnalysis]) -> Tuple[str, float, float]:
    """Combine per-photo analyses into (grade, wear_score, confidence)."""
    if not analyses:
        return "NM", 0.0, 0.3  # no photos seen -> low-confidence NM guess
    wear_scores = [a.wear_score for a in analyses]
    avg_wear = sum(wear_scores) / len(wear_scores)

    per_photo_grades = [classify_photo(a) for a in analyses]
    # Majority grade; ties resolved toward the worse of the tied options.
    counts: Dict[str, int] = {}
    for g in per_photo_grades:
        counts[g] = counts.get(g, 0) + 1
    top = max(counts, key=lambda g: (counts[g], GRADE_RANK[g]))
    top_count = counts[top]
    top_decisiveness = max(_decisiveness(a, top) for a in analyses)

    agreement = top_count / len(analyses)  # how consistent the photos are
    confidence = 0.50 + 0.40 * (0.5 * agreement + 0.5 * top_decisiveness)
    confidence = max(0.30, min(0.98, confidence))
    if any(a.has_damage for a in analyses):
        confidence = max(confidence, 0.85)  # hard signals raise confidence
    if agreement < 0.6:
        confidence *= 0.75  # contradictory photos erode confidence
    return top, avg_wear, round(confidence, 2)


# ---------------------------------------------------------------------------
# Seller-claim comparison
# ---------------------------------------------------------------------------

def normalize_claim(claim: Optional[str]) -> Optional[str]:
    """Map a free-text seller claim to a canonical grade, or None if ungradeable."""
    if not claim:
        return None
    key = claim.strip().lower()
    # "used" / "unknown" are honest but not a specific grade.
    if key in {"used", "unknown"}:
        return None
    if key in CLAIM_NORMALIZE:
        return CLAIM_NORMALIZE[key]
    return None


def compute_agreement(verified: str, claim: Optional[str]) -> str:
    """Compare verified grade to the seller's canonical claim."""
    if claim is None:
        return "agrees"  # nothing specific to dispute
    if GRADE_RANK[verified] == GRADE_RANK[claim]:
        return "agrees"
    if GRADE_RANK[verified] < GRADE_RANK[claim]:
        # verified better than the claim -> seller was conservative
        return "seller_conservative"
    # verified worse than the claim -> seller claimed better than reality
    return "seller_optimistic"


def detect_trust_anchor(verified: str, claim: Optional[str],
                        analyses: List[PhotoAnalysis]) -> bool:
    """True when seller marked an explicit condition, photos confirm it,
    and the card looks clean (vintage NM/LP anchor)."""
    if claim is None:
        return False
    if verified != claim:
        return False
    if verified not in {"NM", "LP"}:
        return False
    return all(a.is_clean for a in analyses) if analyses else False


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def default_vision_fn(photo_url: str) -> str:
    """Stub for the vision boundary.

    In the Hermes runtime the agent must pass its own callable that wraps the
    `vision_analyze` tool. This default raises so a silent no-op can never be
    mistaken for a real assessment.
    """
    raise VisionToolNotProvided(
        "verifyCondition needs a vision_fn(photo_url) -> str. In Hermes pass "
        "`lambda u: vision_analyze(image_url=u, question=VISION_QUESTION)`."
    )


def verifyCondition(listing: Dict[str, Any],
                    vision_fn: Optional[Callable[[str], str]] = None,
                    analyses: Optional[List[PhotoAnalysis]] = None,
                    ) -> Dict[str, Any]:
    """Verify a listing's condition from its photos and seller claim.

    Parameters
    ----------
    listing : dict
        ``{"listing_url", "seller_condition_claim", "photo_urls": [...]}``.
    vision_fn : callable, optional
        ``str -> str`` returning the vision model's text for a photo URL.
        Required unless ``analyses`` is supplied (test/injection path).
    analyses : list[PhotoAnalysis], optional
        Pre-computed per-photo analyses. If given, ``vision_fn`` is ignored —
        used by tests and offline replay to avoid live vision calls.

    Returns
    -------
    dict with keys: verified_condition, seller_claim, agreement,
    is_trust_anchor, defects_observed, confidence, notes.
    """
    photo_urls = listing.get("photo_urls") or []
    raw_claim = listing.get("seller_condition_claim")

    if analyses is None:
        if not photo_urls:
            raise ValueError("listing has no photo_urls and no analyses")
        if vision_fn is None:
            vision_fn = default_vision_fn
        analyses = []
        for url in photo_urls:
            vision_text = vision_fn(url)
            analyses.append(parse_vision_text(vision_text))

    verified, avg_wear, confidence = aggregate_grade(analyses)
    claim = normalize_claim(raw_claim)
    agreement = compute_agreement(verified, claim)
    trust_anchor = detect_trust_anchor(verified, claim, analyses)

    defects: List[str] = []
    for a in analyses:
        for d in a.defects_observed:
            if d not in defects:
                defects.append(d)

    notes_bits = []
    notes_bits.append(
        f"avg wear score {avg_wear:.2f} across {len(analyses)} photo(s)")
    if defects:
        notes_bits.append("defects: " + ", ".join(defects))
    else:
        notes_bits.append("no surface defects observed")
    if claim is None and raw_claim:
        notes_bits.append(f"seller claim '{raw_claim}' is not a specific grade")
    if any(a.notes for a in analyses):
        notes_bits.append(" | vision: " + " / ".join(
            a.notes for a in analyses if a.notes))

    return {
        "verified_condition": verified,
        "seller_claim": claim if claim else (raw_claim or "unknown"),
        "agreement": agreement,
        "is_trust_anchor": trust_anchor,
        "defects_observed": defects,
        "confidence": confidence,
        "notes": "; ".join(notes_bits),
    }


def listing_to_dict(listing: Dict[str, Any],
                    vision_fn: Optional[Callable[[str], str]] = None,
                    ) -> Dict[str, Any]:
    """Alias accepting camelCase input keys (listing_url / photo_urls)."""
    return verifyCondition(listing, vision_fn=vision_fn)


__all__ = [
    "GRADE_ORDER", "GRADE_RANK", "WEAR_WEIGHTS", "WEAR_THRESHOLDS",
    "DAMAGE_SIGNALS", "VISION_STRICT_JSON", "VisionToolNotProvided",
    "PhotoAnalysis", "parse_vision_text", "classify_photo", "aggregate_grade",
    "normalize_claim", "compute_agreement", "detect_trust_anchor",
    "verifyCondition", "default_vision_fn",
]
