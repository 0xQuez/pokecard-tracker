"""Unit tests for T18.6 valuation-math (synthesizeCurve)."""

import sys, os, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "lib"))
from valuation_math import (
    synthesizeCurve, _weighted_median, _listing_weight, _dedupe, CONDITIONS,
)
from fixtures.dragonite_ex_90_97 import canonical_input, _l


def curve_of(inputs):
    return synthesizeCurve(inputs)["condition_curve"]


class TestMinSampleRule(unittest.TestCase):
    def test_below_min_is_insufficient(self):
        inp = {"card_identity": {}, "tcgplayer_data": {"market_price_usd": None},
               "ebay_listings": [_l("x", 100, "NM", "NM")]}
        c = curve_of(inp)
        self.assertEqual(c["NM"]["estimate_usd"], None)
        self.assertEqual(c["NM"]["confidence"], "insufficient_data")
        self.assertEqual(c["NM"]["sample_size"], 1)

    def test_at_min_produces_estimate(self):
        inp = {"card_identity": {}, "tcgplayer_data": {"market_price_usd": None},
               "ebay_listings": [_l("a", 100, "NM", "NM"), _l("b", 110, "NM", "NM")]}
        c = curve_of(inp)
        self.assertIsNotNone(c["NM"]["estimate_usd"])
        self.assertEqual(c["NM"]["sample_size"], 2)
        self.assertEqual(c["NM"]["confidence"], "low")

    def test_empty_input_flags_all(self):
        inp = {"card_identity": {}, "tcgplayer_data": {}, "ebay_listings": []}
        c = curve_of(inp)
        for cond in CONDITIONS:
            self.assertIsNone(c[cond]["estimate_usd"])
            self.assertEqual(c[cond]["confidence"], "insufficient_data")


class TestTrustAnchorWeighting(unittest.TestCase):
    def test_anchor_gets_15x_weight(self):
        anchor = _l("a", 100, "NM", "NM")  # all verified + clean
        non = dict(anchor); non["id"] = "b"; non["photos_clean"] = False
        self.assertAlmostEqual(_listing_weight(anchor), 1.5)
        self.assertAlmostEqual(_listing_weight(non), 1.0)

    def test_weighted_median_biases_toward_high_trust(self):
        # 3 anchors at ~600 vs 1 clean-but-low-priced outlier at 300.
        inp = {"card_identity": {}, "tcgplayer_data": {"market_price_usd": None},
               "ebay_listings": [
                   _l("a", 600, "NM", "NM"),
                   _l("b", 605, "NM", "NM"),
                   _l("c", 595, "NM", "NM"),
                   dict(_l("d", 300, "NM", "NM"), photos_clean=False),
               ]}
        c = curve_of(inp)
        self.assertGreater(c["NM"]["estimate_usd"], 400)  # outlier not dominant
        self.assertLessEqual(c["NM"]["estimate_usd"], 605)


class TestDuplicateExclusion(unittest.TestCase):
    def test_only_most_recent_duplicate_kept(self):
        # 4 NM sales, but 3 are the same listing reposted (dup group).
        dup_old = _l("a", 700, "NM", "NM", duplicate_group="g", sold_at="2026-07-01T00:00:00Z")
        dup_new = _l("b", 690, "NM", "NM", duplicate_group="g", sold_at="2026-07-20T00:00:00Z")
        dup_mid = _l("c", 695, "NM", "NM", duplicate_group="g", sold_at="2026-07-10T00:00:00Z")
        real = _l("d", 500, "NM", "NM")
        inp = {"card_identity": {}, "tcgplayer_data": {"market_price_usd": None},
               "ebay_listings": [dup_old, dup_new, dup_mid, real]}
        c = curve_of(inp)
        # Only the newest duplicate survives → dup_new + real = 2 sales.
        self.assertEqual(c["NM"]["sample_size"], 2)
        # Weighted median (lower-median convention) of {690, 500} = 500.
        self.assertEqual(c["NM"]["estimate_usd"], 500.0)

    def test_dedupe_keeps_newest_per_group(self):
        from valuation_math import _dedupe
        a = _l("a", 700, "NM", "NM", duplicate_group="g", sold_at="2026-07-01T00:00:00Z")
        b = _l("b", 690, "NM", "NM", duplicate_group="g", sold_at="2026-07-20T00:00:00Z")
        out = _dedupe([a, b])
        self.assertEqual([l["id"] for l in out], ["b"])


class TestSellerOptimisticDowngrade(unittest.TestCase):
    def test_optimistic_bucketed_under_verified_and_downweighted(self):
        # Seller claims NM but verified LP.
        opt = _l("o", 999, "NM", "LP", verified_agreement=False)
        lp_sale = _l("p", 500, "LP", "LP")
        inp = {"card_identity": {}, "tcgplayer_data": {"market_price_usd": None},
               "ebay_listings": [opt, lp_sale, _l("q", 510, "LP", "LP")]}
        c = curve_of(inp)
        # Not in NM.
        self.assertEqual(c["NM"]["sample_size"], 0)
        # In LP, but 0.5x weighted — so a 999 outlier doesn't blow up the median.
        self.assertEqual(c["LP"]["sample_size"], 3)
        self.assertLess(c["LP"]["estimate_usd"], 750)
        self.assertAlmostEqual(_listing_weight(opt), 0.5)


class TestCrossSourceSanityCheck(unittest.TestCase):
    def test_healthy_within_20pct(self):
        inp = {"card_identity": {}, "tcgplayer_data": {"market_price_usd": 100.0},
               "ebay_listings": [_l("a", 105, "NM", "NM"), _l("b", 108, "NM", "NM"),
                                 _l("c", 102, "NM", "NM")]}
        s = synthesizeCurve(inp)["tcgplayer_sanity_check"]
        self.assertTrue(s["agrees"])
        self.assertLessEqual(s["delta_pct"], 20.0)

    def test_disagrees_beyond_20pct(self):
        inp = {"card_identity": {}, "tcgplayer_data": {"market_price_usd": 100.0},
               "ebay_listings": [_l("a", 160, "NM", "NM"), _l("b", 170, "NM", "NM"),
                                 _l("c", 150, "NM", "NM")]}
        s = synthesizeCurve(inp)["tcgplayer_sanity_check"]
        self.assertFalse(s["agrees"])
        self.assertGreater(s["delta_pct"], 20.0)

    def test_no_tcg_market_returns_null(self):
        inp = {"card_identity": {}, "tcgplayer_data": {"market_price_usd": None},
               "ebay_listings": [_l("a", 100, "NM", "NM"), _l("b", 110, "NM", "NM")]}
        s = synthesizeCurve(inp)["tcgplayer_sanity_check"]
        self.assertIsNone(s["agrees"])
        self.assertIsNone(s["delta_pct"])


class TestCanonicalFixture(unittest.TestCase):
    def test_expected_curve_shape(self):
        c = curve_of(canonical_input())
        self.assertEqual(c["NM"]["sample_size"], 5)
        self.assertEqual(c["NM"]["confidence"], "high")
        self.assertEqual(c["LP"]["sample_size"], 6)  # incl. optimistic, dedup keeps 6
        self.assertEqual(c["LP"]["confidence"], "high")
        self.assertEqual(c["MP"]["sample_size"], 3)
        self.assertEqual(c["MP"]["confidence"], "medium")
        self.assertEqual(c["HP"]["sample_size"], 2)
        self.assertEqual(c["HP"]["confidence"], "low")
        self.assertEqual(c["DMG"]["sample_size"], 1)
        self.assertEqual(c["DMG"]["confidence"], "insufficient_data")
        self.assertIsNone(c["DMG"]["estimate_usd"])

    def test_monotonic_decreasing(self):
        c = curve_of(canonical_input())
        ests = [c[cond]["estimate_usd"] for cond in CONDITIONS]
        numeric = [e for e in ests if e is not None]
        self.assertEqual(numeric, sorted(numeric, reverse=True))

    def test_sources_recorded(self):
        c = curve_of(canonical_input())
        self.assertIn("https://www.ebay.com/itm/nm-1", c["NM"]["sources"])
        self.assertEqual(len(c["DMG"]["sources"]), 0)


class TestWeightedMedianUnit(unittest.TestCase):
    def test_basic(self):
        self.assertAlmostEqual(_weighted_median([(10, 1), (20, 1), (30, 1)]), 20.0)

    def test_median_ignores_single_extreme_outlier(self):
        self.assertAlmostEqual(_weighted_median([(100, 1), (110, 1), (1000, 1)]), 110.0)

    def test_empty(self):
        self.assertIsNone(_weighted_median([]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
