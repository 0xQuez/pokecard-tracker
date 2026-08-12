"""LIVE smoke test for the valuation orchestrator (T18.7).

Claims a REAL seeded request from a running PostgreSQL 16 (the same schema the
parent T18.1 migration deployed), drives the full pipeline with fixture-backed
eBay/TCG pages + a recorded vision response, writes a REAL valuation_results
row, and marks the request 'done'.

  * supabase  -> real Postgres via PsqlSupabasePort (claim RPC, PATCH, INSERT)
  * ebay/tcg  -> captured fixture pages (live eBay is bot-walled; documented
                 environmental condition in T18.3)
  * vision    -> recorded NM photo observation (fixture)

Run:
    python tests/live/run_orchestrator_smoke.py --dbname pokecards --user postgres

Prereq: a Postgres with the 003_valuation_requests.sql migration applied, e.g.
    /opt/homebrew/opt/postgresql@16/bin/psql -h localhost -U postgres \
        -c "create database pokecards"
    psql -d pokecards -f supabase/migrations/003_valuation_requests.sql
    # + the bootstrap: minimal public.cards table + anon/service_role roles
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src" / "agents"))
sys.path.insert(0, str(ROOT / "src" / "lib"))

from valuation_orchestrator import AgentEnv, PsqlSupabasePort, run_once  # noqa: E402

FIX = ROOT / "tests" / "fixtures"
EBAY_FIX = ROOT / "fixtures"


def build_env(supabase):
    search_html = (EBAY_FIX / "search_results.html").read_text()

    # Same distinct detail pages as the integration test.
    detail_plan = [
        ("335000000001", 1199.00, "Brand New"),
        ("335000000002", 850.00, "Very Good"),
        ("335000000003", 640.00, "Good"),
        ("335000000004", 2400.00, "Brand New"),
        ("335000000005", 505.00, "Brand New"),
    ]
    template = (ROOT / "tests" / "test_valuation_orchestrator.py").read_text()
    # Reuse the exact detail template from the integration test.
    import re
    m = re.search(r'_DETAIL_TEMPLATE = """(.*?)"""', template, re.DOTALL)
    assert m, "could not find detail template"
    detail_tmpl = m.group(1)
    fetch = {"ebay-search": search_html}
    for item_id, price, condition in detail_plan:
        title = f"Dragonite ex 90/97 Pokemon Card EX Dragon 2003 Holo {condition}"
        fetch[f"ebay-detail-{item_id}"] = detail_tmpl.format(
            title=title, price=f"{price:,.2f}", condition=condition)
    fetch["tcg-search"] = (FIX / "search_dragonite_exact.md").read_text()
    fetch["tcg-product"] = (FIX / "product_dragonite_ex.md").read_text()

    def _identity(query):
        return {
            "canonical_name": "Dragonite ex", "set_name": "EX Dragon",
            "card_number": "90/97", "variant": "holo", "confidence": 1.0,
            "needs_human_confirmation": False, "candidates": [], "warnings": [],
        }

    def _fetch_page(url):
        if "sch/i.html" in url:
            return fetch["ebay-search"]
        if "ebay.com/itm" in url:
            item_id = url.rstrip("/").rsplit("/", 1)[-1]
            return fetch[f"ebay-detail-{item_id}"]
        if "tcgplayer.com" in url:
            return fetch["tcg-product"] if "/product/" in url else fetch["tcg-search"]
        return ""

    def _vision(photo_url):
        return json.dumps({
            "corner_whitening": 0.0, "back_whitening": 0.0,
            "surface_scratches": 0.0, "edge_wear": 0.0, "centering_issue": False,
            "creases": False, "stains": False, "notes": "pristine",
        })

    env = AgentEnv(supabase=supabase, fetch_page=_fetch_page, vision=_vision,
                   resolve_identity=_identity,
                   tcg_pages={"tcg-search": fetch["tcg-search"],
                              "tcg-product": fetch["tcg-product"]},
                   max_tool_calls=90, max_listings=5)
    env.vision_prompt = "system prompt (smoke)"
    return env


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dbname", default="pokecards")
    ap.add_argument("--user", default="postgres")
    ap.add_argument("--host", default="localhost")
    ap.add_argument("--port", default="5432")
    ap.add_argument("--worker", default="hermes-agent")
    ap.add_argument("--query", default="Dragonite ex 90/97")
    args = ap.parse_args()

    supabase = PsqlSupabasePort({
        "dbname": args.dbname, "user": args.user,
        "host": args.host, "port": args.port,
    })

    # Clear any prior Dragonite test requests so the claim picks OUR fresh row.
    supabase._run(
        "delete from public.valuation_results where request_id in "
        "(select id from public.valuation_requests where card_query = ?)",
        args.query)
    supabase._run(
        "delete from public.valuation_requests where card_query = ?",
        args.query)

    # Seed a real pending request.
    supabase._run(
        "insert into public.valuation_requests (card_query, user_id, priority) "
        "values (?, ?, 1) returning id", args.query, args.user)
    rid_raw = supabase._run(
        "select id from public.valuation_requests "
        "where card_query = ? order by id desc limit 1", args.query).strip()
    rid = json.loads(rid_raw)
    if isinstance(rid, list):
        rid = rid[0]
    print(f"seeded request id={rid} query={args.query!r}")

    env = build_env(supabase)
    env.worker_name = args.worker
    report = run_once(env)
    print("\nORCHESTRATOR REPORT:")
    print(json.dumps(report, default=str, indent=2))

    if report["status"] != "done":
        print(f"\nSMOKE FAILED: status={report['status']}")
        return 1

    # Verify the DB state for THIS request.
    row = supabase._run(
        "select status, claimed_by, error from public.valuation_requests where id = ?",
        rid).strip()
    print(f"\nrequest row : {row}")
    res = supabase._run(
        "select card_identity::text, price_points::text, condition_curve::text "
        "from public.valuation_results where request_id = ?", rid).strip()
    print(f"result row  : {res[:300]}...")

    curve = json.loads(res.split("|")[2])
    estimates = {c: v.get("estimate_usd") for c, v in curve.items()
                 if v.get("estimate_usd") is not None}
    print(f"\ncurve estimates: {estimates}")
    assert report["request_id"] == rid
    assert report["tool_calls"] <= 90
    assert estimates, "expected at least one condition estimate"
    print("\nSMOKE PASSED — real seeded request claimed, valued, result written.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
