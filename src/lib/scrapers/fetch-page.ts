// Page fetcher with dual mode: direct fetch (fast, light pages) or Firecrawl (JS-rendered).
// Firecrawl requires FIRECRAWL_API_KEY in env.

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

function isEbayUrl(url: string): boolean {
  return url.includes("ebay.com");
}

function hasEbayRenderedListings(text: string): boolean {
  // eBay sold listings pages rendered by a headless browser contain
  // "Sold <Month> <Day>, <Year>" date lines. JS shells never do.
  return /^Sold [A-Z][a-z]{2} \d{1,2}, \d{4}$/m.test(text);
}

export async function fetchPage(url: string): Promise<string | null> {
  // Try direct fetch first (skip for eBay — always CSR)
  if (!isEbayUrl(url)) {
    try {
      const res = await fetch(url, {
        headers: DEFAULT_HEADERS,
        // Next.js server-side fetch allows us to skip the browser-only check
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      if (res.ok) {
        const text = await res.text();
        if (text.length > 5000) {
          // Check if this looks like server-rendered HTML with actual listing content
          // rather than a pure JS shell
          const hasRealContent =
            text.includes("<ul") ||
            text.includes('class="srp-results') ||
            text.includes('data-view="mi') ||
            text.includes("_nkw=");

          if (hasRealContent) {
            return text;
          }
        }
      }
    } catch (e: any) {
      console.error(`Direct fetch error for ${url}:`, e.message || e);
    }
  }

  // Fall back to Firecrawl if key is present
  return fetchWithFirecrawl(url);
}

export async function fetchWithFirecrawl(url: string): Promise<string | null> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    console.warn("FIRECRAWL_API_KEY not set, skipping Firecrawl fallback");
    return null;
  }

  try {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
      }),
    });

    if (!res.ok) {
      console.error(`Firecrawl ${res.status} for ${url}`);
      return null;
    }

    const data = await res.json();
    const markdown = data?.data?.markdown;
    if (markdown && typeof markdown === "string" && markdown.length > 200) {
      // For eBay, verify the markdown actually contains rendered listings
      if (isEbayUrl(url) && !hasEbayRenderedListings(markdown)) {
        console.warn(`Firecrawl returned eBay markdown without sold listings for ${url}`);
        return null;
      }
      return markdown;
    }
    return null;
  } catch (e: any) {
    console.error(`Firecrawl error for ${url}:`, e.message || e);
    return null;
  }
}
