"use client";

import type {
  CardIdentityJson,
  Confidence,
  CurveRow,
  SourceRow,
  ValuationStatus,
} from "@/lib/valuation-ui";
import {
  buildSources,
  deriveCurveRows,
  formatTimestamp,
  identityTitle,
  money,
  statusMeta,
  type ConditionCurveJson,
  type PricePointJson,
} from "@/lib/valuation-ui";

// Presentational building blocks for the valuation result card. Each is pure:
// given props it renders, with no network/side-effect wiring, so they can be
// exercised directly in tests and in the /dev/valuation fixture page.

const TONE_COLOR: Record<string, string> = {
  pending: "var(--text-mid)",
  running: "var(--gold)",
  done: "var(--sage)",
  failed: "var(--clay)",
  blocked: "var(--clay)",
};

export function StatusBanner({
  status,
  error,
}: {
  status: ValuationStatus;
  error?: string | null;
}) {
  const meta = statusMeta(status, error ?? null);
  const color = TONE_COLOR[meta.tone] ?? "var(--text-mid)";
  return (
    <div
      data-testid="valuation-status"
      data-status={status}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 12px",
        borderRadius: 8,
        background: "var(--surface)",
        border: `1px solid ${color}`,
        color: color,
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      {meta.spinner && (
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            border: "2px solid currentColor",
            borderTopColor: "transparent",
            animation: "valuation-spin 0.8s linear infinite",
            display: "inline-block",
          }}
          aria-hidden
        />
      )}
      <span>{meta.label}</span>
    </div>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const color =
    confidence.level === "high"
      ? "var(--sage)"
      : confidence.level === "medium"
        ? "var(--gold)"
        : confidence.level === "low"
          ? "var(--clay)"
          : "var(--text-low)";
  return (
    <span
      data-testid="confidence-badge"
      data-level={confidence.level}
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        border: `1px solid ${color}`,
        color,
        fontSize: 10,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {confidence.label}
    </span>
  );
}

export function CurveTable({ rows }: { rows: CurveRow[] }) {
  return (
    <div
      data-testid="curve-table"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${rows.length}, 1fr)`,
        gap: 6,
      }}
    >
      {rows.map((r) => (
        <div
          key={r.condition}
          data-testid={`curve-${r.condition}`}
          data-has-data={r.hasData}
          style={{
            background: "var(--surface)",
            borderRadius: 8,
            padding: "8px 6px",
            textAlign: "center",
            border: r.hasData
              ? "1px solid var(--border)"
              : "1px dashed var(--border)",
            opacity: r.hasData ? 1 : 0.6,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-mid)" }}>
            {r.condition}
          </div>
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              marginTop: 2,
              color: r.hasData ? "var(--ink)" : "var(--text-low)",
            }}
          >
            {r.hasData ? money(r.estimatedPrice) : "—"}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-low)", marginTop: 2 }}>
            {r.sampleCount ? `${r.sampleCount} sample${r.sampleCount === 1 ? "" : "s"}` : "no samples"}
          </div>
          <div style={{ marginTop: 4 }}>
            <ConfidenceBadge confidence={r.confidence} />
          </div>
        </div>
      ))}
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  ebay: "eBay sold",
  tcgplayer: "TCGPlayer",
  psa: "PSA",
};

export function SourceList({ rows }: { rows: SourceRow[] }) {
  if (rows.length === 0) {
    return (
      <div
        data-testid="source-list"
        style={{ color: "var(--text-mid)", fontSize: 13, padding: "4px 0" }}
      >
        No individual listings were available to link.
      </div>
    );
  }
  return (
    <div data-testid="source-list" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((r) => (
        <div
          key={r.key}
          data-testid={`source-${r.source}`}
          data-trust={r.isTrustAnchor}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px",
            borderRadius: 8,
            background: r.isTrustAnchor ? "rgba(73,184,113,0.08)" : "var(--surface)",
            border: `1px solid ${r.isTrustAnchor ? "var(--sage)" : "var(--border)"}`,
          }}
        >
          <span style={{ fontSize: 11, color: "var(--text-low)", minWidth: 74 }}>
            {SOURCE_LABEL[r.source] ?? r.source}
          </span>
          <span style={{ fontSize: 13, color: "var(--ink)", fontWeight: 600 }}>
            {money(r.price)}
          </span>
          <span style={{ fontSize: 11, color: "var(--text-mid)" }}>
            {r.conditionVerified ? `verified ${r.conditionVerified}` : "condition unverified"}
            {r.isBestOffer ? " · best offer" : ""}
            {r.soldAt ? ` · ${formatTimestamp(r.soldAt)}` : ""}
          </span>
          {r.isTrustAnchor && (
            <span
              data-testid="trust-anchor"
              style={{
                marginLeft: "auto",
                fontSize: 10,
                fontWeight: 700,
                color: "var(--sage)",
                border: "1px solid var(--sage)",
                borderRadius: 999,
                padding: "1px 7px",
              }}
            >
              ★ trusted anchor
            </span>
          )}
          <a
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ marginLeft: "auto", color: "var(--sage)", fontSize: 12, fontWeight: 600 }}
          >
            Open →
          </a>
        </div>
      ))}
    </div>
  );
}

export function CardHeader({
  identity,
  imageUrl,
}: {
  identity: CardIdentityJson | null;
  imageUrl?: string | null;
}) {
  const title = identityTitle(identity);
  return (
    <div
      data-testid="card-header"
      style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={title}
          style={{ width: 56, height: 78, objectFit: "contain", borderRadius: 6 }}
          data-testid="card-image"
        />
      ) : (
        <div
          style={{
            width: 56,
            height: 78,
            borderRadius: 6,
            background: "var(--surface)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 26,
          }}
          aria-hidden
        >
          🃏
        </div>
      )}
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>
          {title || "Unknown card"}
        </div>
        {identity?.number && (
          <div style={{ fontSize: 12, color: "var(--text-mid)", marginTop: 2 }}>
            #{identity.number}
            {identity.set ? ` · ${identity.set}` : ""}
            {identity.variant ? ` · ${identity.variant}` : ""}
          </div>
        )}
      </div>
    </div>
  );
}

export interface ResultCardViewProps {
  status: ValuationStatus;
  error?: string | null;
  identity: CardIdentityJson | null;
  curve: ConditionCurveJson | null;
  points: PricePointJson[] | null;
  imageUrl?: string | null;
  lastUpdated?: string | null;
  onReRun?: () => void;
}

/**
 * Pure, stateless rendering of a valuation result in any state. The stateful
 * `<ValuationResultCard>` wires data + realtime into this via the same props.
 */
export function ValuationResultView(props: ResultCardViewProps) {
  const rows = deriveCurveRows(props.curve, props.points);
  const sources = buildSources(props.points);
  const done = props.status === "done";

  return (
    <div
      data-testid="valuation-result-card"
      style={{
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 16,
        background: "var(--bg)",
      }}
    >
      <StatusBanner status={props.status} error={props.error} />

      {done && (
        <>
          <div style={{ marginTop: 12 }}>
            <CardHeader identity={props.identity} imageUrl={props.imageUrl} />
          </div>

          <div style={{ fontSize: 13, fontWeight: 600, margin: "4px 0 8px", color: "var(--ink)" }}>
            Condition curve
          </div>
          <CurveTable rows={rows} />

          <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 8px", color: "var(--ink)" }}>
            Sources
          </div>
          <SourceList rows={sources} />

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 14,
              paddingTop: 12,
              borderTop: "1px dashed var(--border)",
            }}
          >
            <span style={{ fontSize: 11, color: "var(--text-low)" }}>
              Last updated {formatTimestamp(props.lastUpdated)}
            </span>
            <button
              data-testid="re-run"
              onClick={props.onReRun}
              className="cta"
              style={{ margin: 0, padding: "6px 12px", fontSize: 12 }}
            >
              ↻ Re-run
            </button>
          </div>
        </>
      )}

      {!done && (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 12, color: "var(--text-mid)" }}>
            {statusSpinnerNote(props.status)}
          </p>
        </div>
      )}
    </div>
  );
}

function statusSpinnerNote(status: ValuationStatus): string {
  switch (status) {
    case "pending":
      return "This card is in the queue. You'll be notified when research finishes.";
    case "claimed":
    case "running":
      return "An agent is pulling eBay sold listings, verifying condition, and cross-checking TCGPlayer. This usually takes a minute or two.";
    case "failed":
      return "The valuation hit an error. Try again, or re-run for a fresh attempt.";
    case "blocked":
      return "The card identity is ambiguous. A reviewer will resolve it before pricing continues.";
    default:
      return "";
  }
}
