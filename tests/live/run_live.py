"""LIVE acceptance test.

Runs lookupCard end-to-end against pages that were actually fetched from
tcgplayer.com in THIS session via the Hermes web_extract tool (cached under the
profile cache dir / tests/live). Proves both acceptance criteria:

  1. Dragonite ex 90/97  -> exact search resolves, structured result
  2. psyduck aquapolis reverse holo -> 0 exact results -> generic fallback

NOTE: this is an *agent-session* test, not a portable unit test. It depends on
pages the agent fetched during the same session (web_extract truncation cache
under the profile cache dir, plus the inline search pages saved to tests/live/).
It is run manually by an agent after fetching the pages, e.g.:

    python tests/live/run_live.py

The portable, offline test suite is tests/test_tcgplayer_scraper.py.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, "src/lib")
from tcgplayer_scraper import (
    HermesFetcher, LocalFetcher, lookupCard, CardIdentity, search_url,
)

CACHE = Path.home() / ".hermes/profiles/coding/cache/web"
LIVE = Path("tests/live")

# Which fetched page feeds each URL. Search pages that were returned inline are
# in tests/live; the large product pages are cached from web_extract truncation.
mapping = {
    search_url("Dragonite ex 90/97"):
        LIVE / "search_dragonite_exact_live.md",
    "https://www.tcgplayer.com/product/84918/pokemon-ex-dragon-dragonite-ex":
        CACHE / "www.tcgplayer.com-899cfef5bd.md",
    search_url("psyduck aquapolis reverse holo"):
        LIVE / "search_psyduck_exact_live.md",
    search_url("psyduck"):
        CACHE / "www.tcgplayer.com-8c997b9874.md",
    "https://www.tcgplayer.com/product/88435/pokemon-aquapolis-psyduck":
        CACHE / "www.tcgplayer.com-6274608f79.md",
}

# Sanity: every mapped file exists.
for url, f in mapping.items():
    assert f.exists(), f"missing {f}"
    print(f"  live page OK  {len(f.read_text())}B  <- {f.name}  {url[:70]}")

def _fetch(url):
    f = mapping[url]
    return f.read_text()

print("\n" + "=" * 72)
print("CASE 1  Dragonite ex 90/97  (exact-search path)")
print("=" * 72)
r1 = lookupCard(CardIdentity(name="Dragonite ex", card_number="90/97"), fetch=_fetch)
print(json.dumps({
    "product_url": r1["product_url"],
    "canonical_name": r1["canonical_name"],
    "set_name": r1["set_name"],
    "market_price_usd": r1["market_price_usd"],
    "fell_back_to_generic_search": r1["fell_back_to_generic_search"],
    "per_condition_NM_market": r1["per_condition"]["NM"]["market"],
    "history_rows": len(r1["price_history_3mo"]),
    "flags": r1["flags"],
}, indent=2))
assert "/84918/" in r1["product_url"]
assert r1["market_price_usd"] == 519.67
assert r1["fell_back_to_generic_search"] is False
assert len(r1["price_history_3mo"]) == 30

print("\n" + "=" * 72)
print("CASE 2  psyduck aquapolis reverse holo  (generic-search fallback)")
print("=" * 72)
identity = CardIdentity(
    name="psyduck", set_name="aquapolis", variant="reverse holo",
    ebay_title="Pokemon TCG Aquapolis Psyduck 104/147 NM",
)
r2 = lookupCard(identity, fetch=_fetch)
print(json.dumps({
    "product_url": r2["product_url"],
    "canonical_name": r2["canonical_name"],
    "set_name": r2["set_name"],
    "market_price_usd": r2["market_price_usd"],
    "median_usd": r2["median_usd"],
    "fell_back_to_generic_search": r2["fell_back_to_generic_search"],
    "per_condition": r2["per_condition"],
    "history_rows": len(r2["price_history_3mo"]),
    "ebay_flags": [f for f in r2["flags"] if f.startswith("ebay_")],
}, indent=2))
assert "/88435/" in r2["product_url"]
assert r2["set_name"] == "Aquapolis"
assert r2["fell_back_to_generic_search"] is True
assert r2["market_price_usd"] == 190.09
assert len(r2["price_history_3mo"]) == 30
assert not [f for f in r2["flags"] if f.startswith("ebay_")]

print("\nALL LIVE ACCEPTANCE ASSERTIONS PASSED")
