"""Integration test for the valuation orchestrator (T18.7).

Drives the FULL pipeline — claim -> identity -> eBay -> condition verify ->
TCGPlayer -> math -> write result — with a mock Supabase port, mock
fetch_page (serving captured eBay/TCG fixtures), and a mock vision function
(returning the recorded photo observations). Asserts both happy-path and
blocked/failed/no-work outcomes, plus the 90-tool-call budget guard.

Run:  pytest tests/test_valuation_orchestrator.py -q
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "agents"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "lib"))

from valuation_orchestrator import (
    AgentEnv,
    BudgetExceeded,
    SupabasePort,
    run_once,
)

FIX = Path(__file__).resolve().parent / "fixtures"
EBAY_FIX = Path(__file__).resolve().parents[1] / "fixtures"

# ── Mock Supabase port ───────────────────────────────────────────────────────
class MockSupabase(SupabasePort):
    def __init__(self, request=None):
        self.request = request            # the row claim_next returns (or None)
        self.statuses = []                # (request_id, status, fields)
        self.inserted = []                # (request_id, card_identity, points, curve)
        self.fail_claim = False
        self.fail_status = False
        self.fail_insert = False

    def claim_next(self, worker_name):
        if self.fail_claim:
            raise RuntimeError("boom: claim")
        return self.request

    def set_status(self, request_id, status, **fields):
        if self.fail_status:
            raise RuntimeError("boom: status")
        self.statuses.append((request_id, status, fields))

    def insert_result(self, request_id, card_identity, price_points, condition_curve):
        if self.fail_insert:
            raise RuntimeError("boom: insert")
        self.inserted.append((request_id, card_identity, price_points, condition_curve))


def _request(query="Dragonite ex 90/97", rid=1):
    return {"id": rid, "card_query": query, "user_id": "Quez", "priority": 1,
            "status": "pending", "claimed_by": None}


# ── Fixture-backed fetch / vision ────────────────────────────────────────────
_DETAIL_TEMPLATE = """<html><head><title>{title} | eBay</title></head><body>
  <div class="x-item-title"><h1>{title}</h1></div>
  <div class="vim x-price-section"><div class="x-price-primary"><span class="ux-textspans">${price}</span></div></div>
  <div class="x-sellercard-atf__about"><div class="seller-info__name"><span class="ux-textspans">PokeMaster99</span></div></div>
  <div class="ux-labels-values__col"><div class="ux-labels-values__values-content"><span class="ux-textspans">{condition}</span></div></div>
  <div class="x-item-status-info"><span class="ux-textspans">This listing was ended on May 12, 2026</span></div>
  <div class="icv2-image-carousel">
    <img src="https://i.ebayimg.com/images/g/aaa111/s-l1600.jpg" />
    <img src="https://i.ebayimg.com/images/g/bbb222/s-l1600.jpg" />
  </div>
</body></html>"""


def _build_fetch_map():
    """Return {url: content} for the pages the pipeline requests.

    eBay search page comes from the captured HTML; each listing's detail page is
    generated with a DISTINCT price + condition so the math step sees a realistic
    multi-condition sold sample (rather than collapsing to one duplicate).
    TCG search/product pages come from the captured web_extract markdown.
    """
    search_html = (EBAY_FIX / "search_results.html").read_text()
    # Distinct sold listings: (item_id_suffix, price, condition). Realistic spread
    # across NM/LP/MP, plus a graded slab (dropped by applyRules).
    detail_plan = [
        ("335000000001", 1199.00, "Brand New"),     # NM
        ("335000000002", 850.00, "Very Good"),      # LP (best offer)
        ("335000000003", 640.00, "Good"),           # MP
        ("335000000004", 2400.00, "Brand New"),     # graded slab -> dropped
        ("335000000005", 505.00, "Brand New"),      # NM low anchor
    ]

    fetch = {}
    fetch["ebay-search"] = search_html
    for item_id, price, condition in detail_plan:
        title = f"Dragonite ex 90/97 Pokemon Card EX Dragon 2003 Holo {condition}"
        fetch[f"ebay-detail-{item_id}"] = _DETAIL_TEMPLATE.format(
            title=title, price=f"{price:,.2f}", condition=condition)
    # TCGPlayer: search + product pages for Dragonite ex 90/97.
    tcg = {
        "tcg-search":
            (FIX / "search_dragonite_exact.md").read_text(),
        "tcg-product":
            (FIX / "product_dragonite_ex.md").read_text(),
    }
    fetch.update(tcg)
    return fetch


# Vision mock: return the recorded NM photo analysis JSON for any photo URL.
_VISION_NM = json.dumps({
    "corner_whitening": 0.0, "back_whitening": 0.0, "surface_scratches": 0.0,
    "edge_wear": 0.0, "centering_issue": False, "creases": False,
    "stains": False, "notes": "Card appears pristine with sharp corners.",
})


def _build_env(request, fetch_map, *, needs_confirmation=False):
    """Construct an AgentEnv wired to mocks + fixtures."""
    supabase = MockSupabase(request)

    def _identity(query):
        if needs_confirmation:
            return {
                "canonical_name": "Dragonite ex", "set_name": "EX Dragon",
                "card_number": "90/97", "variant": "holo",
                "confidence": 0.4, "needs_human_confirmation": True,
                "candidates": [
                    {"set_name": "EX Dragon", "card_number": "90/97",
                     "name": "Dragonite ex", "confidence": 0.4},
                    {"set_name": "Dragon Frontiers", "card_number": "91/97",
                     "name": "Dragonite ex δ", "confidence": 0.3},
                ],
                "warnings": ["ambiguous print variant"],
            }
        return {
            "canonical_name": "Dragonite ex", "set_name": "EX Dragon",
            "card_number": "90/97", "variant": "holo", "confidence": 1.0,
            "needs_human_confirmation": False, "candidates": [], "warnings": [],
        }

    # fetch_page: route by URL. eBay search/detail URLs are identified by marker.
    def _fetch_page(url):
        if "sch/i.html" in url:
            return fetch_map["ebay-search"]
        if "ebay.com/itm" in url:
            item_id = url.rstrip("/").rsplit("/", 1)[-1]
            return fetch_map[f"ebay-detail-{item_id}"]
        if "tcgplayer.com" in url:
            if "/search/" in url:
                return fetch_map["tcg-search"]
            return fetch_map["tcg-product"]
        return fetch_map.get(url, "")

    tcg_fetch = {"tcg-search": fetch_map["tcg-search"],
                 "tcg-product": fetch_map["tcg-product"]}
    env = AgentEnv(
        supabase=supabase,
        fetch_page=_fetch_page,
        vision=lambda photo_url: _VISION_NM,
        resolve_identity=_identity,
        tcg_pages=tcg_fetch,
        max_tool_calls=90,
        max_listings=5,
    )
    env.vision_prompt = "system prompt (test)"
    return supabase, env


# ── Tests ────────────────────────────────────────────────────────────────────
def test_happy_path_drives_full_pipeline():
    request = _request()
    fetch = _build_fetch_map()
    supabase, env = _build_env(request, fetch)

    report = run_once(env)

    assert report["status"] == "done", report
    assert report["request_id"] == 1
    assert report["ebay_listing_count"] >= 1
    assert report["price_point_count"] >= 1

    # Status lifecycle: running then done.
    statuses = [s for (_, s, _) in supabase.statuses]
    assert statuses[0] == "running"
    assert statuses[-1] == "done"

    # Exactly one result row written, with identity + curve.
    assert len(supabase.inserted) == 1
    rid, card_identity, points, curve = supabase.inserted[0]
    assert rid == 1
    assert card_identity["canonical_name"] == "Dragonite ex"
    assert points and points[0]["source"] in ("ebay", "tcgplayer")
    assert isinstance(curve, dict)
    assert any(v.get("estimate_usd") is not None for v in curve.values())

    # Budget respected.
    assert env.tool_calls <= 90
    assert report["tool_calls"] == env.tool_calls


def test_no_work_when_no_pending_request():
    fetch = _build_fetch_map()
    supabase, env = _build_env(None, fetch)
    report = run_once(env)
    assert report["status"] == "no_work"
    assert not supabase.statuses
    assert not supabase.inserted


def test_ambiguous_identity_blocks_with_candidates():
    request = _request()
    fetch = _build_fetch_map()
    supabase, env = _build_env(request, fetch, needs_confirmation=True)

    report = run_once(env)

    assert report["status"] == "blocked"
    assert len(report["candidates"]) == 2
    # Request marked blocked with human-review error; no result written.
    last_status = supabase.statuses[-1]
    assert last_status[1] == "blocked"
    assert "ambiguous" in last_status[2]["error"]
    assert not supabase.inserted


def test_claim_failure_returns_error():
    request = _request()
    fetch = _build_fetch_map()
    supabase, env = _build_env(request, fetch)
    supabase.fail_claim = True
    report = run_once(env)
    assert report["status"] == "error"
    assert "claim" in report["error"]


def test_downstream_failure_marks_request_failed():
    request = _request()
    fetch = _build_fetch_map()
    supabase, env = _build_env(request, fetch)
    # Force the identity bridge to blow up.
    env.resolve_identity = lambda q: (_ for _ in ()).throw(RuntimeError("catalog down"))
    report = run_once(env)
    assert report["status"] == "failed"
    assert report["error"]
    # Request left in 'failed' with the error text.
    assert supabase.statuses[-1][1] == "failed"
    assert "catalog down" in supabase.statuses[-1][2]["error"]
    assert not supabase.inserted


def test_budget_guard_fails_run_when_exceeded():
    request = _request()
    fetch = _build_fetch_map()
    supabase, env = _build_env(request, fetch)
    env.max_tool_calls = 1  # every bump trips the guard
    report = run_once(env)
    assert report["status"] == "failed"
    assert "budget" in report["error"].lower()
    assert supabase.statuses[-1][1] == "failed"


def test_budget_exceeded_raises_if_unhandled():
    env = AgentEnv(supabase=MockSupabase(), fetch_page=lambda u: "",
                   vision=lambda u: "", max_tool_calls=2)
    env.bump(1)
    env.bump(1)
    try:
        env.bump(1)
        assert False, "should have raised"
    except BudgetExceeded:
        pass
