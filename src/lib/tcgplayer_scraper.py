"""
tcgplayer_scraper.py -- TCGPlayer market-price scraper for the Hermes agent loop.

Designed to be invoked BY the Hermes agent (via `web_extract` / `browser_*`
tools), never by raw `fetch()` -- TCGPlayer is JS-heavy and has no accessible
API key. The module is pure parsing + decision logic: the agent fetches pages
and hands the resulting clean text to these functions.

Usage pattern (see README for the full walkthrough):

    from tcgplayer_scraper import lookupCard, CardIdentity, DictFetcher

    identity = CardIdentity(name="psyduck", set_name="Aquapolis",
                            card_number="104/147", variant="Reverse Holofoil")
    result = lookupCard(identity, fetch=my_agent_fetcher)

`fetch` is any callable `(url: str) -> str` returning the cleaned page text.
Two ready-made fetchers ship here:
  * HermesFetcher  -- populate `.pages[url] = <web_extract text>` as the agent
                      fetches, then call lookupCard with fetch=hermes.fetch.
  * LocalFetcher   -- reads fixture files from disk (used by the tests).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field, asdict
from datetime import date, datetime
from pathlib import Path
from typing import Callable, Dict, List, Optional

FetchFn = Callable[[str], str]

# TCGPlayer search base. `?q=` is the only required param; product line is
# optional (omitted = "All Products", which is what returns 0 for vintage).
SEARCH_URL = "https://www.tcgplayer.com/search/pokemon/product?q={query}"

CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"]
# Mapping of the condition names TCGPlayer uses on a product page to the short
# codes in the output schema.
CONDITION_TO_CODE = {
    "Near Mint": "NM",
    "Lightly Played": "LP",
    "Moderately Played": "MP",
    "Heavily Played": "HP",
    "Damaged": "DMG",
}
CODE_TO_NAME = {v: k for k, v in CONDITION_TO_CODE.items()}


@dataclass
class CardIdentity:
    """A *verified* card identity (comes from the collector's own record)."""
    name: str                       # e.g. "psyduck"
    set_name: str = ""              # e.g. "Aquapolis" (best-effort match)
    card_number: str = ""           # e.g. "104/147"
    variant: str = ""               # e.g. "Reverse Holofoil", "Holofoil", ""
    ebay_title: str = ""            # optional cross-check source
    # Optional explicit product id / url when already known (skips search).
    product_id: str = ""
    product_url: str = ""

    def search_query(self) -> str:
        """Exact query = name + set + number + variant, joined with spaces."""
        parts = [self.name]
        if self.set_name:
            parts.append(self.set_name)
        if self.card_number:
            parts.append(self.card_number)
        if self.variant:
            parts.append(self.variant)
        return " ".join(parts)

    def generic_query(self) -> str:
        """Fallback query = just the Pokemon name."""
        return self.name


@dataclass
class SearchResult:
    card_name: str
    set_name: str
    rarity: str = ""
    card_number: str = ""
    listings: int = 0
    listings_from: Optional[float] = None
    market_price: Optional[float] = None
    product_id: str = ""
    product_url: str = ""

    def match_score(self, identity: CardIdentity) -> int:
        """How well this result matches the requested identity (higher=better)."""
        score = 0
        # Set name match (case-insensitive, normalized).
        if identity.set_name and identity.set_name.lower() in self.set_name.lower():
            score += 10
        # Card number match (normalize: strip leading zeros / slashes spacing).
        if identity.card_number and _norm_number(identity.card_number) == _norm_number(self.card_number):
            score += 10
        # Variant hint match against the url slug / set.
        if identity.variant and _norm_variant(identity.variant) in _norm_variant(self.set_name + " " + self.product_url):
            score += 5
        # Exact name token match.
        if self.card_name.lower().startswith(identity.name.lower()):
            score += 2
        return score


# --------------------------------------------------------------------------- #
# URL / normalization helpers
# --------------------------------------------------------------------------- #

def _norm_number(n: str) -> str:
    return re.sub(r"[^0-9/]", "", n)


def _norm_variant(v: str) -> str:
    return re.sub(r"[^a-z]", "", v.lower())


def search_url(query: str) -> str:
    return SEARCH_URL.format(query=query.replace(" ", "%20"))


def product_url_from_id(pid: str) -> str:
    return f"https://www.tcgplayer.com/product/{pid}"


# --------------------------------------------------------------------------- #
# Search results page parsing
# --------------------------------------------------------------------------- #

def parse_search_result_count(html: str) -> int:
    """Return the number of results, or 0 for the '0 results for:' page."""
    # "# N results for: " OR "0 results for: "
    m = re.search(r"#\s*(\d+)\s+results? for:", html)
    if m:
        return int(m.group(1))
    if re.search(r"\b0\s+results?\b", html):
        return 0
    return 0


def parse_search_results(html: str) -> List[SearchResult]:
    """
    Parse a TCGPlayer search page (cleaned web_extract text) into SearchResults.

    Each card is one markdown link whose title carries set / rarity / number /
    name / listings / market price, ending in the product URL:

        [![Psyduck](<img>)\
        \
        **Aquapolis** \
        \
        Common, #104/147\
        \
        Psyduck\
        \
        18 listings from $125.00\
        \
        Market Price:$190.09](https://www.tcgplayer.com/product/88435/...)
    """
    results: List[SearchResult] = []
    # Match the whole per-card link block: image, then title text (non-greedy),
    # then the product URL.
    block_re = re.compile(
        r"\[!\[([^\]]*)\]\([^)]*\)(.*?)\]\((?:https://www\.tcgplayer\.com)?(/product/\d+/[^)]*)\)",
        re.DOTALL,
    )
    for m in block_re.finditer(html):
        alt_name = m.group(1).strip()
        title = m.group(2)
        rel = m.group(3)
        url = rel if rel.startswith("http") else "https://www.tcgplayer.com" + rel
        url = url.split("?", 1)[0]  # strip ?page=N pagination suffix
        pid_m = re.search(r"/product/(\d+)/", url)
        product_id = pid_m.group(1) if pid_m else ""

        set_m = re.search(r"\*\*(.+?)\*\*", title)
        set_name = set_m.group(1).strip() if set_m else ""

        # "Rarity, #num/set" e.g. "Common, #104/147" or "Promo, #007"
        num_m = re.search(r"#(\d+/\d+)", title)
        card_number = num_m.group(1) if num_m else ""

        rare_m = re.search(r"\b([A-Za-z ]+?),\s*#\d+/\d+\b", title)
        rarity = rare_m.group(1).strip() if rare_m else ""

        list_m = re.search(r"(\d+)\s+listings?\s+from\s+\$([\d.,]+)", title)
        listings = int(list_m.group(1)) if list_m else 0
        listings_from = _money(list_m.group(2)) if list_m else None

        mp_m = re.search(r"Market Price:\$([\d.,]+)", title)
        market_price = _money(mp_m.group(1)) if mp_m else None

        # Card name: prefer the explicit line after rarity/number, else the alt.
        card_name = alt_name
        # The title text has the name as its own line; the alt is usually right.
        results.append(SearchResult(
            card_name=card_name,
            set_name=set_name,
            rarity=rarity,
            card_number=card_number,
            listings=listings,
            listings_from=listings_from,
            market_price=market_price,
            product_id=product_id,
            product_url=url,
        ))
    return results


def identify_match(results: List[SearchResult], identity: CardIdentity) -> Optional[SearchResult]:
    """Pick the best matching result, or None if nothing plausibly matches."""
    if not results:
        return None
    ranked = sorted(results, key=lambda r: r.match_score(identity), reverse=True)
    best = ranked[0]
    # Require at least the name to match, and either the set or number to agree.
    if not best.card_name.lower().startswith(identity.name.lower()):
        return None
    set_ok = (not identity.set_name) or identity.set_name.lower() in best.set_name.lower()
    num_ok = (not identity.card_number) or _norm_number(identity.card_number) == _norm_number(best.card_number)
    if set_ok or num_ok:
        return best
    return None


# --------------------------------------------------------------------------- #
# Product page parsing
# --------------------------------------------------------------------------- #

@dataclass
class PricePoint:
    market: Optional[float] = None
    listed_median: Optional[float] = None
    listed_count: Optional[int] = None
    current_sellers: Optional[int] = None
    low_sale: Optional[float] = None
    high_sale: Optional[float] = None
    total_sold: Optional[int] = None
    printing: str = ""


@dataclass
class ProductPage:
    canonical_name: str = ""
    set_name: str = ""
    set_code: str = ""
    card_number: str = ""
    rarity: str = ""
    product_url: str = ""
    product_id: str = ""
    # NM market price per printing: {"Holofoil": 519.67, "Normal": 190.09, ...}
    nm_comparison: Dict[str, Optional[float]] = field(default_factory=dict)
    # Price points for the *currently rendered* condition/printing selection.
    price_points: PricePoint = field(default_factory=PricePoint)
    price_history: List[dict] = field(default_factory=list)
    condition_counts: Dict[str, int] = field(default_factory=dict)


def _money(s: str) -> Optional[float]:
    s = s.replace(",", "").replace("$", "").strip()
    if s in ("", "-", "N/A"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _parse_m_d_date(md: str, today: date) -> date:
    """Parse '8/4' with year inference: assume the most recent occurrence
    relative to today (never in the future)."""
    mm, dd = md.split("/")
    month, day = int(mm), int(dd)
    y = today.year
    if (month, day) > (today.month, today.day):
        y -= 1
    return date(y, month, day)


def parse_product_page(html: str, product_url: str = "") -> ProductPage:
    p = ProductPage(product_url=product_url)
    pid_m = re.search(r"/product/(\d+)/", product_url)
    p.product_id = pid_m.group(1) if pid_m else ""

    # Header title: "# Psyduck - Aquapolis (AQ)" / "# Dragonite ex - EX Dragon (DR)"
    title_m = re.search(r"^#\s+(.+?)\s*-\s*(.+?)\s*\(([^)]+)\)\s*$", html, re.MULTILINE)
    if title_m:
        p.canonical_name = title_m.group(1).strip()
        p.set_name = title_m.group(2).strip()
        p.set_code = title_m.group(3).strip()

    # Product details: card number / rarity. The value is "90/97 / Ultra Rare":
    # number and rarity are separated by " / " while the number itself uses "/".
    cn_m = re.search(r"\*\*Card Number / Rarity:\*\*\s*(.+)", html)
    if cn_m:
        parts = [x.strip() for x in cn_m.group(1).split("/", 1)]
        # Only split on the " / " delimiter (rarity), keep "90/97" intact.
        m = re.match(r"^(\d+/\d+)\s*/\s*(.*)$", cn_m.group(1).strip())
        if m:
            p.card_number, p.rarity = m.group(1), m.group(2).strip()
        else:
            p.card_number = parts[0]
            if len(parts) > 1:
                p.rarity = parts[1]

    # Near Mint Comparison Prices table: rows like
    #   "| Holofoil: | $519.67 |"   or   "| Normal: | $190.09 | Reverse Holofoil: | N/A |"
    nm_block = html.split("Near Mint Comparison Prices", 1)
    if len(nm_block) == 2:
        section = nm_block[1].split("## Price Points", 1)[0]
        for row in re.findall(r"\|\s*([A-Za-z ]+):\s*\|\s*([^|]+?)\s*\|\s*(?:([A-Za-z ]+):\s*\|\s*([^|]+?)\s*\|)?", section):
            label = row[0].strip()
            val = _money(row[1])
            p.nm_comparison[label] = val
            if row[2] and row[3]:
                p.nm_comparison[row[2].strip()] = _money(row[3])

    # Price Points: currently selected condition + listed median / quantity / sellers.
    pp_block = html.split("## Price Points", 1)
    if len(pp_block) == 2:
        section = pp_block[1].split("3 Month Snapshot", 1)[0]
        # The selected condition is the first non-blank line after the heading
        # (e.g. "Damaged Holofoil").
        cond_m = re.search(r"## Price Points[^\n]*\n\n([A-Za-z ]+)", html)
        if cond_m:
            p.price_points.printing = cond_m.group(1).strip()
        med_m = re.search(r"\|\s*Listed Median:\s*\|\s*([^|]+?)\s*\|", section)
        if med_m:
            p.price_points.listed_median = _money(med_m.group(1))
        qty_m = re.search(r"\|\s*Current Quantity:\s*\|\s*(\d+)\s*\|\s*Current Sellers:\s*\|\s*(\d+)\s*\|", section)
        if qty_m:
            p.price_points.listed_count = int(qty_m.group(1))
            p.price_points.current_sellers = int(qty_m.group(2))

    # 3 Month Snapshot.
    snap_block = html.split("3 Month Snapshot", 1)
    if len(snap_block) == 2:
        section = snap_block[1].split("## Market Price History", 1)[0]
        lo_m = re.search(r"\|\s*Low Sale Price:\s*\|\s*([^|]+?)\s*\|\s*High Sale Price:\s*\|\s*([^|]+?)\s*\|", section)
        if lo_m:
            p.price_points.low_sale = _money(lo_m.group(1))
            p.price_points.high_sale = _money(lo_m.group(2))
        sold_m = re.search(r"\|\s*Total Sold:\s*\|\s*(\d+)\s*\|", section)
        if sold_m:
            p.price_points.total_sold = int(sold_m.group(1))

    # Market Price History header: current market price for the selection.
    hist_head = re.search(
        r"## Market Price History\n\n[A-Za-z ]+\n\n\$([\d.,]+)\n\n\(([+-][\d.]+)%\)",
        html,
    )
    if hist_head:
        p.price_points.market = _money(hist_head.group(1))

    # Market Price History table rows: "| 5/14 to 5/16 | $104.85 | $0.00 |"
    # Column 1 header names the printing ("Holofoil"/"Normal"/...).
    today = date.today()
    hist_table = html.split("## Market Price History", 1)
    if len(hist_table) == 2:
        section = hist_table[1]
        for row in re.findall(r"\|\s*(\d{1,2}/\d{1,2})\s+to\s+(\d{1,2}/\d{1,2})\s*\|\s*\$([\d.,]+)\s*\|\s*\$?([\d.,]+)?\s*\|", section):
            start = _parse_m_d_date(row[0], today)
            price = _money(row[2])
            p.price_history.append({
                "week": start.isoformat(),
                "price": price,
            })

    # Condition filter counts (listings sidebar): "Near Mint\n3\nLightly Played\n1..."
    cond_block = html.split("## Condition", 1)
    if len(cond_block) == 2:
        section = cond_block[1].split("## Language", 1)[0]
        for name, code in CONDITION_TO_CODE.items():
            m = re.search(re.escape(name) + r"\s*\n\s*(\d+)", section)
            if m:
                p.condition_counts[code] = int(m.group(1))

    return p


# --------------------------------------------------------------------------- #
# Output assembly
# --------------------------------------------------------------------------- #

def _empty_conditions() -> Dict[str, dict]:
    return {c: {"market": None, "listed_count": 0} for c in CONDITIONS}


def _variant_key(name: str) -> str:
    """Normalize a printing label like 'Reverse Holofoil' to compare variants."""
    return _norm_variant(name)


def build_result(
    identity: CardIdentity,
    page: ProductPage,
    match: Optional[SearchResult],
    fell_back: bool,
) -> dict:
    # Determine primary printing for the headline market price.
    # Prefer the printing that matches identity.variant, else 'Normal'/'Holofoil'
    # whichever exists, else the first NM comparison entry.
    primary_printing = ""
    requested_variant_tracked = False
    if identity.variant:
        for printing in page.nm_comparison:
            if _variant_key(identity.variant) == _variant_key(printing):
                primary_printing = printing
                requested_variant_tracked = True
                break
    if not primary_printing:
        for cand in ("Normal", "Holofoil", "Reverse Holofoil"):
            if cand in page.nm_comparison:
                primary_printing = cand
                break
    if not primary_printing and page.nm_comparison:
        primary_printing = next(iter(page.nm_comparison))

    market_price = page.nm_comparison.get(primary_printing)

    # Build per-condition map.
    per_condition = _empty_conditions()
    # NM market from the comparison table for the primary printing.
    per_condition["NM"]["market"] = market_price
    # listed_count per condition from the condition filter.
    for code, count in page.condition_counts.items():
        per_condition[code]["listed_count"] = count
    # The currently-rendered condition (from Price Points) gets its market
    # price (history header) + listed median + sellers, when present.
    rendered = None
    for name, code in CONDITION_TO_CODE.items():
        if page.price_points.printing.startswith(name):
            rendered = code
            break
    if rendered:
        per_condition[rendered]["market"] = page.price_points.market
        per_condition[rendered]["listed_median"] = page.price_points.listed_median
        per_condition[rendered]["current_sellers"] = page.price_points.current_sellers

    # Variant label for output.
    variant_label = identity.variant or primary_printing or ""

    result = {
        "product_url": page.product_url or (match.product_url if match else ""),
        "canonical_name": page.canonical_name or (match.card_name if match else ""),
        "set_name": page.set_name or (match.set_name if match else ""),
        "variant": variant_label,
        "market_price_usd": market_price,
        "median_usd": page.price_points.listed_median,
        "per_condition": per_condition,
        "price_history_3mo": page.price_history,
        "fell_back_to_generic_search": fell_back,
        "flags": [],
    }

    # --- Decision-rule flags -------------------------------------------------
    if identity.variant and not requested_variant_tracked:
        result["flags"].append(
            f"requested_variant_not_tracked: '{identity.variant}' not found as a "
            f"distinct printing on TCGPlayer; showing primary printing '{primary_printing or 'n/a'}'"
        )
    if not match and page.canonical_name:
        result["flags"].append("no_exact_search_match_resolved_by_product_page")
    if identity.ebay_title:
        flags = crosscheck_ebay(page, identity)
        result["flags"].extend(flags)
    # Flag when fewer than all 5 conditions got a market price (a full sweep
    # requires clicking each condition filter in the browser).
    conditions_with_market = sum(1 for c in CONDITIONS if per_condition[c]["market"] is not None)
    if conditions_with_market < len(CONDITIONS):
        result["flags"].append(
            f"partial_condition_market: {conditions_with_market}/5 conditions have a market "
            f"price; run the condition sweep (browser) to fill the rest"
        )
    return result


def crosscheck_ebay(page: ProductPage, identity: CardIdentity) -> List[str]:
    """Cross-check the resolved TCGPlayer product against an eBay title.

    Mismatched set or variant = suspicious, per decision rule #4.
    """
    if not identity.ebay_title:
        return []
    flags = []
    title_l = identity.ebay_title.lower()
    tcg_name_l = (page.canonical_name or "").lower()
    tcg_set_l = (page.set_name or "").lower()
    # Card name should appear in the eBay title (fuzzy: tokens).
    name_tokens = [t for t in re.split(r"[^a-z0-9]+", tcg_name_l) if len(t) >= 3]
    if name_tokens and not all(t in title_l for t in name_tokens):
        flags.append(f"ebay_title_mismatch: '{identity.ebay_title}' vs TCG '{page.canonical_name}'")
    # Set name should appear, unless it's an acronym-ish match.
    if tcg_set_l and tcg_set_l not in title_l:
        flags.append(f"ebay_set_mismatch: eBay title lacks set '{page.set_name}'")
    return flags


def lookupCard(identity: CardIdentity, fetch: FetchFn) -> dict:
    """
    Full orchestration: exact search -> (generic fallback) -> product page.

    `fetch(url) -> html` must return the cleaned text of a page, exactly as
    `web_extract` / `browser_*` produce it.
    """
    fell_back = False
    match: Optional[SearchResult] = None

    if identity.product_url:
        page_url = identity.product_url
    elif identity.product_id:
        page_url = product_url_from_id(identity.product_id)
    else:
        # 1. Exact search.
        exact_url = search_url(identity.search_query())
        exact_html = fetch(exact_url)
        count = parse_search_result_count(exact_html)
        if count == 0:
            # 2. Generic fallback: just the Pokemon name.
            fell_back = True
            generic_url = search_url(identity.generic_query())
            generic_html = fetch(generic_url)
            matches = parse_search_results(generic_html)
            match = identify_match(matches, identity)
            if not match:
                raise LookupError(
                    f"generic fallback for '{identity.name}' found no card matching "
                    f"set={identity.set_name!r} number={identity.card_number!r}"
                )
            page_url = match.product_url
        else:
            matches = parse_search_results(exact_html)
            if len(matches) == 1:
                match = matches[0]
                page_url = match.product_url
            elif len(matches) > 1:
                match = identify_match(matches, identity)
                if match:
                    page_url = match.product_url
                else:
                    # Ambiguous multiple results on exact query: fall back generic.
                    fell_back = True
                    generic_html = fetch(search_url(identity.generic_query()))
                    match = identify_match(parse_search_results(generic_html), identity)
                    if not match:
                        raise LookupError("ambiguous exact results and no generic match")
                    page_url = match.product_url

    page_html = fetch(page_url)
    page = parse_product_page(page_html, page_url)
    return build_result(identity, page, match, fell_back)


# --------------------------------------------------------------------------- #
# Fetchers
# --------------------------------------------------------------------------- #

class HermesFetcher:
    """
    The documented agent-loop fetcher.

    As the agent runs `web_extract` / `browser_*`, it stores each page's cleaned
    text under its URL here; `lookupCard` then reads from this dict.

        hf = HermesFetcher()
        # agent fetches... hf.pages[url] = <result of web_extract(url)>
        result = lookupCard(identity, fetch=hf.fetch)
    """
    def __init__(self, pages: Optional[Dict[str, str]] = None):
        self.pages = pages if pages is not None else {}

    def fetch(self, url: str) -> str:
        if url not in self.pages:
            raise KeyError(
                f"No fetched page for {url}. The agent must call web_extract/"
                f"browser on this URL first and store it in the fetcher."
            )
        return self.pages[url]

    def __call__(self, url: str) -> str:
        return self.fetch(url)


class LocalFetcher:
    """Read fixture files from disk keyed by filename (used by tests / offline)."""

    def __init__(self, base: Path, mapping: Dict[str, str]):
        # mapping: url -> fixture filename (relative to base)
        self.base = base
        self.mapping = mapping

    def fetch(self, url: str) -> str:
        fn = self.mapping.get(url)
        if fn is None:
            raise KeyError(f"No fixture for {url}")
        return (self.base / fn).read_text()

    def __call__(self, url: str) -> str:
        return self.fetch(url)


def identity_from_dict(d: dict) -> CardIdentity:
    return CardIdentity(
        name=d["name"],
        set_name=d.get("set_name", ""),
        card_number=d.get("card_number", ""),
        variant=d.get("variant", ""),
        ebay_title=d.get("ebay_title", ""),
        product_id=d.get("product_id", ""),
        product_url=d.get("product_url", ""),
    )


if __name__ == "__main__":
    import sys

    if len(sys.argv) >= 2 and sys.argv[1] == "self-test":
        # Quick sanity check against the packaged fixtures.
        import pathlib
        base = pathlib.Path(__file__).resolve().parents[2] / "tests" / "fixtures"
        fetcher = LocalFetcher(base, {
            "https://www.tcgplayer.com/search/pokemon/product?q=Dragonite%20ex%2090/97": "search_dragonite_exact.md",
            "https://www.tcgplayer.com/product/84918/pokemon-ex-dragon-dragonite-ex": "product_dragonite_ex.md",
            "https://www.tcgplayer.com/search/pokemon/product?q=psyduck%20aquapolis%20reverse%20holo": "search_psyduck_exact.md",
            "https://www.tcgplayer.com/search/pokemon/product?q=psyduck": "search_psyduck_generic.md",
            "https://www.tcgplayer.com/product/88435/pokemon-aquapolis-psyduck": "product_aquapolis_psyduck.md",
        })
        dragonite = lookupCard(
            CardIdentity(name="Dragonite ex", card_number="90/97"),
            fetch=fetcher,
        )
        psyduck = lookupCard(
            CardIdentity(name="psyduck", set_name="aquapolis", variant="reverse holo",
                         ebay_title="Pokemon TCG Aquapolis Psyduck 104/147 NM"),
            fetch=fetcher,
        )
        print(json.dumps({"dragonite_ex": dragonite, "psyduck_aquapolis": psyduck}, indent=2))
