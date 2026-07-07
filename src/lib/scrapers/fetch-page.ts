// Direct page fetcher — no Firecrawl dependency.
// Uses realistic browser headers and returns the response text for parsing.

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

export async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: DEFAULT_HEADERS,
      // Next.js server-side fetch allows us to skip the browser-only check
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    if (!res.ok) {
      console.error(`Fetch ${res.status} for ${url}`);
      return null;
    }

    return await res.text();
  } catch (e: any) {
    console.error(`Fetch error for ${url}:`, e.message || e);
    return null;
  }
}
