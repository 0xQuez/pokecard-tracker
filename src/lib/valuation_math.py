"""
T18.6 — Per-condition valuation curve synthesis.

Pure function: given verified eBay sold-price points + TCGPlayer market data,
produce a per-condition (NM/LP/MP/HP/DMG) value curve with trust weighting.

Rules implemented (from the user's spec):
  1. Only actual SOLD prices are valid. Range listings already filtered upstream.
  2. Best Offer sold prices valid — `price_usd` is the actual sale price, not the ask.
  3. Use VERIFIED condition from T18.5, never the seller's raw claim.
  4. Trust anchors (verified agreement + clean photos) get 1.5x weight.
  5. Seller-optimistic listings (claimed better than verified) are down-weighted 0.5x
     and bucketed under the VERIFIED condition, not the claim.
  6. Suspicious duplicates (flagged by T18.3) are collapsed to the most recent sale.
  7. Minimum sample: < MIN_SALES per condition => `insufficient_data`.
  8. Cross-source: eBay sold drives the estimate; TCGPlayer market is a sanity
     check — within TCG_DELTA_TOLERANCE_PCT (20%) is healthy.

Estimator: weighted median of the per-sale prices, weighted by trust. See README.
"""

from __future__ import annotations

import datetime as _dt
from typing import Any, Dict, List, Optional

# ── Tunables ─────────────────────────────────────────────────────────────────
CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"]
MIN_SALES = 2              # rule 7: fewer sales than this => insufficient_data
ANCHOR_WEIGHT = 1.5        # rule 4: verified agreement + clean photos
OPTIMISTIC_WEIGHT = 0.5    # rule 5: seller claimed better than verified
TCG_DELTA_TOLERANCE_PCT = 20.0  # rule 8: within ±20% is healthy

_CONDITION_RANK = {c: i for i, c in enumerate(CONDITIONS)}  # NM(0) ... DMG(4)


# ── Helpers ──────────────────────────────────────────────────────────────────
def _clean_condition(raw: Any) -> Optional[str]:
    """Normalize a condition token to a canonical NM/LP/MP/HP/DMG, else None."""
    if not isinstance(raw, str):
        return None
    c = raw.strip().upper().replace("-", " ").replace("_", " ")
    alias = {
        "MINT": "NM", "NEAR MINT": "NM", "NEARMINT": "NM",
        "LIGHTLY PLAYED": "LP", "LIGHTLYPLAYED": "LP",
        "MODERATELY PLAYED": "MP", "MODERATELYPLAYED": "MP",
        "HEAVILY PLAYED": "HP", "HEAVILYPLAYED": "HP",
        "DAMAGED": "DMG", "POOR": "DMG", "PLAYED": "DMG",
    }
    c = alias.get(c, c)
    return c if c in _CONDITION_RANK else None


def _is_trust_anchor(listing: Dict[str, Any]) -> bool:
    """Rule 4: verified condition agrees with claim AND photos reviewed clean."""
    return bool(listing.get("condition_verified")) and \
        listing.get("verified_condition") is not None and \
        bool(listing.get("verified_agreement")) and \
        bool(listing.get("photos_clean"))


def _is_seller_optimistic(listing: Dict[str, Any]) -> bool:
    """Rule 5: seller claimed a BETTER condition than the verified one."""
    claimed = _clean_condition(listing.get("seller_condition"))
    verified = _clean_condition(listing.get("verified_condition"))
    if claimed is None or verified is None:
        return False
    return _CONDITION_RANK[claimed] < _CONDITION_RANK[verified]


def _listing_weight(listing: Dict[str, Any]) -> float:
    w = 1.0
    if _is_trust_anchor(listing):
        w *= ANCHOR_WEIGHT
    if _is_seller_optimistic(listing):
        w *= OPTIMISTIC_WEIGHT
    return w


def _bucket_condition(listing: Dict[str, Any]) -> Optional[str]:
    """Rule 3: use verified condition; fall back to the claim only if unverified."""
    verified = _clean_condition(listing.get("verified_condition"))
    if verified is not None:
        return verified
    return _clean_condition(listing.get("seller_condition"))


def _sale_ts(listing: Dict[str, Any]) -> str:
    return listing.get("sold_at") or listing.get("date") or ""


def _dedupe(listings: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Rule 6: if a listing carries a duplicate_group id (flagged by T18.3), keep only
    the most recent sale within that group. Listings without a duplicate_group id
    pass through untouched.
    """
    groups: Dict[str, List[Dict[str, Any]]] = {}
    out: List[Dict[str, Any]] = []
    for l in listings:
        g = l.get("duplicate_group")
        if g:
            groups.setdefault(g, []).append(l)
        else:
            out.append(l)
    for group in groups.values():
        latest = max(group, key=_sale_ts)
        out.append(latest)
    return out


def _weighted_median(pairs: List[tuple]) -> Optional[float]:
    """
    Weighted median of (price, weight) pairs.
    Sort ascending by price, then walk cumulative weight to the 50% mark.
    Robust to a single extreme outlier — unlike a mean/trimmed-mean, one bad
    sale cannot dominate the estimate.
    """
    if not pairs:
        return None
    pairs = sorted(pairs, key=lambda p: p[0])
    total = sum(w for _, w in pairs)
    if total <= 0:
        return None
    acc = 0.0
    for price, w in pairs:
        acc += w
        if acc >= total / 2.0:
            return price
    return pairs[-1][0]


def _confidence(sample_size: int) -> str:
    if sample_size >= 5:
        return "high"
    if sample_size >= 3:
        return "medium"
    return "low"


# ── Core ─────────────────────────────────────────────────────────────────────
def synthesizeCurve(inputs: Dict[str, Any]) -> Dict[str, Any]:
    """
    inputs:
      {
        "card_identity": {...},        // passthrough (from T18.2)
        "ebay_listings": [ ... ],      // each a sold price point (from T18.3, verified T18.5)
        "tcgplayer_data": {            // (from T18.4)
          "market_price_usd": float|None,
          ...
        }
      }

    An eBay listing shape (all optional keys are defensively read):
      {
        "id": str,
        "price_usd": float,            // ACTUAL sale price (rule 2)
        "url": str,
        "sold_at": str,                // ISO timestamp (for dedupe / recency)
        "seller_condition": "NM",      // raw claim = opinion (rule 3)
        "verified_condition": "NM",    // from T18.5
        "condition_verified": bool,    // was verification performed?
        "verified_agreement": bool,    // T18.5 agrees with the claim?
        "photos_clean": bool,          // photo review clean?
        "duplicate_group": str|None,   // set by T18.3 when flagged suspicious
      }
    """
    ebay = inputs.get("ebay_listings") or []
    tcg = inputs.get("tcgplayer_data") or {}

    # Rule 1 + 2: only sold points with a real price.
    sold = [
        l for l in ebay
        if isinstance(l.get("price_usd"), (int, float))
        and l.get("price_usd", 0) > 0
    ]

    # Rule 6: collapse flagged duplicates to the most recent sale.
    deduped = _dedupe(sold)

    # Bucket by VERIFIED condition (rule 3, 5).
    buckets: Dict[str, List[Dict[str, Any]]] = {c: [] for c in CONDITIONS}
    for l in deduped:
        cond = _bucket_condition(l)
        if cond is not None:
            buckets[cond].append(l)

    curve: Dict[str, Dict[str, Any]] = {}
    for cond in CONDITIONS:
        group = buckets[cond]
        n = len(group)
        sources = sorted({l["url"] for l in group if l.get("url")})

        if n < MIN_SALES:  # rule 7
            curve[cond] = {
                "estimate_usd": None,
                "sample_size": n,
                "confidence": "insufficient_data",
                "sources": [],
            }
            continue

        pairs = [(l["price_usd"], _listing_weight(l)) for l in group]
        est = _weighted_median(pairs)
        curve[cond] = {
            "estimate_usd": round(est, 2) if est is not None else None,
            "sample_size": n,
            "confidence": _confidence(n),
            "sources": sources,
        }

    sanity = _sanity_check(curve, tcg)

    return {
        "card_identity": inputs.get("card_identity"),
        "condition_curve": curve,
        "tcgplayer_sanity_check": sanity,
        "estimated_at": _dt.datetime.now(_dt.timezone.utc).isoformat(),
    }


def _sanity_check(curve: Dict[str, Dict[str, Any]],
                  tcg: Dict[str, Any]) -> Dict[str, Any]:
    """
    Rule 8: eBay sold is the realized-value estimate; TCGPlayer market is the
    sanity reference. Prefer the highest-confidence condition as the card's
    representative realized value. Within ±20% of the TCG market = healthy.
    """
    market = tcg.get("market_price_usd")
    if not isinstance(market, (int, float)) or market <= 0:
        return {"agrees": None, "delta_pct": None}

    # Representative estimate: highest confidence, then largest sample.
    order = {"high": 0, "medium": 1, "low": 2}
    candidates = [
        (cond, c["estimate_usd"], order[c["confidence"]], c["sample_size"])
        for cond, c in curve.items()
        if c["estimate_usd"] is not None
    ]
    if not candidates:
        return {"agrees": None, "delta_pct": None}
    candidates.sort(key=lambda t: (t[2], -t[3]))
    rep_cond, rep_est, _, _ = candidates[0]

    delta_pct = abs(rep_est - market) / market * 100.0
    return {
        "agrees": delta_pct <= TCG_DELTA_TOLERANCE_PCT,
        "delta_pct": round(delta_pct, 2),
        "basis_condition": rep_cond,
        "basis_estimate_usd": rep_est,
        "market_price_usd": round(market, 2),
    }
