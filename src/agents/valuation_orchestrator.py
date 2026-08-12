"""Card valuation orchestrator — end-to-end agent workflow (T18.7).

Ties the T18.2–T18.6 modules into one claimable run:

    claim_next_valuation_request('hermes-agent')
        -> identity gate (T18.2)          -> block if ambiguous
        -> eBay sold search (T18.3)       -> per-listing condition verify (T18.5)
        -> TCGPlayer lookup (T18.4)       -> valuation math (T18.6) -> write result

All I/O is injectable through an :class:`AgentEnv` so the same module runs both
as a standalone entry point (``python -m src.agents.valuation_orchestrator``)
and inside a live Hermes agent loop (the agent supplies ``fetch_page`` /
``vision`` backed by ``web_extract`` / ``browser_*`` / ``vision_analyze``).

Budget guard: every network/vision interaction increments ``env.tool_calls``.
The run aborts (status='failed') rather than overrun the 90-tool-call budget.
Listings are capped at ``MAX_LISTINGS = 10`` (top by recency + trust-anchor).

The Supabase adapter is an abstract :class:`SupabasePort`. Two implementations
ship here:
  * :class:`RestSupabasePort` — production; talks to Supabase PostgREST with the
    SERVICE ROLE key (claim RPC + status PATCH + result INSERT).
  * :class:`PsqlSupabasePort` — local/dev; runs the same SQL against a real
    PostgreSQL via ``psql`` (used by the live smoke test against Postgres 16).
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

# Make the sibling lib modules importable regardless of CWD.
_HERE = os.path.dirname(os.path.abspath(__file__))
_LIB = os.path.join(_HERE, "..", "lib")
for _p in (_HERE, _LIB, os.path.dirname(_HERE)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from ebay_sold_scraper import (  # noqa: E402
    BlockedByEBay,
    BLOCK_HINTS,
    build_search_url,
    is_blocked,
    searchSoldListings,
    fetchListingDetail,
    mergeDetail,
    applyRules,
)
from tcgplayer_scraper import (  # noqa: E402
    CardIdentity as TcgIdentity,
    identity_from_dict as tcg_identity_from_dict,
    HermesFetcher,
    lookupCard as tcg_lookup,
)
from condition_verifier import verifyCondition  # noqa: E402
from valuation_math import synthesizeCurve  # noqa: E402

# ── Tunables ─────────────────────────────────────────────────────────────────
WORKER_NAME = "hermes-agent"
MAX_TOOL_CALLS = 90          # hard budget guard (from the task board)
MAX_LISTINGS = 10            # cap depth; top by recency + trust-anchor
VISION_PROMPT_PATH = os.path.join(_HERE, "..", "prompts", "vision_condition_prompt.md")


class BudgetExceeded(RuntimeError):
    pass


# ── Supabase port ────────────────────────────────────────────────────────────
class SupabasePort(ABC):
    """Minimal data surface the orchestrator needs against the valuation schema."""

    @abstractmethod
    def claim_next(self, worker_name: str) -> Optional[Dict[str, Any]]:
        """Atomically claim one pending request. Returns its row or None."""

    @abstractmethod
    def set_status(self, request_id: Any, status: str, **fields: Any) -> None:
        """Update a request row's status (and started_at/error/completed_at...)."""

    @abstractmethod
    def insert_result(self, request_id: Any, card_identity: dict,
                      price_points: List[dict], condition_curve: dict) -> None:
        """Insert a valuation_results row (1:1 with the request)."""


class RestSupabasePort(SupabasePort):
    """Production adapter — Supabase PostgREST with the service-role key.

    Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from the environment.
    """

    def __init__(self, url: Optional[str] = None,
                 service_role_key: Optional[str] = None):
        self.url = (url or os.environ.get("SUPABASE_URL")
                    or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")).rstrip("/")
        self.key = (service_role_key
                    or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""))
        if not self.url or not self.key:
            raise RuntimeError(
                "RestSupabasePort needs SUPABASE_URL and "
                "SUPABASE_SERVICE_ROLE_KEY in the environment")

    def _headers(self) -> Dict[str, str]:
        return {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }

    def _request(self, method: str, path: str, body: Optional[dict] = None) -> bytes:
        req = urllib.request.Request(
            f"{self.url}{path}", data=json.dumps(body).encode() if body is not None else None,
            headers=self._headers(), method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"Supabase {method} {path}: HTTP {e.code} {e.read()[:300]}")

    def claim_next(self, worker_name: str) -> Optional[Dict[str, Any]]:
        body = json.dumps({"p_worker_name": worker_name}).encode()
        req = urllib.request.Request(
            f"{self.url}/rest/v1/rpc/claim_next_valuation_request",
            data=body, headers=self._headers(), method="POST")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read()
        except urllib.error.HTTPError as e:
            # RPC with no pending row returns 200 + 'null' via a JSON body.
            body_txt = e.read().decode(errors="replace")
            if e.code == 204:
                return None
            raise RuntimeError(f"claim RPC failed: HTTP {e.code} {body_txt[:300]}")
        txt = raw.decode(errors="replace").strip()
        if not txt or txt == "null":
            return None
        return json.loads(txt)

    def set_status(self, request_id: Any, status: str, **fields: Any) -> None:
        patch = {"status": status, **fields}
        self._request("PATCH", f"/rest/v1/valuation_requests?id=eq.{request_id}", patch)

    def insert_result(self, request_id: Any, card_identity: dict,
                      price_points: List[dict], condition_curve: dict) -> None:
        self._request("POST", "/rest/v1/valuation_results", {
            "request_id": request_id,
            "card_identity": card_identity,
            "price_points": price_points,
            "condition_curve": condition_curve,
        })


class PsqlSupabasePort(SupabasePort):
    """Local/dev adapter — runs the same SQL against a real PostgreSQL via psql.

    Used by the integration smoke test against Postgres 16. `conn_args` are
    extra libpq conninfo key=value pairs (host/port/user/dbname...).
    """

    def __init__(self, conn_args: Optional[Dict[str, str]] = None,
                 psql: str = "psql"):
        self.conn = " ".join(f"{k}={v}" for k, v in (conn_args or {}).items())
        self.psql = psql

    def _run(self, sql: str, *args: Any) -> str:
        full = sql if not args else sql
        for a in args:
            full = full.replace("?", repr(a) if isinstance(a, str) else str(a), 1)
        cmd = [self.psql]
        if self.conn:
            cmd += [self.conn]
        cmd += ["-X", "-q", "-t", "-A", "-c", full]
        return subprocess.run(cmd, capture_output=True, text=True, check=True).stdout

    def claim_next(self, worker_name: str) -> Optional[Dict[str, Any]]:
        out = self._run(
            "select to_jsonb(public.claim_next_valuation_request(?))::text",
            worker_name)
        out = out.strip()
        if not out or out == "" or out == "null":
            return None
        return json.loads(out)

    def set_status(self, request_id: Any, status: str, **fields: Any) -> None:
        sets = [f"status = '{status}'"]
        for k, v in fields.items():
            if v is None:
                sets.append(f"{k} = null")
            elif isinstance(v, bool):
                sets.append(f"{k} = {str(v).lower()}")
            elif isinstance(v, (int, float)):
                sets.append(f"{k} = {v}")
            else:
                sets.append(f"{k} = '{str(v).replace(chr(39), chr(39) * 2)}'")
        self._run(f"update public.valuation_requests set {', '.join(sets)} "
                  f"where id = {request_id}")

    def insert_result(self, request_id: Any, card_identity: dict,
                      price_points: List[dict], condition_curve: dict) -> None:
        self._run(
            "insert into public.valuation_results "
            "(request_id, card_identity, price_points, condition_curve) "
            "values (?, ?, ?, ?)",
            request_id,
            json.dumps(card_identity),
            json.dumps(price_points),
            json.dumps(condition_curve),
        )


# ── Environment ──────────────────────────────────────────────────────────────
@dataclass
class AgentEnv:
    """Injected I/O surface. Tests supply mocks; live runs supply real tools."""

    supabase: SupabasePort
    fetch_page: Callable[[str], str]            # url -> page content (web_extract/browser)
    vision: Callable[[str], str]                # photo_url -> vision text (vision_analyze)
    tcg_pages: Dict[str, str] = field(default_factory=dict)  # url -> content for TCG lookup
    resolve_identity: Optional[Callable[[str], dict]] = None
    tool_calls: int = 0
    max_tool_calls: int = MAX_TOOL_CALLS
    max_listings: int = MAX_LISTINGS
    worker_name: str = WORKER_NAME
    vision_prompt: str = ""

    def bump(self, n: int = 1) -> None:
        self.tool_calls += n
        if self.tool_calls > self.max_tool_calls:
            raise BudgetExceeded(
                f"tool-call budget exceeded: {self.tool_calls}/{self.max_tool_calls}")


def default_resolve_identity(query: str, limit: Optional[int] = None) -> dict:
    """Run the node bridge to the T18.2 card-identity gate."""
    here = os.path.dirname(os.path.abspath(__file__))
    script = os.path.join(here, "..", "..", "scripts", "agent-card-identity.mjs")
    cmd = ["node", script, query]
    if limit:
        cmd.append(str(limit))
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise RuntimeError(f"identity bridge failed: {proc.stderr.strip()[:400]}")
    return json.loads(proc.stdout)


def _read_vision_prompt() -> str:
    try:
        with open(VISION_PROMPT_PATH) as f:
            return f.read().strip()
    except OSError:
        return ""


# ── Identity ─────────────────────────────────────────────────────────────────
def _identity_to_ebay(ident: Dict[str, Any]) -> Dict[str, Any]:
    """Map a CardIdentityResult to the ebay scraper's card_identity shape."""
    name = ident.get("canonical_name") or ident.get("name", "")
    return {
        "name": name,
        "card_number": ident.get("card_number") or "",
        "set": ident.get("set_name") or "",
    }


def _identity_to_tcg(ident: Dict[str, Any]) -> TcgIdentity:
    return tcg_identity_from_dict({
        "name": ident.get("canonical_name") or ident.get("name", ""),
        "set_name": ident.get("set_name", ""),
        "card_number": ident.get("card_number", ""),
        "variant": ident.get("variant", ""),
    })


# ── eBay step ────────────────────────────────────────────────────────────────
def _ebay_fetch_and_parse(env: AgentEnv, ident: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Fetch the sold-search page(s) and parse candidate listings (≤ cap).

    Raises BlockedByEBay on a bot wall (documented environmental condition).
    """
    url = build_search_url(ident, page=1)
    env.bump(1)
    content = env.fetch_page(url)
    if is_blocked(content):
        raise BlockedByEBay(
            "eBay sold-search returned a bot-wall/error page. " + BLOCK_HINTS["summary"])

    listings = searchSoldListings(content, ident, content_kind="auto")
    if not listings:
        return []

    # Fetch detail pages for the top MAX_LISTINGS by recency (photos are on the
    # detail page, so we can't require them on the search results). Condition
    # verification later skips listings that still end up photo-less.
    kept = sorted(listings, key=lambda l: l.get("sold_at") or "", reverse=True)[: env.max_listings]
    merged: List[Dict[str, Any]] = []
    for cand in kept:
        try:
            env.bump(1)
            dcontent = env.fetch_page(cand["url"])
            if is_blocked(dcontent):
                continue
            detail = fetchListingDetail(
                dcontent, cand["url"],
                seller_condition_hint=cand.get("seller_condition_claim"))
            merged.append(mergeDetail(cand, detail))
        except Exception:
            # A single listing's detail failure shouldn't sink the run.
            merged.append(cand)
    return applyRules(merged, research_raw=True)


# ── Condition verify step ────────────────────────────────────────────────────
def _verify_listing(env: AgentEnv, listing: Dict[str, Any]) -> Dict[str, Any]:
    """Run T18.5 condition verification for one merged eBay listing.

    Returns the listing augmented with verified_condition / verified_agreement /
    photos_clean / condition_verified / is_trust_anchor (math-friendly keys).
    """
    photos = listing.get("photo_urls") or []
    # Listings with no photos can't be vision-verified; bucket by seller claim.
    if not photos:
        listing.update({
            "verified_condition": listing.get("seller_condition_claim"),
            "condition_verified": False,
            "verified_agreement": False,
            "photos_clean": False,
            "is_trust_anchor": False,
        })
        return listing

    # vision_fn wrapper: inject the strict-JSON system prompt and bump budget.
    def _vision(url: str) -> str:
        env.bump(1)
        text = env.vision(url)
        return text  # the prompt is prepended by the caller, if configured

    result = verifyCondition(
        {"listing_url": listing["url"],
         "seller_condition_claim": listing.get("seller_condition_claim"),
         "photo_urls": photos},
        vision_fn=_vision,
    )
    listing.update({
        "verified_condition": result["verified_condition"],
        "verified_agreement": result["agreement"] == "agrees",
        "photos_clean": not bool(result["defects_observed"]),
        "condition_verified": True,
        "is_trust_anchor": result["is_trust_anchor"],
        "verified_notes": result.get("notes", ""),
    })
    return listing


# ── Math mapping ─────────────────────────────────────────────────────────────
def _to_math_listing(ebay_l: Dict[str, Any]) -> Dict[str, Any]:
    """Map a merged+verified eBay listing to valuation_math's input shape."""
    flags = ebay_l.get("flags") or []
    return {
        "id": ebay_l.get("item_id") or ebay_l.get("url"),
        "price_usd": ebay_l.get("sold_price_usd") or ebay_l.get("listed_price_usd"),
        "url": ebay_l.get("url"),
        "sold_at": ebay_l.get("sold_at"),
        "seller_condition": ebay_l.get("seller_condition_claim"),
        "verified_condition": ebay_l.get("verified_condition"),
        "condition_verified": bool(ebay_l.get("condition_verified")),
        "verified_agreement": bool(ebay_l.get("verified_agreement")),
        "photos_clean": bool(ebay_l.get("photos_clean")),
        # Suspicious duplicates collapse to the most recent sale in the math step.
        "duplicate_group": "dup" if "duplicate_suspicion" in flags else None,
    }


def _to_price_points(ebay_listings: List[Dict[str, Any]],
                     tcg: Dict[str, Any]) -> List[Dict[str, Any]]:
    points: List[Dict[str, Any]] = []
    for l in ebay_listings:
        points.append({
            "source": "ebay",
            "url": l.get("url"),
            "price": l.get("sold_price_usd") or l.get("listed_price_usd"),
            "condition_claimed": l.get("seller_condition_claim"),
            "condition_verified": l.get("verified_condition"),
            "sold_at": l.get("sold_at"),
            "is_best_offer": bool(l.get("is_best_offer")),
            "is_trust_anchor": bool(l.get("is_trust_anchor") or l.get("trust_anchor")),
            "flags": l.get("flags") or [],
        })
    if tcg and tcg.get("product_url"):
        for cond, val in (tcg.get("per_condition") or {}).items():
            if val and val.get("market"):
                points.append({
                    "source": "tcgplayer",
                    "url": tcg["product_url"],
                    "price": val["market"],
                    "condition_claimed": cond,
                    "condition_verified": None,
                    "sold_at": None,
                    "is_best_offer": None,
                    "is_trust_anchor": False,
                    "flags": [],
                })
    return points


# ── Orchestrator ─────────────────────────────────────────────────────────────
def _now() -> str:
    """ISO-8601 timestamp for completed_at (UTC)."""
    return _dt.datetime.now(_dt.timezone.utc).isoformat()


def run_once(env: AgentEnv) -> Dict[str, Any]:
    """Execute one claim-until-done cycle. Returns a status report dict.

    Never raises for business outcomes (blocked/failed/no-work) — those are
    returned as structured reports. Raises only for programmer errors.
    """
    if not env.vision_prompt:
        env.vision_prompt = _read_vision_prompt()

    # 1. Claim.
    try:
        request = env.supabase.claim_next(env.worker_name)
    except Exception as e:  # claim infra failure
        return {"status": "error", "error": f"claim failed: {e}"}
    if request is None:
        return {"status": "no_work"}

    rid = request["id"]
    query = request.get("card_query") or ""

    # 2. Mark running. The claim RPC already set status='claimed' + started_at;
    # promote to 'running' without clobbering the start time.
    try:
        env.supabase.set_status(rid, "running")
    except Exception as e:
        return {"status": "error", "error": f"mark running failed: {e}"}

    try:
        # 3. Identity gate (T18.2).
        if env.resolve_identity is None:
            env.resolve_identity = default_resolve_identity
        env.bump(1)
        ident = env.resolve_identity(query)
        if ident.get("needs_human_confirmation"):
            env.supabase.set_status(
                rid, "blocked", completed_at=_now(),
                error="ambiguous identity; candidates in result for human review",
                )
            return {
                "status": "blocked",
                "request_id": rid,
                "candidates": ident.get("candidates", []),
                "warnings": ident.get("warnings", []),
            }

        # 4. eBay sold listings (T18.3).
        ebay_ident = _identity_to_ebay(ident)
        raw_ebay = _ebay_fetch_and_parse(env, ebay_ident)

        # 5. Condition verification (T18.5) — up to MAX_LISTINGS, batched.
        verified_ebay = [_verify_listing(env, l) for l in raw_ebay]

        # 6. TCGPlayer supplement (T18.4).
        env.bump(1)
        tcg = _tcg_lookup(env, ident)

        # 7. Valuation math (T18.6).
        math_input = {
            "card_identity": ident,
            "ebay_listings": [_to_math_listing(l) for l in verified_ebay],
            "tcgplayer_data": {
                "market_price_usd": tcg.get("market_price_usd"),
                "median_usd": tcg.get("median_usd"),
                "per_condition": tcg.get("per_condition"),
            },
        }
        curve = synthesizeCurve(math_input)

        # 8. Write result + mark done.
        points = _to_price_points(verified_ebay, tcg)
        env.supabase.insert_result(
            rid, ident, points, curve.get("condition_curve", {}))
        env.supabase.set_status(rid, "done", completed_at=_now())
        return {
            "status": "done",
            "request_id": rid,
            "identity": ident,
            "curve": curve,
            "price_point_count": len(points),
            "ebay_listing_count": len(verified_ebay),
            "tool_calls": env.tool_calls,
        }

    except BlockedByEBay as e:
        _fail(env, rid, f"eBay blocked: {e}")
        return {"status": "failed", "request_id": rid, "error": str(e),
                "ebay_blocked": True, "hints": BLOCK_HINTS}
    except BudgetExceeded as e:
        _fail(env, rid, str(e))
        return {"status": "failed", "request_id": rid, "error": str(e)}
    except Exception as e:  # noqa: BLE001 - any downstream failure = failed run
        _fail(env, rid, str(e))
        return {"status": "failed", "request_id": rid, "error": str(e)}


def _tcg_lookup(env: AgentEnv, ident: Dict[str, Any]) -> Dict[str, Any]:
    """TCGPlayer lookup, memoising fetched pages into env.tcg_pages."""
    fetch = HermesFetcher(env.tcg_pages)
    # HermesFetcher raises KeyError if the agent hasn't fetched the page; the
    # live agent pre-fetches via web_extract and stores it. For offline/standalone
    # runs we fall back to env.fetch_page to keep the pipeline self-driving.
    def wrapped_fetch(url: str) -> str:
        if url in env.tcg_pages:
            return env.tcg_pages[url]
        env.bump(1)
        content = env.fetch_page(url)
        env.tcg_pages[url] = content
        return content

    return tcg_lookup(_identity_to_tcg(ident), wrapped_fetch)


def _fail(env: AgentEnv, rid: Any, message: str) -> None:
    try:
        env.supabase.set_status(rid, "failed", completed_at=_now(), error=message)
    except Exception:  # noqa: BLE001 - best-effort; original error is what matters
        pass


def build_env(supabase: Optional[SupabasePort] = None, **overrides: Any) -> AgentEnv:
    """Construct a default AgentEnv. `overrides` become AgentEnv fields.

    The production entry point: wires real fetch_page (needs a live fetch layer
    from the agent's web_extract / browser tools). Without overrides, fetch_page
    is a stub that raises so a miswired live run fails loudly instead of silently
    returning empty data.
    """
    if supabase is None:
        supabase = RestSupabasePort()
    def _no_fetch(url: str) -> str:
        raise RuntimeError(
            "fetch_page not wired: supply env.fetch_page (web_extract/browser) "
            f"before running; attempted {url}")
    return AgentEnv(
        supabase=supabase,
        fetch_page=overrides.pop("fetch_page", _no_fetch),
        vision=overrides.pop("vision",
                             lambda u: (_ for _ in ()).throw(
                                 RuntimeError("vision not wired"))),
        resolve_identity=overrides.pop("resolve_identity", None),
        **overrides,
    )


def main(argv: Optional[List[str]] = None) -> int:
    """CLI: claim-and-run once against a Supabase (service role) backend.

        SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
        python -m src.agents.valuation_orchestrator [--worker NAME]
    """
    args = argv or sys.argv[1:]
    worker = WORKER_NAME
    if args and args[0] == "--worker" and len(args) > 1:
        worker = args[1]

    env = build_env()
    env.worker_name = worker
    report = run_once(env)
    print(json.dumps(report, default=str, indent=2))
    return 0 if report["status"] in ("done", "no_work") else 1


if __name__ == "__main__":
    raise SystemExit(main())
