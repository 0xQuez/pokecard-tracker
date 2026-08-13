"""Tests for src/lib/cdp_fetch.py — pure routing helpers (no network/WS)."""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "src", "lib"))

from cdp_fetch import _host_of, firecrawl_markdown  # noqa: E402


class TestHostOf(unittest.TestCase):
    def test_ebay(self):
        self.assertEqual(
            _host_of("https://www.ebay.com/sch/i.html?_nkw=x&LH_Sold=1"),
            "www.ebay.com")

    def test_tcg(self):
        self.assertEqual(
            _host_of("https://www.tcgplayer.com/product/123/x"), "www.tcgplayer.com")

    def test_bare(self):
        self.assertEqual(_host_of("https://example.com"), "example.com")
        self.assertEqual(_host_of(""), "")


class TestFirecrawlMarkdown(unittest.TestCase):
    def test_raises_without_key(self):
        # Ensure env var is absent for this deterministic check.
        old = os.environ.pop("FIRECRAWL_API_KEY", None)
        try:
            with self.assertRaises(RuntimeError) as ctx:
                firecrawl_markdown("https://example.com")
            self.assertIn("FIRECRAWL_API_KEY", str(ctx.exception))
        finally:
            if old is not None:
                os.environ["FIRECRAWL_API_KEY"] = old


if __name__ == "__main__":
    unittest.main()
