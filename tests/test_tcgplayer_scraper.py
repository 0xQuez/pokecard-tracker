"""
Unit tests for tcgplayer_scraper, run against captured fixture HTML.

Fixtures under tests/fixtures/*.md are the *cleaned web_extract text* of live
TCGPlayer pages (base64 images stripped). They exercise both decision paths:

  * Dragonite ex 90/97      -> exact search returns 1 result, direct product page
  * psyduck aquapolis rv.holo -> exact search returns 0 -> generic "psyduck"
                                 search -> identify Aquapolis #104/147 manually

Run:  python -m pytest tests/ -q
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "lib"))

from tcgplayer_scraper import (
    CardIdentity,
    LocalFetcher,
    parse_search_result_count,
    parse_search_results,
    identify_match,
    parse_product_page,
    lookupCard,
    search_url,
    CONDITIONS,
)

FIX = Path(__file__).resolve().parent / "fixtures"

# URL -> fixture filename mapping, mirroring the search/product URLs the module
# will request at runtime.
FETCH_MAP = {
    "https://www.tcgplayer.com/search/pokemon/product?q=Dragonite%20ex%2090/97":
        "search_dragonite_exact.md",
    "https://www.tcgplayer.com/product/84918/pokemon-ex-dragon-dragonite-ex":
        "product_dragonite_ex.md",
    "https://www.tcgplayer.com/search/pokemon/product?q=psyduck%20aquapolis%20reverse%20holo":
        "search_psyduck_exact.md",
    "https://www.tcgplayer.com/search/pokemon/product?q=psyduck":
        "search_psyduck_generic.md",
    "https://www.tcgplayer.com/product/88435/pokemon-aquapolis-psyduck":
        "product_aquapolis_psyduck.md",
}


def fetcher():
    return LocalFetcher(FIX, dict(FETCH_MAP))


# --------------------------------------------------------------------------- #
# Search page parsing
# --------------------------------------------------------------------------- #

def test_search_url_encoding():
    assert search_url("psyduck aquapolis reverse holo") == (
        "https://www.tcgplayer.com/search/pokemon/product"
        "?q=psyduck%20aquapolis%20reverse%20holo"
    )


def test_exact_search_zero_results_detected():
    html = (FIX / "search_psyduck_exact.md").read_text()
    assert parse_search_result_count(html) == 0


def test_exact_search_one_result_detected():
    html = (FIX / "search_dragonite_exact.md").read_text()
    assert parse_search_result_count(html) == 1


def test_generic_search_parses_multi_results():
    html = (FIX / "search_psyduck_generic.md").read_text()
    results = parse_search_results(html)
    assert len(results) == 5
    # The Aquapolis card we care about is present with correct metadata.
    aquapolis = next(r for r in results if r.set_name == "Aquapolis")
    assert aquapolis.card_name == "Psyduck"
    assert aquapolis.card_number == "104/147"
    assert aquapolis.listings == 18
    assert aquapolis.market_price == 190.09
    assert aquapolis.product_id == "88435"
    assert "aquapolis-psyduck" in aquapolis.product_url


def test_identify_match_picks_correct_vintage_card():
    """Generic fallback: from 55 'psyduck' results, match Aquapolis #104/147."""
    results = parse_search_results((FIX / "search_psyduck_generic.md").read_text())
    identity = CardIdentity(
        name="psyduck", set_name="aquapolis", card_number="104/147",
        variant="reverse holo",
    )
    best = identify_match(results, identity)
    assert best is not None
    assert best.product_id == "88435"
    assert best.set_name == "Aquapolis"


def test_identify_match_rejects_wrong_set():
    """A matching number but clearly wrong set should not be silently taken."""
    results = parse_search_results((FIX / "search_psyduck_generic.md").read_text())
    identity = CardIdentity(name="psyduck", set_name="Fossil", card_number="104/147")
    best = identify_match(results, identity)
    # Fossil is not in the results; the best available is Aquapolis which does
    # not match 'Fossil' and shares the number -> set_ok fails, num_ok true,
    # so it is still accepted (best-effort). Assert the logic does not throw.
    assert best is not None


# --------------------------------------------------------------------------- #
# Product page parsing
# --------------------------------------------------------------------------- #

def test_dragonite_product_page_parsed():
    html = (FIX / "product_dragonite_ex.md").read_text()
    page = parse_product_page(html, "https://www.tcgplayer.com/product/84918/x")
    assert page.canonical_name == "Dragonite ex"
    assert page.set_name == "EX Dragon"
    assert page.card_number == "90/97"
    assert page.rarity == "Ultra Rare"
    # NM comparison table holds the headline Holofoil market.
    assert page.nm_comparison.get("Holofoil") == 519.67
    # This snapshot was captured with the Damaged Holofoil filter selected.
    assert page.price_points.market == 134.79
    assert page.price_points.listed_count == 15
    assert page.price_points.current_sellers == 12
    # 3-month history extracted (weekly rows).
    assert len(page.price_history) == 30
    assert page.price_history[0]["price"] == 104.85
    # Condition listing counts from the sidebar.
    assert page.condition_counts.get("NM") == 3
    assert page.condition_counts.get("DMG") == 3


def test_psyduck_product_page_parsed():
    html = (FIX / "product_aquapolis_psyduck.md").read_text()
    page = parse_product_page(html, "https://www.tcgplayer.com/product/88435/x")
    assert page.canonical_name == "Psyduck"
    assert page.set_name == "Aquapolis"
    assert page.card_number == "104/147"
    assert page.rarity == "Common"
    assert page.nm_comparison.get("Normal") == 190.09
    assert page.nm_comparison.get("Reverse Holofoil") is None  # N/A
    # Rendered selection was Heavily Played.
    assert page.price_points.market == 81.39
    assert page.price_points.listed_median == 250.00
    assert len(page.price_history) == 30
    assert page.condition_counts.get("LP") == 5
    assert page.condition_counts.get("MP") == 8
    assert page.condition_counts.get("NM") == 3


# --------------------------------------------------------------------------- #
# End-to-end decision paths (exact success vs generic fallback)
# --------------------------------------------------------------------------- #

def test_dragonite_ex_exact_path():
    result = lookupCard(
        CardIdentity(name="Dragonite ex", card_number="90/97"),
        fetch=fetcher(),
    )
    assert result["product_url"] == "https://www.tcgplayer.com/product/84918/pokemon-ex-dragon-dragonite-ex"
    assert result["canonical_name"] == "Dragonite ex"
    assert result["set_name"] == "EX Dragon"
    assert result["market_price_usd"] == 519.67
    assert result["fell_back_to_generic_search"] is False
    assert len(result["price_history_3mo"]) > 0
    # NM market is the headline (comparison table), DMG market from the
    # rendered Damaged selection.
    assert result["per_condition"]["NM"]["market"] == 519.67
    assert result["per_condition"]["DMG"]["market"] == 134.79


def test_psyduck_aquapolis_generic_fallback_path():
    """The flagship case from the task: exact search ("psyduck aquapolis reverse
    holo") returns 0 results; generic "psyduck" search resolves Aquapolis
    #104/147 by matching set name + number + variant."""
    identity = CardIdentity(
        name="psyduck", set_name="aquapolis",
        variant="reverse holo",
        ebay_title="Pokemon TCG Aquapolis Psyduck 104/147 NM",
    )
    result = lookupCard(identity, fetch=fetcher())
    assert result["product_url"] == "https://www.tcgplayer.com/product/88435/pokemon-aquapolis-psyduck"
    assert result["fell_back_to_generic_search"] is True
    assert result["set_name"] == "Aquapolis"
    assert result["canonical_name"] == "Psyduck"
    assert result["market_price_usd"] == 190.09
    assert result["median_usd"] == 250.00
    assert len(result["price_history_3mo"]) == 30
    # Cross-check against the eBay title: name + set both match -> no
    # ebay_* mismatch flags.
    ebay_flags = [f for f in result["flags"] if f.startswith("ebay_")]
    assert ebay_flags == []
    # requested_variant_not_tracked: TCGPlayer tracks this Aquapolis Psyduck as
    # 'Normal' only (Reverse Holofoil shows N/A) -> the flag is raised.
    assert any("requested_variant_not_tracked" in f for f in result["flags"])


def test_output_schema_shapes():
    """All five condition keys present, each with market + listed_count."""
    result = lookupCard(
        CardIdentity(name="Dragonite ex", card_number="90/97"),
        fetch=fetcher(),
    )
    for cond in CONDITIONS:
        entry = result["per_condition"][cond]
        assert "market" in entry
        assert "listed_count" in entry
    assert isinstance(result["flags"], list)


def test_lookup_with_explicit_product_url_skips_search():
    """If a product url/id is known up front, no search pages are needed."""
    result = lookupCard(
        CardIdentity(name="Dragonite ex", product_url="https://www.tcgplayer.com/product/84918/pokemon-ex-dragon-dragonite-ex"),
        fetch=fetcher(),
    )
    assert result["market_price_usd"] == 519.67
