/**
 * card-vision.ts — Vision-based card identity extraction (T20).
 *
 * Given a photo of a Pokémon card, ask a vision model to read the identifying
 * text off the card and return it as strict JSON:
 *
 *   { name, set, number, variant, print, stamp }
 *
 * The module keeps the vision model behind an *injectable* `visionFn(imageUrl)
 * -> string` boundary, mirroring the T18.5 condition verifier. The route passes
 * a concrete provider; tests inject a canned response; the parsing is
 * deterministic and offline-testable (tolerant of the occasional non-JSON
 * vision reply, exactly like `condition_verifier.parse_vision_text`).
 *
 * VARIANT / STAMP are the ambiguous-identity tiebreakers:
 *   - pokemontcg.io does NOT split a "regular" print from a "Pokemon Center
 *     Exclusive" (svp-44 is a single entry). So the vision model reading the
 *     actual stamp on the card is the ONLY signal that tells the two apart —
 *     this is what the matcher uses to surface the PC-exclusive candidate.
 *   - print (1st edition / unlimited / shadowless) behaves like card-identity.ts.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** Foil treatment visible on the card face. */
export type Variant = "holo" | "reverse-holo" | "regular";

/** Vintage print qualifier. Null = none visible (modern / unstated). */
export type Print = "1st-edition" | "unlimited" | "shadowless" | null;

/** Collector stamp on the card. `pokemon-center` is the expensive tiebreak. */
export type Stamp = "pokemon-center" | "other" | null;

/** Structured identity read off the photo by the vision model. */
export interface VisionFeatures {
  /** Card name as printed, e.g. "Charmander". Null if unreadable. */
  name: string | null;
  /** Set name as read off the card, e.g. "Scarlet & Violet Black Star Promos". */
  set: string | null;
  /** Card number as printed, e.g. "44" (no "/total"). Null if unreadable. */
  number: string | null;
  variant: Variant | null;
  print: Print;
  /** Collector stamp. `pokemon-center` -> ambiguous with the regular print. */
  stamp: Stamp;
  /** Vision model's own confidence that it read the card, 0..1. */
  confidence: number;
}

/** Injectable vision call: imageUrl -> raw model text (may be non-JSON). */
export type VisionFn = (imageUrl: string) => Promise<string> | string;

/** Thrown when the route has no vision provider configured. */
export class VisionNotConfigured extends Error {
  constructor() {
    super(
      "No vision provider configured. Set VISION_API_BASE_URL, VISION_API_KEY " +
        "and VISION_MODEL (OpenAI-compatible chat completions with image_url " +
        "support) to enable /api/hunter/identify."
    );
    this.name = "VisionNotConfigured";
  }
}

// ── Prompt ────────────────────────────────────────────────────────────────────

/** Strict-JSON instruction appended to the vision prompt. */
export const VISION_STRICT_JSON =
  "Return ONLY a single JSON object, no prose, no markdown fences. " +
  'Keys exactly: "name" (string or null), "set" (string or null), ' +
  '"number" (string like "44" or null), "variant" (one of "holo", ' +
  '"reverse-holo", "regular", or null), "print" (one of "1st-edition", ' +
  '"unlimited", "shadowless", or null), "stamp" (one of "pokemon-center", ' +
  '"other", or null), "confidence" (number 0.0-1.0).';

export function buildVisionPrompt(): string {
  return (
    "You are a professional Pokémon TCG cataloger inspecting a single photo of " +
    "one card. The photo may be worn, angled, or poorly lit — read what you can " +
    "and set a field to null rather than guessing.\n\n" +
    "- name: the card's printed name (e.g. \"Charmander\").\n" +
    "- set: the set symbol/set name printed on the card (e.g. \"Scarlet & " +
    "Violet Black Star Promos\").\n" +
    "- number: the card number in the corner (e.g. \"44\").\n" +
    "- variant: \"holo\" if the artwork is foiled/reflective, \"reverse-holo\" " +
    "if the foil is on the frame/border only, \"regular\" if flat.\n" +
    "- print: \"1st-edition\" only if you clearly see the 1st Edition stamp, " +
    "\"shadowless\" if a vintage Base Set card with no drop-shadow on the " +
    "right border, else null.\n" +
    "- stamp: \"pokemon-center\" if the card carries a Pokemon Center (PC) " +
    "collector stamp/logo, \"other\" for any other stamp, else null. This is " +
    "critical — a PC-stamped promo is a different product from the regular one.\n\n" +
    VISION_STRICT_JSON
  );
}

// ── Parsing (tolerant) ────────────────────────────────────────────────────────

function _stripCodeFences(text: string): string {
  const m = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(text.trim());
  return m ? m[1].trim() : text.trim();
}

function _safeString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" || /^null$/i.test(s) ? null : s;
}

function _safeNumber(v: unknown): string | null {
  const s = _safeString(v);
  if (!s) return null;
  return /^\d{1,4}$/.test(s) ? s : null;
}

function _safeVariant(v: unknown): Variant | null {
  const s = (_safeString(v) || "").toLowerCase();
  if (s.includes("reverse")) return "reverse-holo";
  if (s.includes("holo") || s === "holofoil") return "holo";
  if (s === "regular" || s === "normal" || s === "flat") return "regular";
  return null;
}

function _safePrint(v: unknown): Print {
  const s = (_safeString(v) || "").toLowerCase();
  if (s.includes("1st") || s.includes("first") || s === "1") return "1st-edition";
  if (s.includes("shadow")) return "shadowless";
  if (s.includes("unlimited")) return "unlimited";
  return null;
}

function _safeStamp(v: unknown): Stamp {
  const s = (_safeString(v) || "").toLowerCase();
  if (s.includes("pokemon") && s.includes("center")) return "pokemon-center";
  if (s.includes("pc")) return "pokemon-center";
  if (s && s !== "none" && s !== "null") return "other";
  return null;
}

function _safeConfidence(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

/**
 * Parse the vision model's reply into VisionFeatures. Tolerant: tries strict
 * JSON first, then falls back to pulling `key: value` pairs out of free text so
 * a slightly-off vision reply still yields usable features (same philosophy as
 * `condition_verifier.parse_vision_text`).
 */
export function parseVisionText(text: string): VisionFeatures {
  const cleaned = _stripCodeFences(text);
  let data: Record<string, unknown> = {};

  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>;
  } catch {
    const kv: Record<string, unknown> = {};
    for (const key of ["name", "set", "number", "variant", "print", "stamp", "confidence"]) {
      // Accept both quoted ("name": ...) and unquoted (name: ...) keys.
      const m = new RegExp(
        `["']?${key}["']?\\s*[:=]\\s*("(?:[^"\\\\]|\\\\.)*"|null|\\d+(?:\\.\\d+)?)`,
        "i"
      ).exec(cleaned);
      if (m) {
        const raw = m[1];
        if (/^"[\s\S]*"$/.test(raw)) kv[key] = JSON.parse(raw);
        else kv[key] = raw === "null" ? null : raw;
      }
    }
    if (Object.keys(kv).length > 0) data = kv;
  }

  return {
    name: _safeString(data.name),
    set: _safeString(data.set),
    number: _safeNumber(data.number),
    variant: _safeVariant(data.variant),
    print: _safePrint(data.print),
    stamp: _safeStamp(data.stamp),
    confidence: _safeConfidence(data.confidence),
  };
}

// ── Default provider (OpenAI-compatible chat completions) ─────────────────────

/**
 * Default server-side vision provider. Calls an OpenAI-compatible
 * `/chat/completions` endpoint (image_url content) reading the config from env:
 *
 *   VISION_API_BASE_URL   default https://api.openai.com/v1
 *   VISION_API_KEY        required
 *   VISION_MODEL          default gpt-4o-mini
 *
 * Throws VisionNotConfigured when no key is present so the route fails loudly
 * (never a silent no-op), mirroring `condition_verifier.default_vision_fn`.
 */
export async function defaultVisionFn(imageUrl: string): Promise<string> {
  const baseUrl = (process.env.VISION_API_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const apiKey = process.env.VISION_API_KEY || "";
  const model = process.env.VISION_MODEL || "gpt-4o-mini";
  if (!apiKey) throw new VisionNotConfigured();

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: buildVisionPrompt() },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageUrl } },
            { type: "text", text: "Identify this Pokémon card." },
          ],
        },
      ],
      max_tokens: 400,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`vision provider HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("vision provider returned no content");
  return content;
}

// ── Public entry ──────────────────────────────────────────────────────────────

/** Extract structured card features from a photo via a vision model. */
export async function extractCardFeatures(
  imageUrl: string,
  visionFn: VisionFn = defaultVisionFn
): Promise<VisionFeatures> {
  const raw = await visionFn(imageUrl);
  return parseVisionText(raw);
}
