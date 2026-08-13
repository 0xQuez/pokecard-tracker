"use client";

// Confirmation picker for the HunterTool scan flow (T21). After the identify API
// (T20) returns ambiguous candidates (e.g. regular Charmander 044 vs Pokemon
// Center Exclusive — same name/set/number, ~4x price gap), this lets the user
// tap the correct card before a valuation is queued.
//
// Pure / presentational: given candidates + a select handler it renders. No
// network, no side effects — so it can be exercised directly in vitest and on
// the /dev/scan fixture page.
import { money } from "@/lib/valuation-ui";
import type { IdentifyCandidate } from "@/lib/scan-flow";

export interface CandidatePickerProps {
  /** Top 2–3 candidates returned by the identify API. */
  candidates: IdentifyCandidate[];
  /** Called with the candidate the user tapped. */
  onSelect: (candidate: IdentifyCandidate) => void;
  /** Optional "start over" / close handler. */
  onCancel?: () => void;
  /** Headline, e.g. "Which card is this?" */
  title?: string;
  /** Optional warning/confidence note shown under the headline. */
  note?: string;
}

function candidateKey(c: IdentifyCandidate, i: number): string {
  return [c.set, c.number, c.variant, c.name, i].filter(Boolean).join("|");
}

const CONFIDENCE_COLOR: Record<string, string> = {
  high: "var(--sage)",
  medium: "var(--gold)",
  low: "var(--clay)",
};

export default function CandidatePicker({
  candidates,
  onSelect,
  onCancel,
  title = "Which card is this?",
  note,
}: CandidatePickerProps) {
  if (candidates.length === 0) {
    return (
      <div
        data-testid="candidate-picker"
        data-empty="true"
        style={{ padding: "16px 4px", color: "var(--text-mid)", fontSize: 13 }}
      >
        No matching cards found. Try rescanning or search by name instead.
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
          Tap the card you scanned — prices vary by print.
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {candidates.map((c, i) => {
          const price = typeof c.price === "number" ? money(c.price) : "—";
          const confidence = c.confidence ?? null;
          const confColor =
            (confidence && CONFIDENCE_COLOR[confidence]) || "var(--text-low)";
          return (
            <button
              key={candidateKey(c, i)}
              onClick={() => onSelect(c)}
              data-testid="candidate-card"
              data-price={typeof c.price === "number" ? c.price : ""}
              data-variant={c.variant ?? ""}
              data-confidence={confidence ?? ""}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                width: "100%",
                textAlign: "left",
                padding: 10,
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--surface)",
                cursor: "pointer",
                color: "inherit",
              }}
            >
              {c.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.imageUrl}
                  alt={c.name}
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
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>
                  {c.name}
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
                      fontSize: 10,
                      color: "var(--ink)",
                      fontWeight: 600,
                      marginTop: 2,
                    }}
                  >
                    {c.variant}
                  </div>
                )}
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
