"""Tests for src/lib/condition_verifier.py.

Run from the repo root:
    python3 -m unittest discover -s tests -v
"""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "lib"))

from condition_verifier import (  # noqa: E402
    GRADE_ORDER,
    PhotoAnalysis,
    parse_vision_text,
    classify_photo,
    aggregate_grade,
    normalize_claim,
    compute_agreement,
    detect_trust_anchor,
    verifyCondition,
    default_vision_fn,
    VisionToolNotProvided,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURES = os.path.join(ROOT, "tests", "fixtures", "fixture_observations.json")


def _analysis(**kw):
    defaults = dict(corner_whitening=0.0, back_whitening=0.0,
                    surface_scratches=0.0, edge_wear=0.0,
                    centering_issue=False, creases=False, stains=False,
                    notes="")
    defaults.update(kw)
    return PhotoAnalysis(**defaults)


class TestParseVisionText(unittest.TestCase):
    def test_strict_json(self):
        a = parse_vision_text('{"corner_whitening":0.5,"surface_scratches":0.2,"stains":true}')
        self.assertAlmostEqual(a.corner_whitening, 0.5)
        self.assertAlmostEqual(a.surface_scratches, 0.2)
        self.assertTrue(a.stains)
        self.assertFalse(a.creases)

    def test_code_fenced_json(self):
        a = parse_vision_text('```json\n{"edge_wear":0.8,"creases":true}\n```')
        self.assertAlmostEqual(a.edge_wear, 0.8)
        self.assertTrue(a.creases)

    def test_free_text_fallback(self):
        text = ("corner_whitening: 0.6\nsurface_scratches = 0.4\ncreases: false\n"
                "The card shows wear on the top corners.")
        a = parse_vision_text(text)
        self.assertAlmostEqual(a.corner_whitening, 0.6)
        self.assertAlmostEqual(a.surface_scratches, 0.4)
        self.assertFalse(a.creases)
        self.assertTrue("wear on the top corners" in a.notes)

    def test_bad_input_clamps(self):
        a = parse_vision_text('{"corner_whitening":99,"surface_scratches":-5}')
        self.assertAlmostEqual(a.corner_whitening, 1.0)
        self.assertAlmostEqual(a.surface_scratches, 0.0)


class TestClassification(unittest.TestCase):
    def test_clean_is_nm(self):
        self.assertEqual(classify_photo(_analysis()), "NM")

    def test_light_corner_wear_lp(self):
        a = _analysis(corner_whitening=0.5)  # wear 0.175 -> LP
        self.assertEqual(classify_photo(a), "LP")

    def test_clear_wear_mp(self):
        # corner 0.7 + edge 0.7 + scratch 0.4 -> 0.245+0.14+0.12 = 0.505 -> MP
        a = _analysis(corner_whitening=0.7, edge_wear=0.7, surface_scratches=0.4)
        self.assertEqual(classify_photo(a), "MP")

    def test_heavy_wear_hp(self):
        a = _analysis(corner_whitening=0.9, surface_scratches=0.9,
                      edge_wear=0.9)  # wear 0.81 -> HP
        self.assertEqual(classify_photo(a), "HP")

    def test_crease_forces_dmg(self):
        a = _analysis(corner_whitening=0.1, creases=True)
        self.assertEqual(classify_photo(a), "DMG")

    def test_stain_forces_dmg(self):
        a = _analysis(surface_scratches=0.1, stains=True)
        self.assertEqual(classify_photo(a), "DMG")

    def test_aggregate_majority(self):
        grades = aggregate_grade([_analysis(), _analysis(), _analysis(corner_whitening=0.6)])
        self.assertEqual(grades[0], "NM")
        # avg wear = (0 + 0 + 0.21) / 3
        self.assertAlmostEqual(grades[1], 0.07, places=2)


class TestNormalizeClaim(unittest.TestCase):
    def test_canonical_grades(self):
        self.assertEqual(normalize_claim("NM"), "NM")
        self.assertEqual(normalize_claim("LP"), "LP")
        self.assertEqual(normalize_claim("dmg"), "DMG")
        self.assertEqual(normalize_claim("Mint"), "NM")
        self.assertEqual(normalize_claim("lightly played"), "LP")

    def test_unknown_used_none(self):
        self.assertIsNone(normalize_claim("used"))
        self.assertIsNone(normalize_claim("unknown"))
        self.assertIsNone(normalize_claim(""))
        self.assertIsNone(normalize_claim(None))


class TestAgreement(unittest.TestCase):
    def test_agrees(self):
        self.assertEqual(compute_agreement("NM", "NM"), "agrees")

    def test_seller_optimistic(self):
        # Verified MP, seller claims NM -> seller claimed better than reality.
        self.assertEqual(compute_agreement("MP", "NM"), "seller_optimistic")

    def test_seller_conservative(self):
        # Verified NM, seller claims MP -> seller claimed worse.
        self.assertEqual(compute_agreement("NM", "MP"), "seller_conservative")

    def test_no_claim_agrees(self):
        self.assertEqual(compute_agreement("MP", None), "agrees")


class TestTrustAnchor(unittest.TestCase):
    def test_nm_clean_anchor(self):
        a = [_analysis()]
        self.assertTrue(detect_trust_anchor("NM", "NM", a))

    def test_lp_clean_anchor(self):
        a = [_analysis()]
        self.assertTrue(detect_trust_anchor("LP", "LP", a))

    def test_not_clean_not_anchor(self):
        a = [_analysis(corner_whitening=0.5)]
        self.assertFalse(detect_trust_anchor("LP", "LP", a))

    def test_played_grade_not_anchor(self):
        a = [_analysis()]
        self.assertFalse(detect_trust_anchor("MP", "MP", a))

    def test_mismatch_not_anchor(self):
        a = [_analysis()]
        self.assertFalse(detect_trust_anchor("NM", "LP", a))

    def test_no_claim_not_anchor(self):
        a = [_analysis()]
        self.assertFalse(detect_trust_anchor("NM", None, a))


class TestVerifyCondition(unittest.TestCase):
    def test_full_pipeline_agrees(self):
        res = verifyCondition(
            {"listing_url": "u", "seller_condition_claim": "LP",
             "photo_urls": ["p1"]},
            analyses=[_analysis(corner_whitening=0.5)],  # wear 0.175 -> LP
        )
        self.assertEqual(res["verified_condition"], "LP")
        self.assertEqual(res["agreement"], "agrees")
        self.assertIn("corner_whitening", res["defects_observed"])
        self.assertTrue(0.0 <= res["confidence"] <= 1.0)

    def test_seller_optimistic_detection(self):
        # Seller says NM; photos show clear whitening -> verified MP -> optimistic.
        res = verifyCondition(
            {"listing_url": "u", "seller_condition_claim": "NM",
             "photo_urls": ["p1"]},
            analyses=[_analysis(corner_whitening=0.7, edge_wear=0.7,
                                surface_scratches=0.4)],  # wear 0.505 -> MP
        )
        self.assertEqual(res["verified_condition"], "MP")
        self.assertEqual(res["agreement"], "seller_optimistic")
        self.assertFalse(res["is_trust_anchor"])

    def test_trust_anchor_pipeline(self):
        res = verifyCondition(
            {"listing_url": "u", "seller_condition_claim": "NM",
             "photo_urls": ["p1"]},
            analyses=[_analysis()],
        )
        self.assertTrue(res["is_trust_anchor"])
        self.assertEqual(res["agreement"], "agrees")

    def test_no_vision_fn_raises(self):
        with self.assertRaises(VisionToolNotProvided):
            verifyCondition({"listing_url": "u", "seller_condition_claim": "NM",
                             "photo_urls": ["http://x/y.png"]})
        with self.assertRaises(VisionToolNotProvided):
            default_vision_fn("http://x/y.png")

    def test_no_photos_no_analyses_raises(self):
        with self.assertRaises(ValueError):
            verifyCondition({"listing_url": "u", "seller_condition_claim": "NM",
                             "photo_urls": []})

    def test_used_claim_handling(self):
        res = verifyCondition(
            {"listing_url": "u", "seller_condition_claim": "used",
             "photo_urls": ["p1"]},
            analyses=[_analysis(corner_whitening=0.6)],
        )
        # 'used' is not a specific grade -> cannot dispute; verified still LP/MP.
        self.assertIn(res["verified_condition"], GRADE_ORDER)
        self.assertEqual(res["agreement"], "agrees")
        self.assertFalse(res["is_trust_anchor"])

    def test_multi_photo_aggregation(self):
        # Two clean photos, one heavy -> majority NM but confidence reduced.
        res = verifyCondition(
            {"listing_url": "u", "seller_condition_claim": "NM",
             "photo_urls": ["p1", "p2", "p3"]},
            analyses=[_analysis(), _analysis(),
                      _analysis(corner_whitening=0.9, edge_wear=0.9)],
        )
        self.assertEqual(res["verified_condition"], "NM")
        self.assertLess(res["confidence"], 0.98)


class TestFixtureObservations(unittest.TestCase):
    """Acceptance: given the fixture card photos' observed conditions, the
    module returns the expected grade for each (NM, LP, MP, HP, DMG)."""

    def test_fixture_grades(self):
        with open(FIXTURES) as f:
            fixtures = json.load(f)
        for key, spec in fixtures.items():
            obs = spec["vision_analysis"]
            analysis = PhotoAnalysis(
                corner_whitening=obs.get("corner_whitening", 0.0),
                back_whitening=obs.get("back_whitening", 0.0),
                surface_scratches=obs.get("surface_scratches", 0.0),
                edge_wear=obs.get("edge_wear", 0.0),
                centering_issue=obs.get("centering_issue", False),
                creases=obs.get("creases", False),
                stains=obs.get("stains", False),
                notes=obs.get("notes", ""),
            )
            res = verifyCondition(
                {"listing_url": "u", "seller_condition_claim": spec["expected_condition"],
                 "photo_urls": [spec["file"]]},
                analyses=[analysis],
            )
            self.assertEqual(res["verified_condition"], spec["expected_condition"],
                             msg=f"{key}: expected {spec['expected_condition']}, got {res['verified_condition']}")

    def test_fixture_files_exist(self):
        with open(FIXTURES) as f:
            fixtures = json.load(f)
        for key, spec in fixtures.items():
            path = os.path.join(ROOT, spec["file"])
            self.assertTrue(os.path.exists(path),
                            msg=f"{key}: fixture image missing at {path}")


if __name__ == "__main__":
    unittest.main()
