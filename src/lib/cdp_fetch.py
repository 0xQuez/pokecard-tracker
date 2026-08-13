#!/usr/bin/env python3
"""CDP-driven page fetcher (T18.10) — fetch JS-rendered pages through the local
Chrome that has remote debugging enabled on localhost:9222.

Why this exists
---------------
eBay's search/listing pages are JS-heavy and IP-block datacenter/cloud traffic
(the T18.3 bot wall). The pipeline's `fetch_page` used to depend on an external
`web_extract`/Firecrawl layer, which hit the wall. The fix is a dedicated local
Chrome profile that stays logged into eBay/TCGPlayer from the home IP; scraping
drives that browser over the Chrome DevTools Protocol (CDP) instead. The
browser is launched by `~/.hermes/start-agent-browser.sh` (remote-debugging on
port 9222).

This module is a *transport*: it navigates the real browser to a URL, waits for
the JS to render, and hands back the serialised `document.documentElement.
outerHTML` for the page. It does NOT parse listings — that stays in
`ebay_sold_scraper.py` / `tcgplayer_scraper.py`, which accept raw HTML.

Public API
----------
  cdp_fetch(url, *, cdp_url='http://localhost:9222',
            wait_selector=None, wait_text=None,
            render_timeout=30, nav_timeout=45) -> str
      Navigate and return rendered outerHTML (str). Raises CdpUnavailable if
      the browser/WS is unreachable; raises TimeoutError if the page never
      finishes loading / never shows the wait condition.

  cdp_reachable(cdp_url='http://localhost:9222') -> bool
      Cheap liveness probe (GET /json/version).

Internals
---------
Uses the Chrome DevTools Protocol over WebSocket (websocket-client). One new
tab is opened per fetch so we never clobber the user's own browsing tab, then
closed on exit (even on error). Runtime.evaluate with returnByValue fetches the
final HTML.
"""

from __future__ import annotations

import json
import os
import time
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

import websocket  # websocket-client

DEFAULT_CDP = os.environ.get("CDP_URL", "http://localhost:9222")


class CdpUnavailable(RuntimeError):
    """The local CDP browser is not reachable (is start-agent-browser.sh up?)."""


class _CdpClient:
    """Minimal CDP client over a single WebSocket connection."""

    def __init__(self, ws_url: str) -> None:
        # Chrome 111+ rejects CDP WS connections that carry an Origin header
        # unless --remote-allow-origins is set. Suppress it so we don't need to
        # restart the user's logged-in browser session.
        self.ws = websocket.create_connection(
            ws_url, timeout=30, suppress_origin=True)
        self._id = 0

    def close(self) -> None:
        try:
            self.ws.close()
        except Exception:  # noqa: BLE001
            pass

    def call(self, method: str, params: Optional[Dict[str, Any]] = None) -> Any:
        """Send a CDP command and wait for its result."""
        self._id += 1
        msg_id = self._id
        self.ws.send(json.dumps(
            {"id": msg_id, "method": method, "params": params or {}}))
        while True:
            raw = self.ws.recv()
            if not raw:
                continue
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if msg.get("id") == msg_id:
                if "error" in msg:
                    raise RuntimeError(
                        f"CDP {method} failed: {msg['error']}")
                return msg.get("result", {})
            # else: an async event (Page.loadEventFired etc.) — ignore.

    def evaluate(self, expression: str) -> Any:
        """Evaluate JS and return the JSON value (returnByValue)."""
        res = self.call("Runtime.evaluate", {
            "expression": expression,
            "returnByValue": True,
            "awaitPromise": True,
        })
        exc = res.get("exceptionDetails")
        if exc:
            raise RuntimeError(
                f"CDP Runtime.evaluate exception: {exc.get('text')}")
        return res.get("result", {}).get("value")


def _http_json(url: str) -> Any:
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:  # noqa: BLE001
        raise CdpUnavailable(f"CDP HTTP {url}: {e}")


def _open_tab(cdp_url: str) -> Dict[str, Any]:
    """Open a new page tab, return its target descriptor with a WS url."""
    # PUT /json/new?url=... opens a new tab pointing at the URL.
    try:
        req = urllib.request.Request(
            f"{cdp_url}/json/new?{urllib.parse.urlencode({'url': 'about:blank'})}",
            method="PUT")
        with urllib.request.urlopen(req, timeout=10) as resp:
            target = json.loads(resp.read().decode())
    except Exception as e:  # noqa: BLE001
        raise CdpUnavailable(f"CDP open tab failed: {e}")
    return target


def _close_tab(cdp_url: str, target_id: str) -> None:
    try:
        urllib.request.urlopen(
            urllib.request.Request(
                f"{cdp_url}/json/close/{target_id}", method="PUT"),
            timeout=5)
    except Exception:  # noqa: BLE001
        pass


def _poll(cond, timeout: float, interval: float = 0.5) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if cond():
            return True
        time.sleep(interval)
    return False


def cdp_fetch(url: str, *, cdp_url: str = DEFAULT_CDP,
              wait_selector: Optional[str] = None,
              wait_text: Optional[str] = None,
              render_timeout: float = 30.0,
              nav_timeout: float = 45.0) -> str:
    """Navigate the local CDP browser to `url`, wait for render, return HTML.

    `wait_selector` / `wait_text` are runtime conditions that must appear in
    the DOM before we read it (the JS has actually rendered). If the condition
    never appears, we still return whatever HTML is there after render_timeout
    so the parser can decide (e.g. detect a bot wall). The page must reach
    document.readyState == 'complete' within nav_timeout or TimeoutError is
    raised.
    """
    target = _open_tab(cdp_url)
    target_id = target.get("id")
    ws_url = target.get("webSocketDebuggerUrl")
    client: Optional[_CdpClient] = None
    try:
        if not ws_url:
            raise CdpUnavailable("no webSocketDebuggerUrl on new tab")
        client = _CdpClient(ws_url)
        client.call("Page.enable")
        client.call("Runtime.enable")
        client.call("Page.navigate", {"url": url})

        # Wait for the load event / interactive DOM.
        if not _poll(
            lambda: client.evaluate("document.readyState") in ("interactive", "complete"),
            nav_timeout,
        ):
            raise TimeoutError(f"page did not finish loading within {nav_timeout}s: {url}")

        # Wait for the JS render condition if one was requested.
        if wait_selector or wait_text:
            _poll(
                lambda: client.evaluate(_render_cond_js(wait_selector, wait_text)),
                render_timeout,
            )

        # Small settle so deferred rendering (sold-date labels etc.) lands.
        time.sleep(0.8)
        html = client.evaluate("document.documentElement.outerHTML")
        return html or ""
    finally:
        if client is not None:
            client.close()
        if target_id:
            _close_tab(cdp_url, target_id)


def _render_cond_js(selector: Optional[str], text: Optional[str]) -> str:
    parts: List[str] = []
    if selector:
        parts.append(f"document.querySelector({json.dumps(selector)}) !== null")
    if text:
        parts.append(
            f"document.body && document.body.innerText.includes({json.dumps(text)})")
    if not parts:
        return "true"
    return "(" + " && ".join(parts) + ")"


def cdp_reachable(cdp_url: str = DEFAULT_CDP) -> bool:
    try:
        _http_json(f"{cdp_url}/json/version")
        return True
    except CdpUnavailable:
        return False


# ---------------------------------------------------------------------------
# Self-driving fetch_page for the valuation orchestrator (T18.10)
# ---------------------------------------------------------------------------
# The orchestrator's AgentEnv.fetch_page needs a single callable that returns
# the right content kind per source: eBay (JS-heavy, IP-flagged) is driven
# through the local CDP browser as raw HTML; TCGPlayer returns markdown exactly
# like `web_extract` (Firecrawl), which the tcgplayer_scraper parses. This is
# the "no agent hands-on" default so `python -m ...valuation_orchestrator`
# drives the whole pipeline itself.
_FIRECRAWL_ENDPOINT = "https://api.firecrawl.dev/v1/scrape"


def firecrawl_markdown(url: str, *, timeout: float = 60.0,
                       api_key: Optional[str] = None) -> str:
    """Fetch `url` via Firecrawl and return its markdown (web_extract path).

    Reads FIRECRAWL_API_KEY from env, or `api_key`. Raises RuntimeError when
    the key is missing or the scrape fails.
    """
    key = api_key or os.environ.get("FIRECRAWL_API_KEY") or ""
    if not key:
        raise RuntimeError(
            "firecrawl_markdown: FIRECRAWL_API_KEY not set (needed for the "
            "TCGPlayer side of a self-driving valuation run)")
    payload = json.dumps({"url": url, "formats": ["markdown"]}).encode()
    req = urllib.request.Request(
        _FIRECRAWL_ENDPOINT, data=payload, method="POST", headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
        })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode())
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"Firecrawl scrape {url}: {e}")
    md = (data.get("data") or {}).get("markdown") if isinstance(data, dict) else None
    if not md or len(md) < 200:
        raise RuntimeError(f"Firecrawl returned no/empty markdown for {url}")
    return md


def fetch_page(url: str, *, cdp_url: str = DEFAULT_CDP) -> str:
    """Orchestrator default fetch_page: CDP for eBay, Firecrawl for TCGPlayer."""
    host = _host_of(url)
    if "ebay.com" in host:
        if "/sch/" in url or "i.html" in url:
            return cdp_fetch(url, wait_selector=".srp-results",
                             cdp_url=cdp_url, nav_timeout=45)
        return cdp_fetch(url, cdp_url=cdp_url, nav_timeout=45)
    if "tcgplayer.com" in host:
        return firecrawl_markdown(url, timeout=90.0)
    raise RuntimeError(f"fetch_page: no fetch strategy for host {host!r} ({url})")


def _host_of(url: str) -> str:
    from urllib.parse import urlparse
    return (urlparse(url).netloc or "").lower()


if __name__ == "__main__":
    import sys
    url = sys.argv[1] if len(sys.argv) > 1 else \
        "https://www.ebay.com/sch/i.html?_nkw=dragonite&LH_Sold=1"
    sel = sys.argv[2] if len(sys.argv) > 2 else None
    print(f"cdp_reachable: {cdp_reachable()}")
    html = cdp_fetch(url, wait_selector=sel)
    print(f"fetched {len(html)} bytes from {url}")
    print("contains <html:", "<html" in html.lower())
