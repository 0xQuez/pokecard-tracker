#!/usr/bin/env python3
"""
eBay sold-listings scraper for the Hermes agent loop (T18.3).

This module is a PARSING + RULES library. It never does the network fetch
itself: eBay's search/listing pages are JS-heavy and IP-block datacenter
traffic, so the *Hermes agent* must drive the network via the `web_extract`
(Firecrawl) or `browser_*` tools. The agent hands the returned page content
to the functions in this module, which turn it into structured sold listings.

Two content kinds are accepted everywhere:
  - content_kind="markdown" : the cleaned text/markdown `web_extract` returns.
                             (Primary path for a real agent loop.)
  - content_kind="html"     : raw HTML, e.g. from curl or a `browser_console`
                             `document.documentElement.outerHTML` grab.
  - content_kind="auto"     : sniff which of the two it looks like (default).

Public API
----------
  build_search_url(card_identity, page=1)     -> str
  build_detail_url(item_id)                   -> str
  is_blocked(content)                         -> bool   (CAPTCHA / 403 / bot wall)
  BLOCK_HINTS                                 -> dict   (human-readable guidance)
  searchSoldListings(content, card_identity,
                     content_kind="auto")     -> list[dict]  (candidate listings)
  fetchListingDetail(content, url,
                     content_kind="auto")     -> dict   (one listing detail)
  applyRules(listings)                        -> list[dict] (filters+flags+dupes)
  to_report(listings)                         -> dict   (summarised report)

All price/date/seller/condition values are parsed into the schema documented
in the task board. A listing is *never* returned with a range price -- those
are dropped. Graded cards are flagged (not dropped) so a downstream raw-card
researcher can filter them.
"""

from __future__ import annotations

import html as _html
import re
from html.parser import HTMLParser
from typing import Any, Dict, List, Optional
from urllib.parse import quote_plus

# --------------------------------------------------------------------------
# Constants
# --------------------------------------------------------------------------

SEARCH_BASE = "https://www.ebay.com/sch/i.html"
ITEM_BASE = "https://www.ebay.com/itm/"

# Fuzzy signals that the page is a bot wall rather than results.
BLOCK_SIGNALS = (
    "pardon our interruption",
    "checking your browser",
    "before you access ebay",
    "error page | ebay",
    "403 forbidden",
    "access denied",
    "unusual traffic",
    "prove you're human",
    "captcha",
    "challenge",
)
# A 403 page often carries one of these reference/title markers.
BLOCK_REFERENCE_RE = re.compile(r"reference\s*id\s*[:#]", re.IGNORECASE)

# Price patterns (US dollars).
#   $1,234.56 | $1,199 | 1,199.00 |  $640.00 to $1,140.00 | $640-$1140
_PRICE_TOKEN_RE = re.compile(
    r"\$\s*([0-9][0-9,]*(?:\.[0-9]{2})?)"
)
_RANGE_SEPARATORS = re.compile(
    r"(?:\bto\b|--|–|—|-|–)", re.IGNORECASE
)

# Grading bodies (skip/flag graded when researching raw).
GRADING_BODIES = ("psa", "bgs", "cgc", "sgs", "sgc", "mnt", "beckett", "gai")

# Condition classification keywords -> canonical token.
CONDITION_MAP = [
    # order matters: check more specific first
    ("brand new", "NM"),
    ("sealed", "NM"),
    ("near mint or better", "NM"),
    ("near mint", "NM"),
    ("nm/mint", "NM"),
    ("mint", "NM"),
    ("lightly played", "LP"),
    ("lp", "LP"),
    ("moderately played", "MP"),
    ("mp", "MP"),
    ("heavily played", "HP"),
    ("hp", "HP"),
    ("damaged", "DMG"),
    ("damage", "DMG"),
    ("dmg", "DMG"),
    ("used", "used"),
    ("pre-owned", "used"),
    ("preowned", "used"),
    ("new", "NM"),
]

GRADE_RE = re.compile(
    r"\b(PSA|BGS|CGC|SGC|Beckett|GAI)\s*[0-9]{1,2}\b", re.IGNORECASE
)
GRADE_ANY_RE = re.compile(
    r"\b(PSA|BGS|CGC|SGC|Beckett|GAI)\b", re.IGNORECASE
)

# Sold-date text formats eBay shows on completed items.
_SOLD_DATE_RE = re.compile(
    r"(?:Sold|Ended|was ended|Won|Completed|End)\s*(?:on\s+)?"
    r"((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4})",
    re.IGNORECASE,
)
# Bare date fallback (collapsed HTML cards put the date after the seller, not
# a keyword): "May 12, 2026".
_BARE_DATE_RE = re.compile(
    r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}",
    re.IGNORECASE,
)
_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

_SELLER_RE = re.compile(
    r"\b([A-Za-z0-9_.-]{2,40})\s*\(\s*(\d+)\s*\)\s*$"
)

# --------------------------------------------------------------------------
# URL builders
# --------------------------------------------------------------------------


def build_search_url(card_identity: Dict[str, Any], page: int = 1,
                     include_set: bool = True) -> str:
    """
    Decision rule #1. Query = `"<name> <card_number>"` (+ set name).

    card_identity example:
        {"name": "Dragonite ex", "card_number": "90/97",
         "set": "EX Dragon"}
    """
    name = str(card_identity.get("name", "")).strip()
    number = str(card_identity.get("card_number", "")).strip()
    set_name = str(card_identity.get("set", "") or "").strip()

    parts = []
    if name:
        parts.append(name)
    if number:
        parts.append(number)
    query = " ".join(parts).strip()
    # Decision rule #1: quote the canonical-name + number for exact match.
    query = f'"{query}"'
    if include_set and set_name and set_name.lower() not in query.lower():
        query = f"{query} {set_name}".strip()

    params = [
        ("_nkw", query),
        ("LH_Sold", "1"),      # MANDATORY: sold items only
        ("LH_Complete", "1"),  # include completed/ended
    ]
    if page and page > 1:
        params.append(("_pgn", str(page)))

    encoded = "&".join(f"{k}={quote_plus(str(v))}" for k, v in params)
    return f"{SEARCH_BASE}?{encoded}"


def build_detail_url(item_id: str) -> str:
    return f"{ITEM_BASE}{quote_plus(item_id)}"


# --------------------------------------------------------------------------
# Block / CAPTCHA detection
# --------------------------------------------------------------------------

_BLOCK_STYLE_SCRIPT_RE = re.compile(
    r"<(style|script|iframe)[\s\S]*?</\1>", re.IGNORECASE
)

def is_blocked(content: Optional[str]) -> bool:
    """True if the fetched page is a bot-wall / error page, not results.

    Signals are matched against the *rendered body text*, not the raw HTML:
    eBay's real pages embed CSS/JS that mention captcha/verification (e.g. the
    ``.ifh-captcha`` widget styles), which would otherwise false-positive on a
    perfectly good results page. Stripping <style>/<script> blocks keeps only
    visible content, where genuine "Pardon Our Interruption" walls appear.
    """
    if not content:
        return False
    low = _BLOCK_STYLE_SCRIPT_RE.sub(" ", content).lower()
    for sig in BLOCK_SIGNALS:
        if sig in low:
            return True
    return bool(BLOCK_REFERENCE_RE.search(content))


BLOCK_HINTS = {
    "web_extract_returns": [
        '"Pardon Our Interruption..."',  # Firecrawl hits the JS challenge
        '"Error Page | eBay"',
        'HTTP 403',
    ],
    "browser_returns": [
        'Navigation failed: net::ERR_HTTP2_PROTOCOL_ERROR',
        '"Error Page | eBay" snapshot',
    ],
    "what_it_means": (
        "eBay blocks the origin IP (datacenter/Comcast residential both "
        "observed 403). Retrying the same path will not help."
    ),
    "what_to_do": [
        "Run the Hermes loop from an IP eBay doesn't flag (residential home "
        "network / mobile hotspot / a proxy the browser tool can use).",
        "Or route web_extract through a residential-capable fetch service.",
        "Detect via is_blocked(content) and surface to the user instead of "
        "emitting empty/garbage results.",
    ],
}


# --------------------------------------------------------------------------
# Content kind sniffing
# --------------------------------------------------------------------------

def _detect_content_kind(content: str) -> str:
    """auto-detect markdown-vs-html."""
    if re.search(r"<[a-z][\s\S]*?>", content, re.IGNORECASE) and "<" in content:
        return "html"
    return "markdown"


# --------------------------------------------------------------------------
# HTML normalisation (stdlib html.parser) -> reusable text per listing block
# --------------------------------------------------------------------------

class _ItemCardParser(HTMLParser):
    """Pulls out the text of every `.s-item` block in a search page."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._depth = 0          # nesting depth inside current s-item
        self._in_sitem = 0
        self._in_title = 0
        self._capture = 0
        self._cur = []
        self._cur_url: Optional[str] = None
        self._cards: List[str] = []
        self._cur_title: Optional[str] = None
        self._in_price = 0

    def handle_starttag(self, tag, attrs):
        classes = " ".join(v for k, v in attrs if k == "class")
        cls = classes.lower()

        if self._in_sitem:
            self._depth += 1
            if tag in ("li", "div") and _is_sitem_card_class(cls):
                self._depth += 1  # nested s-item inside s-item (unlikely)
            if "s-item__title" in cls:
                self._in_title += 1
            if "s-item__price" in cls and "shipping" not in cls:
                self._in_price += 1
            if tag == "a" and self._cur_url is None:
                href = next((v for k, v in attrs if k == "href"), None)
                if href and "/itm/" in href:
                    self._cur_url = href
            return

        # detect a new card: <li class="s-item ..."> or <div class="s-item ...">
        if tag in ("li", "div") and _is_sitem_card_class(cls):
            self._in_sitem = 1
            self._depth = 0
            self._cur = []
            self._cur_url = None
            self._cur_title = None

    def handle_endtag(self, tag):
        if self._in_sitem:
            if self._in_title:
                self._in_title -= 1
            if self._in_price:
                self._in_price -= 1
            if self._depth > 0:
                self._depth -= 1
            if self._depth == 0:
                text = _clean_text(" ".join(self._cur))
                if self._cur_url and self._cur_url not in text:
                    text = f"{text} {self._cur_url}"
                self._cards.append(text)
                self._in_sitem = 0
                self._cur = []

    def handle_data(self, data):
        if self._in_sitem:
            self._cur.append(data)


def _clean_text(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def _is_sitem_card_class(cls: str) -> bool:
    """True only for a real `.s-item` card token, not `s-item__wrapper`."""
    return bool(re.search(r"(^|\s)s-item(\s|$)", cls))


def _extract_item_cards(html_text: str) -> List[str]:
    p = _ItemCardParser()
    try:
        p.feed(html_text)
    except Exception:
        pass
    # Dedupe identical card blobs (eBay sometimes nests/duplicates).
    seen, out = set(), []
    for card in p._cards:
        if not card:
            continue
        if card in seen:
            continue
        seen.add(card)
        out.append(card)
    return out


# --------------------------------------------------------------------------
# Per-listing text parser (shared by markdown and HTML paths)
# --------------------------------------------------------------------------

def _parse_money(s: str) -> Optional[float]:
    m = _PRICE_TOKEN_RE.search(str(s))
    if not m:
        return None
    raw = m.group(1).replace(",", "")
    try:
        return float(raw)
    except ValueError:
        return None


def _price_is_range(price_text: str) -> bool:
    """Decision rule #3: a range like `$640 to $1,140` has no single point."""
    prices = _PRICE_TOKEN_RE.findall(price_text)
    if len(prices) <= 1:
        return False
    # "$1,199.00" is one token; "640.00 to 1,140.00" -> two distinct numbers
    vals = [_to_float(p) for p in prices]
    vals = [v for v in vals if v is not None]
    if len(vals) >= 2 and abs(vals[0] - vals[1]) > 0.01:
        return True
    # handle "640 to 1,140" without leading $ on second token
    if _RANGE_SEPARATORS.search(price_text) and len(vals) >= 2:
        return True
    return False


def _to_float(s: str) -> Optional[float]:
    try:
        return float(s.replace(",", ""))
    except ValueError:
        return None


def _extract_price(price_text: str) -> Optional[float]:
    """Return a single price point, or None if it's a range/unparseable."""
    if _price_is_range(price_text):
        return None
    return _parse_money(price_text)


def _contains_grade(title: str) -> Optional[str]:
    """Decision rule #4. Return the grade string (e.g. 'PSA 9') or None."""
    if not title:
        return None
    m = GRADE_RE.search(title)
    if m:
        return m.group(0).upper()
    return None


def _is_graded_any(title: str) -> bool:
    return bool(title and GRADE_ANY_RE.search(title))


def classify_condition(text: str) -> str:
    """Map free-text condition/notes to NM|LP|MP|HP|DMG|used|unknown."""
    if not text:
        return "unknown"
    low = text.lower()
    for needle, token in CONDITION_MAP:
        if needle in low:
            return token
    return "unknown"


def _parse_seller(raw: str) -> Dict[str, Any]:
    raw = _clean_text(raw)
    m = _SELLER_RE.search(raw)
    if m:
        return {"name": m.group(1), "feedback_count": int(m.group(2))}
    # fallback: first token-ish word
    m2 = re.search(r"^([A-Za-z0-9_.-]{2,40})", raw)
    return {"name": m2.group(1) if m2 else raw, "feedback_count": None}


def _parse_sold_date(text: str) -> Optional[str]:
    """Return ISO date (YYYY-MM-DD) if a sold/ended date is visible."""
    if not text:
        return None
    m = _SOLD_DATE_RE.search(text)
    datestr = m.group(1) if m else None
    if not datestr:
        m2 = _BARE_DATE_RE.search(text)
        datestr = m2.group(0) if m2 else None
    if not datestr:
        return None
    dm = re.search(r"([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})", datestr)
    if not dm:
        return None
    mon = _MONTHS.get(dm.group(1)[:3].lower())
    if not mon:
        return None
    return f"{dm.group(3)}-{mon:02d}-{int(dm.group(2)):02d}"


def _extract_urls(text: str) -> List[str]:
    return re.findall(r"https?://[^\s\"'<>)\]]+", text)


def _first_item_url(text: str) -> Optional[str]:
    urls = _extract_urls(text)
    for u in urls:
        if "/itm/" in u:
            return u
    return None


# --------------------------------------------------------------------------
# Current-gen search page parser (`.s-card` / `.srp-results` DOM)
# --------------------------------------------------------------------------
# eBay's current SRP renders each result as <li class="s-card ..."> inside
# <ul class="srp-results srp-list clearfix">. The legacy `.s-item` cards no
# longer appear on live pages (T18.10). These helpers parse the `.s-card`
# structure directly from raw HTML via class-anchored regexes.

_SCARD_ITEM_RE = re.compile(r'<li\s+class="s-card[\s\S]*?</li>', re.IGNORECASE)
_SCARD_TITLE_RE = re.compile(
    r'class="s-card__title"[^>]*>([\s\S]*?)</div>', re.IGNORECASE)
_SCARD_CAPTION_RE = re.compile(
    r'aria-label="Sold Item"[^>]*>\s*([\s\S]*?)</span>', re.IGNORECASE)
_SCARD_PRICE_RE = re.compile(
    r'class="[^"]*s-card__price[^"]*"[^>]*>\s*([^<]+?)\s*</span>', re.IGNORECASE)
_SCARD_CONDITION_RE = re.compile(
    r'class="s-card__subtitle"[^>]*>([\s\S]*?)</div>', re.IGNORECASE)
_SCARD_SHIPPING_RE = re.compile(
    r'class="[^"]*s-card__attribute-row[^"]*"[^>]*>\s*'
    r'<span[^>]*>\s*([+$][^<]*shipping[^<]*?)\s*</span>', re.IGNORECASE)
_SCARD_LOCATION_RE = re.compile(
    r'Located in\s*([A-Za-z ]+?)\s*</', re.IGNORECASE)
_SCARD_OFFER_RE = re.compile(
    r'Best offer accepted', re.IGNORECASE)
_SCARD_SELLER_RE = re.compile(
    r'([A-Za-z0-9_.-]{2,40})\s*</span>\s*<span[^>]*>\s*'
    r'(\d+(?:\.\d+)?)%\s*positive\s*\((\d+)\)', re.IGNORECASE)


def _strip_tags(s: str) -> str:
    return _clean_text(_html.unescape(re.sub(r"<[^>]+>", " ", s)))


def _extract_s_card_blocks(html_text: str) -> List[str]:
    """Split the SRP page into individual `.s-card` item blocks (raw HTML)."""
    blocks: List[str] = []
    for m in _SCARD_ITEM_RE.finditer(html_text):
        block = m.group(0)
        # Skip the "result item" wrappers that are not real listings
        # (no s-card__title).
        if "s-card__title" not in block:
            continue
        blocks.append(block)
    return blocks


def _parse_s_card_block(block: str) -> Optional[Dict[str, Any]]:
    """Parse one `.s-card` listing block into the shared listing schema."""
    tm = _SCARD_TITLE_RE.search(block)
    title = _strip_tags(tm.group(1)) if tm else None
    if not title:
        return None
    # eBay appends a screen-reader suffix to the visible title.
    title = re.sub(r"\s*Opens in a new window or tab\s*$", "", title, flags=re.I)
    # CTA / furniture cards carry the `s-card__title` class but aren't listings.
    if title.lower() in ("shop on ebay", "search results", "sponsored"):
        return None

    pm = _SCARD_PRICE_RE.search(block)
    price_text = _strip_tags(pm.group(1)) if pm else None
    sold_price = _extract_price(price_text) if price_text else None
    if sold_price is None:
        if price_text and _price_is_range(price_text):
            return None  # range/lot listing (decision rule #3)
        return None

    cm = _SCARD_CONDITION_RE.search(block)
    cond_text = _strip_tags(cm.group(1)) if cm else ""
    condition = classify_condition(cond_text) if cond_text else "unknown"

    sm = _SCARD_SELLER_RE.search(block)
    if sm:
        seller = {"name": sm.group(1), "feedback_count": int(sm.group(3))}
    else:
        seller = {"name": "unknown", "feedback_count": None}

    url = _first_item_url(block)
    sold_at = _parse_sold_date(block)
    is_best_offer = bool(_SCARD_OFFER_RE.search(block))

    grade = _contains_grade(title)
    is_graded = grade is not None or _is_graded_any(title)

    # Photo is the card thumbnail on the search page; detail page is the real
    # source of photos, but keep the thumbnail as a fallback anchor.
    photos: List[str] = []
    img = re.search(r'<img[^>]+class="s-card__image"[^>]+src="([^"]+)"', block)
    if img:
        photos.append(_html.unescape(img.group(1)))

    flags: List[str] = []
    if price_text and _price_is_range(price_text):
        flags.append("range_price_skipped")
    if is_best_offer:
        flags.append("best_offer")

    return {
        "url": url,
        "item_id": _item_id_from_url(url) if url else None,
        "title": title,
        "sold_price_usd": sold_price,
        "listed_price_usd": sold_price,
        "is_best_offer": is_best_offer,
        "sold_at": sold_at,
        "seller": seller,
        "seller_condition_claim": condition,
        "is_graded": is_graded,
        "grade_info": grade,
        "photo_urls": photos,
        "flags": flags,
    }


# --------------------------------------------------------------------------
# Search-results parser
# --------------------------------------------------------------------------

def searchSoldListings(content: str, card_identity: Dict[str, Any],
                       content_kind: str = "auto",
                       limit: Optional[int] = None) -> List[Dict[str, Any]]:
    """
    Parse a sold-search page (markdown from web_extract, or raw HTML) into a
    list of candidate listing dicts. Range-priced listings are dropped here;
    graded listings are flagged (kept). No network I/O.
    """
    if is_blocked(content):
        raise BlockedByEBay(
            "eBay returned a bot-wall/error page; no listings extracted. "
            "See BLOCK_HINTS for remediation."
        )

    kind = _detect_content_kind(content) if content_kind == "auto" else content_kind
    if kind == "html":
        # Current-gen `.s-card` SRP page first; fall back to legacy `.s-item`
        # cards, then to text-block heuristics.
        scards = _extract_s_card_blocks(content)
        if scards:
            blocks = scards
        else:
            cards = _extract_item_cards(content)
            blocks = cards if cards else _split_markdown_blocks(content)
    else:
        blocks = _split_markdown_blocks(content)

    results: List[Dict[str, Any]] = []
    seen_texts = set()
    for block in blocks:
        if "s-card__title" in block:
            listing = _parse_s_card_block(block)
        else:
            listing = _parse_search_block(block)
        if listing is None:
            continue
        key = (
            listing["title"],
            listing.get("sold_price_usd"),
            listing["seller"]["name"],
        )
        if key in seen_texts:
            listing["flags"].append("duplicate_suspicion")
        seen_texts.add(key)
        results.append(listing)
        if limit and len(results) >= limit:
            break
    return results


def _split_markdown_blocks(content: str) -> List[str]:
    """Split web_extract markdown into candidate listing chunks.

    Primary strategy: blank-line separated paragraphs. Firecrawl markdown
    keeps blank lines between list items, and each listing paragraph carries a
    `$price`. A paragraph without a price is page furniture (headers, sidebar,
    footer) and is ignored. Falls back to line-heuristics when the page is one
    unbroken blob."""
    paras = [p.strip() for p in re.split(r"\n\s*\n", content) if p.strip()]
    priced = [p for p in paras if _PRICE_TOKEN_RE.search(p)]
    if priced:
        return priced

    # Fallback: one unbroken blob -> split on title-looking lines.
    lines = [ln.strip() for ln in content.splitlines() if ln.strip()]
    blocks: List[str] = []
    cur: List[str] = []
    for ln in lines:
        looks_like_title = (
            len(ln) > 8
            and _PRICE_TOKEN_RE.search(ln) is None
            and not re.match(r"^[|#>*\-=\d\s]+$", ln)
            and "ebay" not in ln.lower()
        )
        if looks_like_title and cur and _has_price(cur):
            blocks.append(" | ".join(cur))
            cur = [ln]
        else:
            cur.append(ln)
    if cur:
        blocks.append(" | ".join(cur))
    return blocks


# Lines that are page furniture, never a listing title.
_FURNITURE_RE = re.compile(
    r"(search results|sold items|refine|results for|sort by|show more|"
    r"page \d|related searches|shop by|save this search|eBay)",
    re.IGNORECASE,
)


def _has_price(lines: List[str]) -> bool:
    return any(_PRICE_TOKEN_RE.search(ln) for ln in lines)


def _parse_search_block(block: str) -> Optional[Dict[str, Any]]:
    title = _extract_title(block)
    if not title:
        return None

    price_text = _find_price_text(block)
    sold_price = _extract_price(price_text) if price_text else None
    if sold_price is None:
        # range price or unparseable -> skip (decision rule #3)
        if price_text and _price_is_range(price_text):
            return None
        return None

    seller_raw = _find_seller_text(block)
    seller = _parse_seller(seller_raw) if seller_raw else {"name": "unknown",
                                                           "feedback_count": None}

    url = _first_item_url(block)
    sold_at = _parse_sold_date(block)

    is_best_offer = _detect_best_offer(block)
    grade = _contains_grade(title)
    is_graded = grade is not None or _is_graded_any(title)

    cond_text = _find_condition_text(block)
    condition = classify_condition(cond_text) if cond_text else "unknown"

    flags: List[str] = []
    if price_text and _price_is_range(price_text):
        flags.append("range_price_skipped")
    if is_best_offer:
        flags.append("best_offer")

    return {
        "url": url,
        "item_id": _item_id_from_url(url) if url else None,
        "title": title,
        "sold_price_usd": sold_price,
        "listed_price_usd": sold_price,  # search page only exposes one number
        "is_best_offer": is_best_offer,
        "sold_at": sold_at,
        "seller": seller,
        "seller_condition_claim": condition,
        "is_graded": is_graded,
        "grade_info": grade,
        "photo_urls": [],
        "flags": flags,
    }


def _extract_title(block: str) -> Optional[str]:
    # 1) HTML title span
    m = re.search(r's-item__title[^>]*>\s*(.*?)</span>', block, re.IGNORECASE)
    if m:
        t = _clean_text(_html.unescape(m.group(1)))
        t = re.sub(r"^(New Listing|SPONSORED)\s*[:.]?\s*", "", t, flags=re.I)
        if t:
            return t
    # 2) first line that plausibly is the listing title
    for line in re.split(r"[\n|]", block):
        part = _clean_text(_html.unescape(line))
        part = re.sub(r"^#{1,6}\s*", "", part)  # strip markdown heading
        part = re.sub(r"^(New Listing|SPONSORED)\s*[:.]?\s*", "", part,
                      flags=re.I)
        if not part:
            continue
        if _PRICE_TOKEN_RE.search(part):
            continue                              # price / shipping line
        if _FURNITURE_RE.search(part):
            continue                              # page furniture / header
        if part.lower() in ("buy it now", "or best offer", "best offer",
                            "buy it now or best offer", "sold", "ended",
                            "won", "completed"):
            continue
        if re.match(r"^sold\b", part, re.I):
            continue
        if _is_seller_line(part):
            continue
        if re.match(r"^https?://", part):
            continue
        return part
    # 3) fallback: single-line card where the price shares the line with the
    #    title (HTML cards are collapsed to one space-joined line).
    m = _PRICE_TOKEN_RE.search(block)
    if m and m.start() > 0:
        prefix = _clean_text(block[: m.start()])
        prefix = re.sub(r"^(SOLD|New Listing|SPONSORED|Ended|End|Won)\s*"
                        r"[:.\-–·]?\s*", "", prefix, flags=re.I)
        if len(prefix) >= 5:
            return prefix
    return None


def _is_seller_line(part: str) -> bool:
    return bool(re.search(r"\([\d,]{2,}\)", part)) and bool(
        re.search(r"[A-Za-z0-9_.-]{2,40}\s*\([\d,]{2,}\)", part))


def _find_price_text(block: str) -> Optional[str]:
    m = re.search(r'\bs-item__price[^>]*>\s*([^|]{0,60}?\$[^|]{0,60}?)</',
                  block, re.IGNORECASE)
    if m:
        return m.group(1)
    # fallback: any $...$ token run
    m2 = re.search(r"(\$\s*[0-9][0-9,.]*(?:\s*(?:to|--|–|-)\s*\$?\s*[0-9][0-9,.]*)?)",
                   block)
    return m2.group(1) if m2 else None


def _find_seller_text(block: str) -> Optional[str]:
    m = re.search(r'\bs-item__seller[^>]*>\s*(.*?)</', block, re.IGNORECASE)
    if m:
        return _clean_text(_html.unescape(m.group(1)))
    m2 = re.search(r"([A-Za-z0-9_.-]{2,40}\s*\(\s*\d+\s*\)\s*(?:\d+[.]?\d*%?)?)",
                   block)
    return m2.group(1) if m2 else None


def _find_condition_text(block: str) -> Optional[str]:
    m = re.search(r'(?:condition|cond\.?)[:=]?\s*([A-Za-z][^|]{0,30}?)',
                  block, re.IGNORECASE)
    if m:
        t = m.group(1).strip(" :|")
        if len(t) < 40:
            return t
    return None


def _detect_best_offer(block: str) -> bool:
    return bool(re.search(r"\bor best offer\b", block, re.IGNORECASE))


def _item_id_from_url(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    m = re.search(r"/itm/([0-9]{9,20})", url)
    if m:
        return m.group(1)
    m2 = re.search(r"/(\d{9,20})\?", url)
    return m2.group(1) if m2 else None


# --------------------------------------------------------------------------
# Listing-detail parser
# --------------------------------------------------------------------------

def fetchListingDetail(content: str, url: str,
                       content_kind: str = "auto",
                       seller_condition_hint: str = "unknown") -> Dict[str, Any]:
    """
    Parse a single listing-detail page into the full schema. The agent should
    fetch `url` via web_extract/browser first, then call this with the content.
    `seller_condition_hint` lets the caller pass the search-page condition in
    case the detail page is opaque.
    """
    if is_blocked(content):
        raise BlockedByEBay("Listing detail page returned a bot wall.")

    kind = _detect_content_kind(content) if content_kind == "auto" else content_kind
    text = _html.unescape(re.sub(r"<[^>]+>", " ", content)) if kind == "html" \
        else content

    title = _extract_detail_title(content, text)
    # Price regexes are anchored on class attributes, so feed them the RAW HTML
    # (the tag-stripped `text` loses the class markers).
    price = _extract_detail_price(content)
    best_offer = _detect_best_offer(text)
    sold_at = _parse_sold_date(text)
    seller = _extract_detail_seller(text)
    condition = classify_condition(_extract_detail_condition(text))
    if condition == "unknown":
        condition = seller_condition_hint
    photos = _extract_photo_urls(content) if kind == "html" else []
    grade = _contains_grade(title)

    flags: List[str] = []
    if best_offer:
        flags.append("best_offer")
    if sold_at is None:
        flags.append("active_or_unsold")  # no sold/ended date visible

    # For best-offer sales the accepted price is not public; listed_price is
    # the ask, sold_price defaults to ask unless a distinct sold figure shows.
    listed = price
    if best_offer:
        sold_price = _extract_sold_winning_price(text) or price
    else:
        sold_price = price

    return {
        "url": url,
        "item_id": _item_id_from_url(url),
        "title": title,
        "sold_price_usd": sold_price,
        "listed_price_usd": listed,
        "is_best_offer": best_offer,
        "sold_at": sold_at,
        "seller": seller,
        "seller_condition_claim": condition,
        "is_graded": grade is not None or _is_graded_any(title),
        "grade_info": grade,
        "photo_urls": photos,
        "flags": flags,
    }


def _extract_detail_title(content: str, text: str) -> Optional[str]:
    m = re.search(r"<title[^>]*>(.*?)</title>", content, re.IGNORECASE | re.DOTALL)
    if m:
        t = _clean_text(_html.unescape(m.group(1)))
        t = re.sub(r"\s*\|\s*eBay\s*$", "", t, flags=re.I)
        return t or None
    return _clean_text(text.split("\n")[0])[:200] or None


def _extract_detail_price(text: str) -> Optional[float]:
    # Current eBay item pages show the primary price in the listing currency
    # (e.g. "GBP 60.00" for a UK seller) plus an "approximately US $80.97"
    # conversion. Prefer the USD figure when present so valuation math stays in
    # US dollars; fall back to the primary price, then legacy markup.
    for pat in (
        r"x-price-approx__price[^>]*>([\s\S]{0,120}?US\s*\$[\s\S]{0,20}?)<",
        r"x-price-primary[^>]*>([\s\S]{0,120}?\$[^<]{0,30}?)<",
        r"x-bin-price__content[^>]*>([\s\S]{0,120}?\$[^<]{0,30}?)<",
        r"ux-price__value[^>]*>\s*([^<]{0,30}?\$[^<]{0,30}?)<",
    ):
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            src = m.group(1)
            price = _parse_money(src)
            if price is not None and not _price_is_range(src):
                return price
    src = _find_price_text(text)
    if not src:
        return None
    if _price_is_range(src):
        return None
    return _parse_money(src)


def _extract_sold_winning_price(text: str) -> Optional[float]:
    """Some ended best-offer pages show a distinct 'Sold for $X'. Best effort."""
    m = re.search(r"(?:Sold for|Winning bid|Won at)\s*\$\s*([0-9][0-9,]*(?:\.[0-9]{2})?)",
                  text, re.IGNORECASE)
    return _parse_money(m.group(0)) if m else None


def _extract_detail_seller(text: str) -> Dict[str, Any]:
    # Current DOM: seller name appears in the seller-card link
    # (https://www.ebay.com/sch/<name>/m.html?...) plus a "100% positive (N)"
    # feedback string. Capture name first, then feedback.
    name = None
    m = re.search(
        r"/sch/([A-Za-z0-9_.-]{2,40})/m\.html\?", text, re.IGNORECASE)
    if m:
        name = _clean_text(_html.unescape(m.group(1)))
    if not name:
        # Raw-HTML path: the structured seller name element wins over prose.
        m = re.search(r'seller-info__name[^>]*>\s*([^<]{2,40}?)\s*<', text,
                      re.IGNORECASE)
        if m:
            name = _clean_text(_html.unescape(m.group(1)))
    feedback = None
    # Detail pages render "guyvernoidxcollectingtcg (198) 100% positive" or a
    # standalone "100% positive feedback". Grab the count in parens right
    # before "% positive", falling back to the seller-name-adjacent paren.
    m = re.search(r"\((\d[\d,]*)\)\s*\d*\.?\d*\s*%\s*positive", text, re.IGNORECASE)
    if not m:
        m = re.search(r"([A-Za-z0-9_.-]{2,40})\s*\((\d[\d,]*)\)\s*\d*\.?\d*\s*%", text, re.IGNORECASE)
    if m:
        grp = m.group(2) if m.lastindex == 2 else m.group(1)
        try:
            feedback = int(grp.replace(",", ""))
        except ValueError:
            feedback = None
    if name:
        return {"name": name, "feedback_count": feedback}
    # Text path: `Seller information PokeMaster99` etc.
    m = re.search(r"\bSeller\b\s+(?:information\s+)?"
                  r"([A-Za-z0-9_.-]{2,40})\b", text, re.IGNORECASE)
    name = _clean_text(m.group(1)) if m else "unknown"
    fb = re.search(r"\(([\d,]{2,})\)", text)
    return {"name": name,
            "feedback_count": int(fb.group(1).replace(",", "")) if fb else None}


def _extract_detail_condition(text: str) -> str:
    m = re.search(r"(?:Condition|Item condition)[:=]?\s*"
                  r"([A-Za-z][A-Za-z &'/-]{2,40})", text, re.IGNORECASE)
    if m:
        t = m.group(1).strip(" :|")
        if len(t) < 30:
            return t
    return ""


def _extract_photo_urls(content: str) -> List[str]:
    urls = re.findall(r'https://i\.ebayimg\.com[^"\'\s)]+', content)
    seen, out = set(), []
    for u in urls:
        if u in seen:
            continue
        seen.add(u)
        out.append(u)
        if len(out) >= 12:
            break
    return out


def mergeDetail(search_listing: Dict[str, Any],
                detail: Dict[str, Any]) -> Dict[str, Any]:
    """
    Merge a search-result candidate with its fetched detail page. The detail
    page is the source of truth for condition, best-offer flag, photos, and
    the sold price (best-offer asks can differ from the accepted figure).
    Sets trust_anchor when the seller explicitly marks condition AND photos
    are present (the agent still judges photo cleanliness separately).
    """
    merged = dict(search_listing)
    for k in ("title", "sold_price_usd", "listed_price_usd", "is_best_offer",
              "sold_at", "seller", "seller_condition_claim", "is_graded",
              "grade_info", "photo_urls"):
        if detail.get(k) is not None:
            merged[k] = detail[k]
    merged["url"] = detail.get("url") or search_listing.get("url")
    merged["item_id"] = detail.get("item_id") or search_listing.get("item_id")

    flags = list(dict.fromkeys(search_listing.get("flags", [])
                               + detail.get("flags", [])))
    merged["flags"] = flags

    cond = merged.get("seller_condition_claim")
    photos = merged.get("photo_urls") or []
    merged["trust_anchor"] = bool(cond and cond != "unknown" and photos)
    if merged["trust_anchor"] and "trust_anchor" not in flags:
        merged["flags"].append("trust_anchor")
    return merged


# --------------------------------------------------------------------------
# Rule application (filters + trust anchors)
# --------------------------------------------------------------------------

def applyRules(listings: List[Dict[str, Any]],
               research_raw: bool = True) -> List[Dict[str, Any]]:
    """
    Post-process a list of parsed listings:

      * drop listings that somehow still carry a range price
      * if `research_raw` is True, drop graded cards (decision rule #4)
        -- but keep them flagged so a caller can change its mind
      * recompute duplicate flags (same title + price + seller + near date)
      * mark trust-anchor sellers (explicit condition + sane seller)

    Returns a NEW list; does not mutate input.
    """
    out: List[Dict[str, Any]] = []
    for L in listings:
        L = dict(L)
        if _is_range_listing(L):
            if "range_price_skipped" not in L["flags"]:
                L["flags"].append("range_price_skipped")
            continue
        if research_raw and L.get("is_graded"):
            continue
        if L.get("seller_condition_claim") != "unknown":
            L["trust_anchor"] = True
            if "trust_anchor" not in L["flags"]:
                L["flags"].append("trust_anchor")
        out.append(L)
    _flag_duplicates(out)
    return out


def _is_range_listing(L: Dict[str, Any]) -> bool:
    return "range_price_skipped" in L["flags"]


def _flag_duplicates(listings: List[Dict[str, Any]]) -> None:
    """Same title + same price + same seller + sold within ~30 days."""
    seen: Dict[tuple, str] = {}
    for L in listings:
        key = (L.get("title"), L.get("sold_price_usd"), L.get("seller", {}).get("name"))
        prev_date = seen.get(key)
        if prev_date is not None:
            near = _dates_near(prev_date, L.get("sold_at"))
            if near and "duplicate_suspicion" not in L["flags"]:
                L["flags"].append("duplicate_suspicion")
            else:
                # same seller repeatedly listing the same card = relist smell
                if "relist_suspicion" not in L["flags"]:
                    L["flags"].append("relist_suspicion")
        else:
            seen[key] = L.get("sold_at")


def _dates_near(d1: Optional[str], d2: Optional[str], days: int = 30) -> bool:
    if not d1 or not d2:
        return False
    try:
        from datetime import date
        a = date.fromisoformat(d1)
        b = date.fromisoformat(d2)
        return abs((a - b).days) <= days
    except ValueError:
        return False


def to_report(listings: List[Dict[str, Any]],
              research_raw: bool = True) -> Dict[str, Any]:
    """Condense RAW parsed listings into a digest an agent can quote/forward.

    Accepts the raw candidates from `searchSoldListings` (graded cards still
    present) so `graded_excluded` is accurate, and applies the same filter the
    caller uses via `applyRules`.
    """
    non_range = [L for L in listings if "range_price_skipped" not in L["flags"]]
    usable = [L for L in non_range if not (research_raw and L.get("is_graded"))]
    graded = [L for L in non_range if L.get("is_graded")]
    bo = [L for L in usable if L.get("is_best_offer")]
    dups = [L for L in usable if "duplicate_suspicion" in L["flags"]]
    anchors = [L for L in usable if L.get("trust_anchor")]

    prices = sorted(L["sold_price_usd"] for L in usable
                    if L.get("sold_price_usd"))
    return {
        "total_candidates": len(listings),
        "usable_sold_listings": len(usable),
        "graded_excluded": len(graded),
        "best_offer_count": len(bo),
        "duplicate_suspicion_count": len(dups),
        "trust_anchor_count": len(anchors),
        "price_usd_min": prices[0] if prices else None,
        "price_usd_max": prices[-1] if prices else None,
        "price_usd_median": prices[len(prices) // 2] if prices else None,
        "listings": usable,
    }


class BlockedByEBay(Exception):
    """Raised when a fetched page is an eBay bot-wall/error page."""


# --------------------------------------------------------------------------
# CLI demo (run against a fixture, no network)
# --------------------------------------------------------------------------

def _main(argv: List[str]) -> int:
    import json
    # argv is sys.argv[1:] (no program name)
    if len(argv) < 1:
        print("usage: ebay_sold_scraper.py <search-html|search-md> "
              "[detail-html] [card_name card_number set]")
        return 2
    with open(argv[0]) as f:
        content = f.read()
    ident = {"name": argv[2] if len(argv) > 2 else "Dragonite ex",
             "card_number": argv[3] if len(argv) > 3 else "90/97",
             "set": argv[4] if len(argv) > 4 else "EX Dragon"}
    listings = searchSoldListings(content, ident)
    final = applyRules(listings)
    print(json.dumps(to_report(listings), indent=2, default=str))
    if len(argv) > 1:
        with open(argv[1]) as f:
            detail = f.read()
        if final:
            print(json.dumps(
                fetchListingDetail(detail, final[0].get("url", "")),
                indent=2, default=str))
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(_main(sys.argv[1:]))
