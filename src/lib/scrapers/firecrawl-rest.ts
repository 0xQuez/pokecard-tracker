// Thin REST wrapper around Firecrawl — no SDK bloat, works on Vercel / Edge.
// Replaces @mendable/firecrawl-js which hangs in serverless environments.

const API_BASE = "https://api.firecrawl.dev/v1";
const API_KEY = process.env.FIRECRAWL_API_KEY || "";

function authHeader(apiKey: string): string {
  return `Bearer ${apiKey}`;
}

export async function firecrawlScrape(url: string): Promise<string | null> {
  if (!API_KEY) {
    console.warn("FIRECRAWL_API_KEY not set — skipping scrape for", url);
    return null;
  }

  try {
    const res = await fetch(`${API_BASE}/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader(API_KEY),
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "unknown");
      console.error(`Firecrawl REST ${res.status}:`, body.slice(0, 500));
      return null;
    }

    const json = (await res.json().catch(() => ({}))) as any;
    return json.data?.markdown || null;
  } catch (e: any) {
    console.error("Firecrawl REST fetch error:", e.message || e);
    return null;
  }
}
