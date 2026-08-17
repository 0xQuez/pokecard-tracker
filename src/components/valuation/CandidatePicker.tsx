"use client";

// Confirmation picker for the HunterTool scan flow (T21). After the identify API
// (T20) returns ambiguous candidates (e.g. regular Charmander 044 vs Pokemon
// Center Exclusive — same name/set/number, ~4x price gap), this lets the user
// tap the correct card before a valuation is queued.
//
// T23.4: now renders a RANKED list of up to 20 embedding candidates with their
// hybrid similarity score (0..1 → % + bar), a "Best match" badge on the top
// pick, and progressive disclosure ("Show more" expands the top slice to the
// full list). Tap-to-confirm and the needsConfirmation=false auto-advance path
// are unchanged — this component only ever renders when needsConfirmation is
// true (the glue in scan-flow.resolveIdentity auto-resolves otherwise).
//
// Pure / presentational: given candidates + a select handler it renders. No
// network, no side effects — so it can be exercised directly in vitest.
import { useState } from "react";
import { money } from "@/lib/valuation-ui";
import type { IdentifyCandidate } from "@/lib/scan-flow";

export interface CandidatePickerProps {
  /** Up to 20 ranked candidates returned by the identify API. */
  candidates: IdentifyCandidate[];
  /** Called with the candidate the user tapped. */
  onSelect: (candidate: IdentifyCandidate) => void;
  /** Optional "start over" / close handler. */
  onCancel?: () => void;
  /** Headline, e.g. "Which card is this?" */
  title?: string;
  /** Optional warning/confidence note shown under the headline. */
  note?: string;
  /** How many candidates to show before the "Show more" expand (default 4). */
  initialVisibleCount?: number;
}

/** Default top slice before progressive disclosure kicks in. */
const DEFAULT_VISIBLE = 4;

function candidateKey(c: IdentifyCandidate, i: number): string {
  return [c.set, c.number, c.variant, c.name, i].filter(Boolean).join("|");
}

const CONFIDENCE_COLOR: Record<string, string> = {
  high: "var(--sage)",
  medium: "var(--gold)",
  low: "var(--clay)",
};

/** Sort by similarity score desc (stable) so the list is always ranked. */
function rankCandidates(candidates: IdentifyCandidate[]): IdentifyCandidate[] {
  return [...candidates].sort((a, b) => {
    const sa = typeof a.score === "number" ? a.score : -1;
    const sb = typeof b.score === "number" ? b.score : -1;
    return sb - sa;
  });
}

/** 0..1 score → "NN%" display string, or "—" when absent. */
function scorePct(score: number | null | undefined): string {
  return typeof score === "number" ? `${Math.round(score * 100)}%` : "—";
}

export default function CandidatePicker({
  candidates,
  onSelect,
  onCancel,
  title = "Which card is this?",
  note,
  initialVisibleCount = DEFAULT_VISIBLE,
}: CandidatePickerProps) {
  const [expanded, setExpanded] = useState(false);
  const ranked = rankCandidates(candidates);
  const showMore =
    !expanded && ranked.length > Math.max(1, initialVisibleCount);
  const visible = expanded ? ranked : ranked.slice(0, initialVisibleCount);

  if (candidates.length === 0) {
    return (
      <div
        data-testid="candidate-picker"
        data-empty="true"
        style={{ padding: "16px 4px", color: "var(--text-mid)", fontSize: 13 }}
      >
        No confident match. Try a clearer photo, then rescan.
      </div>
    );
  }

  return (
    <div data-testid="candidate-picker">
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>{title}</div>
        {note && (
          <div style={{ fontSize: 12, color: "var(--text-mid)", marginTop: 2 }}>{note}</div>
        )}
        <div style={{ fontSize: 11, color: "var(--text-low)", marginTop: 4 }}>
          {ranked.length > 1
            ? "Tap the card you scanned. Prices vary by print."
            : "Tap to confirm this card."}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {visible.map((c, i) => {
          const price = typeof c.price === "number" ? money(c.price) : "—";
          const confidence = c.confidence ?? null;
          const confColor =
            (confidence && CONFIDENCE_COLOR[confidence]) || "var(--text-low)";
          const isBest = i === 0;
          return (
            <button
              key={candidateKey(c, i)}
              onClick={() => onSelect(c)}
              data-testid="candidate-card"
              data-price={typeof c.price === "number" ? c.price : ""}
              data-variant={c.variant ?? ""}
              data-confidence={confidence ?? ""}
              data-score={typeof c.score === "number" ? c.score : ""}
              data-rank={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                width: "100%",
                textAlign: "left",
                padding: 10,
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: isBest ? "var(--surface)" : "var(--surface)",
                cursor: "pointer",
                color: "inherit",
              }}
            >
              {c.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.imageUrl}
                  alt={c.name}
                  loading="lazy"
                  decoding="async"
                  style={{
                    width: 44,
                    height: 60,
                    objectFit: "contain",
                    borderRadius: 5,
                    flexShrink: 0,
                    background: "#fff",
                  }}
                  data-testid="candidate-image"
                />
              ) : (
                <div
                  style={{
                    width: 44,
                    height: 60,
                    borderRadius: 5,
                    background: "var(--bg)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 20,
                    flexShrink: 0,
                  }}
                  aria-hidden
                >
                  🃏
                </div>
              )}

              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 14,
                    fontWeight: 700,
                    color: "var(--ink)",
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.name}
                  </span>
                  {isBest && ranked.length > 1 && (
                    <span
                      data-testid="best-match"
                      style={{
                        flexShrink: 0,
                        fontSize: 10,
                        fontWeight: 700,
                        color: "var(--sage-bright)",
                        background: "transparent",
                        textTransform: "none",
                        letterSpacing: 0,
                      }}
                    >
                      Best match
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-mid)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {[c.set, c.number ? `#${c.number}` : null, c.variant]
                    .filter(Boolean)
                    .join(" · ") || "Unknown print"}
                </div>
                {c.variant && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 6,
                      marginTop: 2,
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        color: "var(--ink)",
                        fontWeight: 600,
                      }}
                    >
                      {c.variant}
                    </span>
                    {/* T30.5: per-variant market-price hint so the user sees the
                        price gap while choosing (e.g. regular ≈$15 vs reverse
                        holo ≈$250). Only rendered when the identify response
                        carries a price for this finish. */}
                    {typeof c.price === "number" && (
                      <span
                        data-testid="variant-price-hint"
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: "var(--sage)",
                        }}
                      >
                        ≈{money(c.price)}
                      </span>
                    )}
                  </div>
                )}
                {/* Similarity score — % + bar so the ranking is readable at a glance */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginTop: 4,
                  }}
                >
                  <div
                    data-testid="candidate-score"
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: confColor,
                      flexShrink: 0,
                      minWidth: 36,
                    }}
                  >
                    {scorePct(c.score)}
                  </div>
                  <div
                    style={{
                      flex: 1,
                      height: 4,
                      borderRadius: 999,
                      background: "var(--bg)",
                      overflow: "hidden",
                    }}
                    data-testid="candidate-score-bar-track"
                  >
                    <div
                      data-testid="candidate-score-bar"
                      style={{
                        height: "100%",
                        width: `${
                          typeof c.score === "number"
                            ? Math.max(0, Math.min(1, c.score)) * 100
                            : 0
                        }%`,
                        background: confColor,
                        borderRadius: 999,
                      }}
                    />
                  </div>
                </div>
              </div>

              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div
                  style={{ fontSize: 16, fontWeight: 700, color: "var(--sage)" }}
                  data-testid="candidate-price"
                >
                  {price}
                </div>
                {confidence && (
                  <div
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: confColor,
                      marginTop: 3,
                      textTransform: "uppercase",
                    }}
                  >
                    {confidence}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {showMore && (
        <button
          onClick={() => setExpanded(true)}
          data-testid="show-more"
          style={{
            marginTop: 10,
            width: "100%",
            padding: "8px",
            borderRadius: 8,
            border: "1px dashed var(--border)",
            background: "transparent",
            color: "var(--ink)",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Show more ({ranked.length - visible.length} more)
        </button>
      )}

      {onCancel && (
        <button
          onClick={onCancel}
          style={{
            marginTop: 10,
            width: "100%",
            padding: "8px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text-mid)",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          ← Start over
        </button>
      )}
    </div>
  );
}
