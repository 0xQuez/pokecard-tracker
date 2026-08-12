"""
Canonical fixture: "Dragonite ex 90/97" (EX Dragon, Holo, 2003).

A hand-built synthetic sample representing realistic post-verification data from
T18.2 (identity), T18.3 (eBay sold), T18.4 (TCGPlayer), T18.5 (condition verify).
It exercises every rule so the expected curve shape can be asserted.
"""

from __future__ import annotations
from typing import Dict, Any, Optional

def _l(id: str, price: float, claim: str, verified: str, *,
       verified_agreement: bool = True, photos_clean: bool = True,
       condition_verified: bool = True, duplicate_group: Optional[str] = None,
       sold_at: str = "2026-08-01T12:00:00Z") -> Dict[str, Any]:
    return {
        "id": id,
        "price_usd": price,
        "url": f"https://www.ebay.com/itm/{id}",
        "sold_at": sold_at,
        "seller_condition": claim,
        "verified_condition": verified,
        "condition_verified": condition_verified,
        "verified_agreement": verified_agreement,
        "photos_clean": photos_clean,
        "duplicate_group": duplicate_group,
    }


def canonical_input() -> Dict[str, Any]:
    return {
        "card_identity": {
            "name": "Dragonite ex",
            "set": "EX Dragon",
            "number": "90/97",
            "finish": "holo",
            "year": 2003,
        },
        "tcgplayer_data": {
            "market_price_usd": 540.00,
            "lowest_listing_usd": 505.00,
            "listed_median_usd": 560.00,
        },
        # eBay sold points (verified). All prices are ACTUAL sale prices.
        "ebay_listings": [
            # NM — 5 clean verified anchors.
            _l("nm-1", 612.00, "NM", "NM"),
            _l("nm-2", 588.00, "NM", "NM"),
            _l("nm-3", 634.00, "NM", "NM"),
            _l("nm-4", 601.00, "NM", "NM"),
            _l("nm-5", 597.00, "NM", "NM"),

            # LP — 6 sales; one is seller-optimistic (claimed NM, verified LP).
            _l("lp-1", 512.00, "LP", "LP"),
            _l("lp-2", 497.00, "LP", "LP", duplicate_group="lp2-repost"),
            _l("lp-3", 533.00, "LP", "LP"),
            # Optimistic: claimed NM but photos show LP → bucketed LP, 0.5x weight.
            _l("lp-opt", 575.00, "NM", "LP", verified_agreement=False),
            _l("lp-4", 505.00, "LP", "LP"),
            _l("lp-5", 489.00, "LP", "LP"),

            # MP — 3 sales.
            _l("mp-1", 421.00, "MP", "MP"),
            _l("mp-2", 448.00, "MP", "MP"),
            _l("mp-3", 405.00, "MP", "MP"),

            # HP — 2 sales (min sample, low confidence).
            _l("hp-1", 312.00, "HP", "HP"),
            _l("hp-2", 289.00, "HP", "HP"),

            # DMG — only 1 sale → insufficient_data.
            _l("dmg-1", 150.00, "DMG", "DMG"),

            # Duplicate cluster: lp-2 reposted twice; keep only the most recent.
            _l("lp-2-dup-old", 497.00, "LP", "LP", duplicate_group="lp2-repost",
               sold_at="2026-07-10T09:00:00Z"),
            _l("lp-2-dup-new", 497.00, "LP", "LP", duplicate_group="lp2-repost",
               sold_at="2026-07-15T09:00:00Z"),
        ],
    }


if __name__ == "__main__":
    import json
    print(json.dumps(canonical_input(), indent=2))
