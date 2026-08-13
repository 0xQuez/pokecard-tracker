/**
 * vision-identify.ts — Vision-based Pokémon card identity extraction (T22.3).
 *
 * Given a photo of a card, ask a vision model to read the identifying text off
 * it and return it as STRICT JSON, then validate + coerce that payload through
 * a zod schema so nothing unhandled leaks into the pipeline.
 *
 * Calling pattern mirrors the T18.5 condition verifier (`condition_verifier.py`
 * / `src/lib/identify/card-vision.ts`):
 *
 *   1. VISION ACQUISITION is an injectable `visionFn(imageUrl) -> string`.
 *      In the server runtime a concrete provider (OpenAI-compatible chat
 *      completions with image_url support) is supplied by the caller; tests
 *      inject a canned reply. `defaultVisionFn` is provided as the default and
 *      fails loudly (never a silent no-op) when not configured.
 *   2. JUDGEMENT is deterministic and offline-testable: parse the model text
 *      (tolerant of a stray code fence or prose wrapper), coerce through a zod
 *      schema, and decide "readable identity" vs "unreadable".
 *
 * VARIANT / STAMP / PRINT are the ambiguous-identity tiebreakers. A Pokemon
 * Center (PC) collector stamp, a 1st Edition stamp, and a shadowless border
 * all change which physical product a photo depicts even when name + number
 * match a single catalog record — so the prompt demands them explicitly.
 *
 * The public contract:
 *
 *   extractCardIdentity(imageUrl) -> CardIdentityResult
 *   CardIdentity = { name, setName, setCode?, collectorNumber, variant,
 *                    print, stamp, confidence }
 *   unreadable   = { error: "unreadable" }   // blurry / no readable identity
 */

import { z } from "zod";

// ── Canonical output types (the module's public contract) ────────────────────

export type Variant = "holo" | "reverse_holo" | "regular" | null;
export type Print = "1st_edition" | "unlimited" | "shadowless" | null;

/** Structured identity read off the photo by the vision model. */
export interface CardIdentity {
  /** Card name as printed, e.g. "Charmander". */
  name: string;
  /** Set name as read off the card, e.g. "Scarlet & Violet Black Star Promos". */
  setName: string;
  /** Set code/symbol when readable, e.g. "SVP" / "svp". Optional. */
  setCode?: string | null;
  /** Collector number as printed, e.g. "044/SVP 44" or "44". */
  collectorNumber: string;
  variant: Variant;
  print: Print;
  /** Collector stamp, e.g. "Pokemon Center". null = none. */
  stamp: string | null;
  /** Vision model's confidence that it read the card, 0..1. */
  confidence: number;
}

/** Graceful failure for an unreadable/blurry photo — never a hallucination. */
export interface UnreadableResult {
  error: "unreadable";
}

/** Union returned by extractCardIdentity. */
export type CardIdentityResult = CardIdentity | UnreadableResult;

/** Injectable vision call: imageUrl -> raw model text (may be non-JSON). */
export type VisionFn = (imageUrl: string) => Promise<string> | string;

/** Thrown when the caller has no vision provider configured. */
export class VisionNotConfigured extends Error {
  constructor() {
    super(
      "No vision provider configured. Set VISION_API_BASE_URL, VISION_API_KEY " +
        "and VISION_MODEL (OpenAI-compatible chat completions with image_url " +
        "support) to enable card identity extraction."
    );
    this.name = "VisionNotConfigured";
  }
}

// ── zod schema for the model's raw JSON reply ────────────────────────────────

/**
 * Loose schema for the vision model's raw output. We intentionally accept
 * free-form strings for the enums and coerce them to canonical values below
 * (models disagree on "reverse holo" vs "reverse-holo" vs "reverse_holo").
 * Anything the model sends is coerced or nulled — never thrown.
 */
const VisionReplySchema = z.object({
  name: z.string().nullable().optional(),
  setName: z.string().nullable().optional(),
  set: z.string().nullable().optional(), // tolerant alias for setName
  setCode: z.string().nullable().optional(),
  collectorNumber: z.string().nullable().optional(),
  number: z.string().nullable().optional(), // tolerant alias
  variant: z.string().nullable().optional(),
  print: z.string().nullable().optional(),
  stamp: z.string().nullable().optional(),
  confidence: z.union([z.number(), z.string()]).nullable().optional(),
});
type VisionReply = z.infer<typeof VisionReplySchema>;

// ── Strict-JSON prompt ───────────────────────────────────────────────────────

export const VISION_STRICT_JSON =
  "Return ONLY a single JSON object, no prose, no markdown fences. " +
  'Keys exactly: "name" (string or null), "setName" (string or null), ' +
  '"setCode" (string or null, e.g. "SVP"), "collectorNumber" (string like ' +
  '"044/SVP 44" or "44", or null), "variant" (one of "holo", ' +
  '"reverse_holo", "regular", or null), "print" (one of "1st_edition", ' +
  '"unlimited", "shadowless", or null), "stamp" (string describing any ' +
  "collector stamp/logos, or null), confidence (number 0.0-1.0).";

export function buildVisionPrompt(): string {
  return (
    "You are a professional Pokémon TCG cataloger inspecting a single photo of " +
    "one card. The photo may be worn, angled, or poorly lit — read what you can " +
    "and set a field to null rather than guessing.\n\n" +
    "- name: the card's printed name (e.g. \"Charmander\").\n" +
    "- setName: the set symbol/set name printed on the card (e.g. \"Scarlet & " +
    "Violet Black Star Promos\").\n" +
    "- setCode: the set code/symbol if legible (e.g. \"SVP\", \"SV1\").\n" +
    "- collectorNumber: the card number in the corner exactly as printed, " +
    "including any set qualifier (e.g. \"044/SVP 44\" or just \"44\").\n" +
    "- variant: \"holo\" if the artwork is foiled/reflective, \"reverse_holo\" " +
    "if the foil is on the frame/border only, \"regular\" if flat.\n" +
    "- print: \"1st_edition\" only if you clearly see the 1st Edition stamp, " +
    "\"shadowless\" if a vintage Base Set card with no drop-shadow on the " +
    "right border, \"unlimited\" if it is clearly an unlimited print, else null.\n" +
    "- stamp: describe any collector stamp or logo printed on the card, e.g. " +
    "\"Pokemon Center\", \"Professor\", \"Staff\", or a promo/event stamp. " +
    "This is critical — a Pokemon Center (PC) stamped promo is a different, " +
    "often far more valuable product than the regular print, so call it out " +
    "explicitly. Set to null if there is no stamp.\n" +
    "- confidence: how confident you are that you read the identity correctly, 0.0-1.0.\n\n" +
    VISION_STRICT_JSON
  );
}

// ── Coercion helpers ─────────────────────────────────────────────────────────

function _clean(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = s.trim();
  if (t === "" || /^null$/i.test(t)) return null;
  return t;
}

function _coerceVariant(v: unknown): Variant {
  const s = _clean(typeof v === "string" ? v : v == null ? null : String(v));
  if (!s) return null;
  const low = s.toLowerCase().replace(/[\s_-]+/g, "_");
  if (low.includes("reverse")) return "reverse_holo";
  if (low.includes("holo") || low === "holofoil" || low === "holo_foil")
    return "holo";
  if (low === "regular" || low === "normal" || low === "flat") return "regular";
  return null;
}

function _coercePrint(v: unknown): Print {
  const s = _clean(typeof v === "string" ? v : v == null ? null : String(v));
  if (!s) return null;
  const low = s.toLowerCase().replace(/[\s_-]+/g, "_");
  if (low.includes("1st") || low.includes("first") || low === "1") return "1st_edition";
  if (low.includes("shadow")) return "shadowless";
  if (low.includes("unlimited")) return "unlimited";
  return null;
}

function _coerceStamp(v: unknown): string | null {
  const s = _clean(typeof v === "string" ? v : v == null ? null : String(v));
  if (!s) return null;
  const low = s.toLowerCase();
  if (low === "none" || low === "null" || low === "no stamp" || low === "none seen")
    return null;
  return s;
}

function _coerceConfidence(v: unknown): number {
  if (v == null) return 0.5;
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function _stripCodeFences(text: string): string {
  const m = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(text.trim());
  return m ? m[1].trim() : text.trim();
}

/** Pull `key: value` pairs out of free-form model prose (tolerant fallback). */
function _kvFallback(text: string): VisionReply {
  const data: VisionReply = {};
  for (const key of [
    "name",
    "setName",
    "set",
    "setCode",
    "collectorNumber",
    "number",
    "variant",
    "print",
    "stamp",
    "confidence",
  ]) {
    const m = new RegExp(
      `["']?${key}["']?\\s*[:=]\\s*("(?:[^"\\\\]|\\\\.)*"|null|[0-9.]+|[A-Za-z0-9_ ]+)`,
      "i"
    ).exec(text);
    if (!m) continue;
    const raw = m[1].trim();
    if (/^"[^"]*"$/.test(raw)) (data as Record<string, unknown>)[key] = JSON.parse(raw);
    else if (/^null$/i.test(raw)) (data as Record<string, unknown>)[key] = null;
    else (data as Record<string, unknown>)[key] = raw;
  }
  return data;
}

/**
 * Parse the vision model's reply into a canonical CardIdentity.
 * Tolerant: strict JSON first, then a key:value free-text fallback — a
 * slightly-off reply still yields usable identity instead of crashing the
 * pipeline (same philosophy as `condition_verifier.parse_vision_text`).
 */
export function parseVisionText(text: string): CardIdentity | UnreadableResult {
  const cleaned = _stripCodeFences(text);
  let data: VisionReply = {};

  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object") data = parsed as VisionReply;
  } catch {
    data = _kvFallback(cleaned);
  }

  const reply = VisionReplySchema.safeParse(data);
  const r = reply.success ? reply.data : {};

  const name = _clean(r.name) ?? _clean(r.setName) ?? null;
  const setName = _clean(r.setName) ?? _clean(r.set) ?? null;
  const setCode = _clean(r.setCode) ?? null;
  const collectorNumber =
    _clean(r.collectorNumber) ?? _clean(r.number) ?? null;

  const identity: CardIdentity = {
    name: name ?? "",
    setName: setName ?? "",
    setCode,
    collectorNumber: collectorNumber ?? "",
    variant: _coerceVariant(r.variant),
    print: _coercePrint(r.print),
    stamp: _coerceStamp(r.stamp),
    confidence: _coerceConfidence(r.confidence),
  };

  // Unreadable: no name AND no collector number -> we cannot anchor a match.
  // Returning a hallucinated guess here is worse than saying "can't tell".
  if (!identity.name && !identity.collectorNumber) {
    return { error: "unreadable" };
  }

  return identity;
}

// ── Default provider (OpenAI-compatible chat completions) ────────────────────

/**
 * Default server-side vision provider. Calls an OpenAI-compatible
 * `/chat/completions` endpoint (image_url content) reading config from env:
 *
 *   VISION_API_BASE_URL   default https://api.openai.com/v1
 *   VISION_API_KEY        required
 *   VISION_MODEL          default gpt-4o-mini
 *
 * Throws VisionNotConfigured when no key is present so callers fail loudly,
 * mirroring `condition_verifier.default_vision_fn`.
 */
export async function defaultVisionFn(imageUrl: string): Promise<string> {
  const baseUrl = (process.env.VISION_API_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const apiKey = process.env.VISION_API_KEY || "";
  const model = process.env.VISION_MODEL || "gpt-4o-mini";
  if (!apiKey) throw new VisionNotConfigured();

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": "pokecards/vision-identify",
    },
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
    choices?: { message?: { content?: string | null } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("vision provider returned no content");
  return content;
}

// ── Public entry ─────────────────────────────────────────────────────────────

/**
 * Extract a canonical card identity from a photo via a vision model.
 *
 * Returns a CardIdentity on success, or `{ error: "unreadable" }` when the
 * model could not read a usable name/collector number (blurry, off-frame,
 * non-card). Never throws on model junk — the zod coercion absorbs it.
 */
export async function extractCardIdentity(
  imageUrl: string,
  visionFn: VisionFn = defaultVisionFn
): Promise<CardIdentityResult> {
  const raw = await visionFn(imageUrl);
  return parseVisionText(raw);
}
