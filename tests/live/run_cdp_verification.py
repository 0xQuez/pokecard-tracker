"""LIVE end-to-end verification of the T18.10 CDP path (charmander 044).

Drives the REAL pipeline against live sources through the new wiring:
  * eBay sold search + detail  -> local CDP browser (port 9222), not fetch()
  * TCGPlayer                  -> Firecrawl markdown (the verified web_extract path)
  * condition math             -> valuation_math.synthesizeCurve
Writes a real valuation_results row to the LOCAL Postgres pokecards DB so the
schema insert path is exercised too. The T18.2 identity gate is overridden
because the catalog has no charmander match (it would otherwise block the run
as needs_human_confirmation — a separate, correct gate).

Run:
    FIRECRAWL_API_KEY=... python tests/live/run_cdp_verification.py
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src" / "agents"))
sys.path.insert(0, str(ROOT / "src" / "lib"))

from cdp_fetch import fetch_page, cdp_reachable  # noqa: E402
from ebay_sold_scraper import build_search_url  # noqa: E402
from valuation_orchestrator import (  # noqa: E402
    AgentEnv, PsqlSupabasePort, _ebay_fetch_and_parse, _tcg_lookup,
    _to_price_points, _to_math_listing, _verify_listing,
)
from valuation_math import synthesizeCurve  # noqa: E402

QUERY = "charmander 044 sv scarlet violet promo"

# Resolved identity (overriding the T18.2 gate for this live verification —
# catalog has no charmander SV promo entry; needs_human_confirmation=True is the
# correct gate output for this card, which is out of scope for T18.10). Name is
# set to the exact task query so build_search_url produces the clean search.
IDENT = {
    "canonical_name": "Charmander",           # TCG lists it as "Charmander - 044"
    "set_name": "Scarlet & Violet Promo Cards",
    "card_number": "044",
    "variant": "",                            # holo isn't a TCGPlayer printing term
    "confidence": 0.8,
    "needs_human_confirmation": False,
    "candidates": [], "warnings": [],
}

# eBay search uses the exact task query phrase for best matching.
EBAY_SEARCH_PHRASE = "charmander 044 sv scarlet violet promo"


def _vision_stub(photo_url: str) -> str:
    """Vision is not wired in this headless run; return a clean-NM observation
    so the condition-verify step proceeds with the seller's claimed condition
    as the verified anchor (photos_clean=True, verified_condition=seller claim).
    """
    return json.dumps({
        "corner_whitening": 0.0, "back_whitening": 0.0,
        "surface_scratches": 0.0, "edge_wear": 0.0,
        "centering_issue": False, "creases": False, "stains": False,
        "notes": "no defects observed (live CDP verification stub)",
    })


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dbname", default="pokecards")
    ap.add_argument("--user", default="postgres")
    ap.add_argument("--limit", type=int, default=8)
    ap.add_argument("--write-db", action="store_true",
                    help="actually insert a valuation_results row")
    args = ap.parse_args()

    if not cdp_reachable():
        print("FATAL: local CDP browser not reachable on :9222")
        return 1

    ebay_ident = {"name": EBAY_SEARCH_PHRASE, "card_number": "", "set": ""}
    url = build_search_url(ebay_ident)
    print(f"[1] eBay sold search via CDP: {url}")

    env = AgentEnv(supabase=None, fetch_page=fetch_page, vision=_vision_stub,
                   max_tool_calls=400, max_listings=args.limit)

    raw = _ebay_fetch_and_parse(env, ebay_ident)
    print(f"    parsed {len(raw)} sold listings via CDP\n")
    for l in raw[:10]:
        print(f"    - ${l['sold_price_usd']:<8} {l['seller_condition_claim']:<5} "
              f"{l.get('sold_at')}  {l['title'][:55]}")

    if not raw:
        print("FATAL: no listings parsed from the live CDP eBay page")
        return 1

    verified = [_verify_listing(env, l) for l in raw]
    conds = {}
    for l in verified:
        c = l.get("verified_condition") or l.get("seller_condition_claim") or "unknown"
        conds.setdefault(c, []).append(l["sold_price_usd"])
    print("\n[2] per-condition sold prices (seller claim, vision stub):")
    for c, prices in sorted(conds.items()):
        print(f"    {c:<8} n={len(prices):<2} min=${min(prices)} "
              f"median=${sorted(prices)[len(prices)//2]} max=${max(prices)}")

    print("\n[3] TCGPlayer via Firecrawl...")
    tcg = _tcg_lookup(env, IDENT)
    print(f"    product: {tcg.get('canonical_name')} @ {tcg.get('product_url')}")
    print(f"    market:  ${tcg.get('market_price_usd')}  median: ${tcg.get('median_usd')}")
    tcg_conds = {k: v.get("market") for k, v in (tcg.get("per_condition") or {}).items()
                 if v.get("market")}
    print(f"    TCG per-condition market: {tcg_conds}")

    print("\n[4] valuation math...")
    math_input = {
        "card_identity": IDENT,
        "ebay_listings": [_to_math_listing(l) for l in verified],
        "tcgplayer_data": {
            "market_price_usd": tcg.get("market_price_usd"),
            "median_usd": tcg.get("median_usd"),
            "per_condition": tcg.get("per_condition"),
        },
    }
    curve = synthesizeCurve(math_input)
    cc = curve.get("condition_curve", {})
    print("    per-condition estimates (USD):")
    for c, v in cc.items():
        if v and v.get("estimate_usd") is not None:
            print(f"      {c:<4} -> ${v['estimate_usd']:<8} "
                  f"(points={v.get('price_points_used')})")

    points = _to_price_points(verified, tcg)
    print(f"\n[5] price points: {len(points)} total "
          f"({sum(1 for p in points if p['source']=='ebay')} eBay, "
          f"{sum(1 for p in points if p['source']=='tcgplayer')} TCGPlayer)")

    if args.write_db:
        supabase = PsqlSupabasePort({"dbname": args.dbname, "user": args.user})
        supabase._run(
            "delete from public.valuation_results where request_id in "
            "(select id from public.valuation_requests where card_query = ?)",
            QUERY)
        supabase._run("delete from public.valuation_requests where card_query = ?",
                      QUERY)
        rid_raw = supabase._run(
            "insert into public.valuation_requests (card_query, user_id, priority) "
            "values (?, 'verification', 1) returning id", QUERY).strip()
        rid = json.loads(rid_raw)
        if isinstance(rid, list):
            rid = rid[0]
        supabase.insert_result(rid, IDENT, points, cc)
        row = supabase._run(
            "select id, card_identity::text, price_points::text from "
            "public.valuation_results where request_id = ?", rid).strip()
        print(f"    wrote valuation_results row {rid} to local postgres "
              f"({len(row)} bytes)")
    else:
        print("    (skipped DB write; pass --write-db to persist)")

    est = {c: v.get("estimate_usd") for c, v in cc.items() if v and v.get("estimate_usd")}
    ok = bool(raw) and bool(est)
    print(f"\nRESULT: {'PASS' if ok else 'FAIL'} — real CDP eBay sold data "
          f"({len(raw)} listings) + TCG ({len(tcg_conds)} conds) -> "
          f"{len(est)} condition estimates")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
