"""Tests for src/lib/ebay_sold_scraper.py — run: python3 -m unittest."""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "src", "lib"))

from ebay_sold_scraper import (  # noqa: E402
    BlockedByEBay,
    applyRules,
    build_search_url,
    classify_condition,
    fetchListingDetail,
    is_blocked,
    mergeDetail,
    searchSoldListings,
    to_report,
)

FIX = os.path.join(HERE, "..", "fixtures")

IDENT = {"name": "Dragonite ex", "card_number": "90/97", "set": "EX Dragon"}


def _load(name):
    with open(os.path.join(FIX, name)) as f:
        return f.read()


class TestBuildUrl(unittest.TestCase):
    def test_sold_filter_is_mandatory(self):
        url = build_search_url(IDENT)
        self.assertIn("LH_Sold=1", url)
        self.assertIn("LH_Complete=1", url)
        self.assertIn("_nkw=", url)
        self.assertIn("Dragonite+ex+90%2F97", url)

    def test_pagination(self):
        self.assertIn("_pgn=3", build_search_url(IDENT, page=3))

    def test_quoted_query(self):
        # canonical name + card number go into the query
        self.assertIn("%22Dragonite+ex+90%2F97%22", build_search_url(IDENT)
                      .replace("_nkw=", "")) or self.assertTrue(
            "Dragonite+ex+90%2F97" in build_search_url(IDENT))


class TestBlockDetection(unittest.TestCase):
    def test_firecrawl_challenge_detected(self):
        self.assertTrue(is_blocked(_load("blocked.html")))

    def test_normal_page_not_blocked(self):
        self.assertFalse(is_blocked(_load("search_markdown.md")))

    def test_raises_on_blocked_search(self):
        with self.assertRaises(BlockedByEBay):
            searchSoldListings(_load("blocked.html"), IDENT)


class TestSearchParseHtml(unittest.TestCase):
    def setUp(self):
        self.listings = searchSoldListings(_load("search_results.html"), IDENT)
        self.final = applyRules(self.listings)

    def test_extracts_expected_candidates(self):
        # HTML fixture has 5 cards; range one is dropped at parse time.
        titles = [L["title"] for L in self.listings]
        self.assertIn("Dragonite ex 90/97 Pokemon Card EX Dragon 2003 Holo Near Mint",
                      titles)
        self.assertIn("Dragonite ex 90/97 PSA 9 EX Dragon Pokemon Card Graded",
                      titles)

    def test_range_price_skipped(self):
        for L in self.listings:
            if "Lot of 2" in L["title"]:
                self.fail("range-priced listing must be dropped, got %r" % L)

    def test_single_price_point(self):
        for L in self.listings:
            self.assertIsInstance(L["sold_price_usd"], float)
            self.assertNotIn("-", L["title"])  # not a range title

    def test_graded_flagged(self):
        graded = [L for L in self.listings if L["is_graded"]]
        self.assertTrue(graded)
        self.assertEqual(graded[0]["grade_info"], "PSA 9")

    def test_best_offer_detected(self):
        bo = [L for L in self.listings if L["is_best_offer"]]
        self.assertEqual(len(bo), 1)
        self.assertIn("or best offer", bo[0]["title"].lower())

    def test_apply_rules_drops_graded_when_raw(self):
        # 5 candidates, 1 range (dropped at parse) -> 4 parsed; graded drops
        # -> 3 usable
        self.assertEqual(len(self.final), 3)

    def test_duplicate_flagged(self):
        dups = [L for L in self.final if "duplicate_suspicion" in L["flags"]]
        self.assertEqual(len(dups), 1)

    def test_trust_anchor_after_detail_merge(self):
        # Search cards have unknown condition; trust_anchor comes only after
        # the detail page confirms condition AND provides photos.
        first = self.listings[0]
        detail = fetchListingDetail(
            _load("listing_detail.html"), first["url"])
        merged = mergeDetail(first, detail)
        self.assertTrue(merged["trust_anchor"])
        self.assertIn("trust_anchor", merged["flags"])
        self.assertEqual(merged["seller_condition_claim"], "NM")
        self.assertEqual(len(merged["photo_urls"]), 3)

    def test_item_ids(self):
        ids = {L["item_id"] for L in self.listings}
        self.assertIn("335000000001", ids)
        self.assertIn("335000000005", ids)

    def test_sold_date_iso(self):
        d = [L for L in self.listings if L["item_id"] == "335000000001"][0]
        self.assertEqual(d["sold_at"], "2026-05-12")


class TestSearchParseMarkdown(unittest.TestCase):
    def setUp(self):
        self.listings = searchSoldListings(_load("search_markdown.md"), IDENT)
        self.final = applyRules(self.listings)

    def test_same_shape_as_html(self):
        # range + graded dropped -> 3 usable
        self.assertEqual(len(self.final), 3)
        self.assertEqual(len(self.listings), 4)  # 5 cards, range dropped

    def test_duplicate_detected_in_markdown(self):
        dups = [L for L in self.final if "duplicate_suspicion" in L["flags"]]
        self.assertEqual(len(dups), 1)

    def test_report_shape(self):
        rep = to_report(self.listings)  # raw candidates incl. graded
        self.assertEqual(rep["usable_sold_listings"], 3)
        self.assertEqual(rep["best_offer_count"], 1)
        self.assertEqual(rep["graded_excluded"], 1)
        self.assertIn("price_usd_median", rep)


class TestDetailParse(unittest.TestCase):
    def setUp(self):
        self.d = fetchListingDetail(
            _load("listing_detail.html"),
            "https://www.ebay.com/itm/335000000001",
        )

    def test_fields(self):
        self.assertEqual(self.d["title"],
                         "Dragonite ex 90/97 Pokemon Card EX Dragon 2003 Holo Near Mint")
        self.assertEqual(self.d["sold_price_usd"], 1199.00)
        self.assertEqual(self.d["listed_price_usd"], 1199.00)
        self.assertEqual(self.d["seller"]["name"], "PokeMaster99")
        self.assertEqual(self.d["seller_condition_claim"], "NM")
        self.assertEqual(self.d["sold_at"], "2026-05-12")
        self.assertFalse(self.d["is_best_offer"])

    def test_photos(self):
        self.assertEqual(len(self.d["photo_urls"]), 3)
        self.assertTrue(self.d["photo_urls"][0].startswith("https://i.ebayimg.com"))


class TestBestOfferDetail(unittest.TestCase):
    def setUp(self):
        self.d = fetchListingDetail(
            _load("listing_detail_bestoffer.html"),
            "https://www.ebay.com/itm/335000000002",
        )

    def test_best_offer_captures_ask_and_flag(self):
        self.assertTrue(self.d["is_best_offer"])
        self.assertEqual(self.d["listed_price_usd"], 850.00)
        self.assertEqual(self.d["sold_price_usd"], 850.00)  # ask, unless a
        # distinct "sold for $X" is visible
        self.assertEqual(self.d["seller"]["name"], "CardShack2020")
        self.assertEqual(self.d["seller_condition_claim"], "LP")
        self.assertEqual(self.d["sold_at"], "2026-05-08")
        self.assertEqual(len(self.d["photo_urls"]), 2)


class TestCondition(unittest.TestCase):
    def test_classification(self):
        self.assertEqual(classify_condition("Near Mint or Better"), "NM")
        self.assertEqual(classify_condition("Lightly Played"), "LP")
        self.assertEqual(classify_condition("Moderately Played"), "MP")
        self.assertEqual(classify_condition("Heavily Played"), "HP")
        self.assertEqual(classify_condition("Damaged"), "DMG")
        self.assertEqual(classify_condition("Used"), "used")
        self.assertEqual(classify_condition("unknown thing here"), "unknown")


class TestSCardSearchParse(unittest.TestCase):
    """Current-gen eBay SRP: `.s-card` items inside `.srp-results` (T18.10)."""

    def setUp(self):
        self.ident = {"name": "Charmander 044", "card_number": "044",
                      "set": "Scarlet & Violet Promo"}
        self.html = _load("scard_search.html")
        self.listings = searchSoldListings(self.html, self.ident)
        self.final = applyRules(self.listings)

    def test_parses_scard_candidates(self):
        # 5 real cards in the fixture (no CTA/furniture blocks captured).
        self.assertGreaterEqual(len(self.listings), 5)
        titles = [L["title"] for L in self.listings]
        self.assertIn("Charmander 044 - Scarlet & Violet - Obsidian Flames "
                      "ETB PROMO SEALED", titles)

    def test_scard_title_suffix_stripped(self):
        for L in self.listings:
            self.assertNotIn("Opens in a new window", L["title"])

    def test_scard_price_and_sold_date(self):
        # $80.97 best-offer sale, sold Aug 12 2026.
        target = next(L for L in self.listings if L["item_id"] == "128013951556")
        self.assertEqual(target["sold_price_usd"], 80.97)
        self.assertEqual(target["sold_at"], "2026-08-12")
        self.assertTrue(target["is_best_offer"])

    def test_scard_condition_and_seller(self):
        target = next(L for L in self.listings if L["item_id"] == "128013951556")
        self.assertEqual(target["seller_condition_claim"], "used")  # Pre-Owned
        self.assertEqual(target["seller"]["name"], "guyvernoidxcollectingtcg")
        self.assertEqual(target["seller"]["feedback_count"], 198)

    def test_scard_nm_condition(self):
        nm = [L for L in self.listings if L["seller_condition_claim"] == "NM"]
        self.assertTrue(nm, "expected at least one NM listing")
        self.assertTrue(any("Pokémon TCG" in L["title"] for L in nm))

    def test_scard_thumbnail_photo(self):
        with_photo = [L for L in self.listings if L["photo_urls"]]
        self.assertTrue(with_photo)
        self.assertTrue(with_photo[0]["photo_urls"][0].startswith(
            "https://i.ebayimg.com"))

    def test_scard_apply_rules_keeps_usable(self):
        self.assertGreaterEqual(len(self.final), 1)


class TestSCardBlockDetection(unittest.TestCase):
    """is_blocked must NOT false-positive on real rendered SRP pages (the
    current page embeds `.ifh-captcha` CSS + a recaptcha iframe)."""

    def test_real_scard_page_not_blocked(self):
        # Full 2.2MB rendered charmander SRP page captured live via CDP.
        html = _load("live/charmander_sold_search.html")
        self.assertFalse(is_blocked(html))
        listings = searchSoldListings(html, IDENT)
        self.assertGreaterEqual(len(listings), 40)

    def test_real_detail_page_not_blocked(self):
        html = _load("live/charmander_detail.html")
        self.assertFalse(is_blocked(html))


class TestSCardDetailParse(unittest.TestCase):
    """fetchListingDetail against the current live detail DOM."""

    def setUp(self):
        self.html = _load("live/charmander_detail.html")
        self.d = fetchListingDetail(
            self.html, "https://www.ebay.com/itm/128013951556",
            content_kind="html")

    def test_price_prefers_usd_approx(self):
        # UK listing shows GBP 60.00 primary + "approximately US $80.97".
        self.assertEqual(self.d["sold_price_usd"], 80.97)
        self.assertTrue(self.d["is_best_offer"])

    def test_title_and_sold_date(self):
        self.assertIn("Charmander 044", self.d["title"])
        self.assertEqual(self.d["sold_at"], "2026-08-12")

    def test_seller_name_from_seller_card(self):
        self.assertEqual(self.d["seller"]["name"],
                         "guyvernoidxcollectingtcg")
        self.assertEqual(self.d["seller"]["feedback_count"], 198)

    def test_photos_extracted(self):
        self.assertGreaterEqual(len(self.d["photo_urls"]), 3)
        self.assertTrue(self.d["photo_urls"][0].startswith("https://i.ebayimg.com"))


if __name__ == "__main__":
    unittest.main()
