"use client";

import { useEffect, useState } from "react";

import type {
  CardIdentityJson,
  Confidence,
  CurveRow,
  RegenerateShareOutcome,
  SourceRow,
  ValuationStatus,
} from "@/lib/valuation-ui";
import {
  buildSources,
  deriveCurveRows,
  formatTimestamp,
  identityTitle,
  money,
  shareLink,
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
        display: "block",
        padding: "2px 6px",
        borderRadius: 999,
        border: `1px solid ${color}`,
        color,
        fontSize: 10,
        fontWeight: 600,
        lineHeight: 1.25,
        textAlign: "center",
      }}
    >
      {confidence.label}
    </span>
  );
}

export function CurveTable({ rows }: { rows: CurveRow[] }) {
  const narrow = useIsNarrow();
  if (narrow) return <StackedCurveTable rows={rows} />;
  return (
    <div
      data-testid="curve-table"
      style={{
        display: "grid",
        // minmax(0,1fr) lets columns shrink below their content min-width so all
        // 5 condition columns always fit the container (critical on a 375px phone).
        gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))`,
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
            padding: "8px 4px",
            textAlign: "center",
            minWidth: 0,
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
              whiteSpace: "nowrap",
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

/**
 * Vertical, full-width curve rows for narrow screens (phones). Each condition is
 * its own readable row — the 5-column grid is too cramped below ~520px (long
 * words like "confidence" overflow the ~60px cells).
 */
function StackedCurveTable({ rows }: { rows: CurveRow[] }) {
  return (
    <div data-testid="curve-table" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((r) => (
        <div
          key={r.condition}
          data-testid={`curve-${r.condition}`}
          data-has-data={r.hasData}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "var(--surface)",
            borderRadius: 8,
            padding: "10px 12px",
            border: r.hasData ? "1px solid var(--border)" : "1px dashed var(--border)",
            opacity: r.hasData ? 1 : 0.6,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-mid)", width: 40, flexShrink: 0 }}>
            {r.condition}
          </div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              whiteSpace: "nowrap",
              color: r.hasData ? "var(--ink)" : "var(--text-low)",
              minWidth: 0,
            }}
          >
            {r.hasData ? money(r.estimatedPrice) : "—"}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-low)", whiteSpace: "nowrap" }}>
            {r.sampleCount ? `${r.sampleCount} sample${r.sampleCount === 1 ? "" : "s"}` : "no samples"}
          </div>
          <div style={{ marginLeft: "auto", flexShrink: 0 }}>
            <ConfidenceBadge confidence={r.confidence} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** True below 520px (phones). Falls back to the wide layout when matchMedia is unavailable. */
function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(max-width: 520px)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(max-width: 520px)");
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return narrow;
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
  /** Valuation's share token — shows the "Share with vendor" controls when present. */
  shareToken?: string | null;
  /** Rotate the share token (revokes old links). */
  onRegenerate?: () => Promise<RegenerateShareOutcome>;
  /** Injectable clipboard writer (tests). */
  shareCopy?: (text: string) => Promise<void> | void;
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

          {props.shareToken && (
            <ShareControls
              shareToken={props.shareToken}
              onRegenerate={props.onRegenerate}
              copy={props.shareCopy}
            />
          )}

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

// ── Share with vendor (T18.9) ───────────────────────────────────────────────

export interface ShareControlsProps {
  /** The valuation's share token (unlocks the public /valuation/share/<token> page). */
  shareToken: string | null | undefined;
  /** Page origin used to build the absolute share URL. Defaults to window.location.origin. */
  origin?: string;
  /** Rotate the token. Returns the new token on success. Optional — hides "Regenerate" when absent. */
  onRegenerate?: () => Promise<RegenerateShareOutcome>;
  /** Injectable clipboard writer for tests. Defaults to navigator.clipboard. */
  copy?: (text: string) => Promise<void> | void;
}

/**
 * "Share with vendor" + "Regenerate link". Copies the public share URL to the
 * clipboard, and lets the owner rotate the token (which revokes old links).
 */
export function ShareControls({ shareToken, origin, onRegenerate, copy }: ShareControlsProps) {
  const [copied, setCopied] = useState(false);
  const [regen, setRegen] = useState<"idle" | "working" | "done" | "error">("idle");
  const [regenMsg, setRegenMsg] = useState("");

  const originVal = origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  const link = shareLink(shareToken, originVal);
  const hasToken = Boolean(link);

  const writeClipboard = copy ?? ((text: string) => {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    return Promise.resolve();
  });

  const handleCopy = async () => {
    if (!link) return;
    await writeClipboard(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRegenerate = async () => {
    if (!onRegenerate) return;
    setRegen("working");
    setRegenMsg("");
    const out = await onRegenerate();
    if (out.kind === "ok") {
      setRegen("done");
      setRegenMsg("New link created. The old one is revoked.");
    } else {
      setRegen("error");
      setRegenMsg(out.message);
    }
  };

  if (!hasToken) {
    return (
      <div data-testid="share-controls" data-token="missing" style={{ fontSize: 12, color: "var(--text-low)" }}>
        Share link unavailable.
      </div>
    );
  }

  return (
    <div
      data-testid="share-controls"
      data-token="present"
      style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}
    >
      <div style={{ display: "flex", gap: 8 }}>
        <button
          data-testid="share-with-vendor"
          onClick={handleCopy}
          className="cta"
          style={{ flex: 1, margin: 0, padding: "8px 12px", fontSize: 13 }}
        >
          {copied ? "✓ Link copied" : "↗ Share with vendor"}
        </button>
        {onRegenerate && (
          <button
            data-testid="regenerate-link"
            onClick={handleRegenerate}
            disabled={regen === "working"}
            style={{
              padding: "8px 12px",
              fontSize: 12,
              borderRadius: 8,
              border: "1px solid var(--border)",
              color: "var(--text-mid)",
              background: "transparent",
              whiteSpace: "nowrap",
            }}
          >
            {regen === "working" ? "Rotating…" : "Regenerate link"}
          </button>
        )}
      </div>
      {regen === "done" && (
        <div data-testid="regenerate-ok" style={{ fontSize: 12, color: "var(--sage)" }}>
          {regenMsg}
        </div>
      )}
      {regen === "error" && (
        <div data-testid="regenerate-error" style={{ fontSize: 12, color: "var(--clay)" }}>
          {regenMsg}
        </div>
      )}
    </div>
  );
}

// ── Vendor-facing share page (T18.9) ────────────────────────────────────────

export interface VendorValuationViewProps {
  identity: CardIdentityJson | null;
  curve: ConditionCurveJson | null;
  points: PricePointJson[] | null;
  imageUrl?: string | null;
  lastUpdated?: string | null;
}

/**
 * The headline "condition-appropriate estimated market value". Defaults to the
 * NM estimate (raw cards are conventionally priced near-mint); falls back to the
 * first condition (NM→DMG) that has an estimate.
 */
export function headlineValue(curve: ConditionCurveJson | null | undefined): {
  condition: string;
  price: number | null;
  sampleCount: number | null;
} {
  const order: { cond: string; key: "NM" | "LP" | "MP" | "HP" | "DMG" }[] = [
    { cond: "Near Mint", key: "NM" },
    { cond: "Lightly Played", key: "LP" },
    { cond: "Moderately Played", key: "MP" },
    { cond: "Heavily Played", key: "HP" },
    { cond: "Damaged", key: "DMG" },
  ];
  for (const o of order) {
    const cell = curve?.[o.key];
    const price = cell?.estimated_price ?? null;
    if (typeof price === "number" && !Number.isNaN(price)) {
      return { condition: o.cond, price, sampleCount: cell?.sample_count ?? null };
    }
  }
  return { condition: "Near Mint", price: null, sampleCount: null };
}

/**
 * Minimal, deliberately plain single-page layout for the vendor share view.
 * No app chrome/nav — just identity, a big number, the per-condition curve,
 * clickable sources, and a "data as of" footer.
 */
export function VendorValuationView({
  identity,
  curve,
  points,
  imageUrl,
  lastUpdated,
}: VendorValuationViewProps) {
  const rows = deriveCurveRows(curve, points);
  const sources = buildSources(points);
  const head = headlineValue(curve);

  return (
    <div
      data-testid="vendor-valuation-view"
      style={{
        maxWidth: 480,
        margin: "0 auto",
        padding: 24,
        background: "var(--bg-0)",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-mid)", marginBottom: 12 }}>
        Estimated market value
      </div>

      <CardHeader identity={identity} imageUrl={imageUrl} />

      {/* Big number */}
      <div
        data-testid="headline-value"
        style={{
          borderRadius: 12,
          padding: "20px 16px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          textAlign: "center",
          marginTop: 4,
        }}
      >
        <div
          className="amount"
          style={{ fontSize: 40, fontWeight: 700, color: "var(--ink)", lineHeight: 1 }}
        >
          {money(head.price)}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-mid)", marginTop: 6 }}>
          {head.condition}
          {head.sampleCount ? ` · ${head.sampleCount} sample${head.sampleCount === 1 ? "" : "s"}` : ""}
        </div>
      </div>

      <div style={{ fontSize: 13, fontWeight: 600, margin: "20px 0 8px", color: "var(--ink)" }}>
        Per-condition estimates
      </div>
      <CurveTable rows={rows} />

      <div style={{ fontSize: 13, fontWeight: 600, margin: "20px 0 8px", color: "var(--ink)" }}>
        Sources
      </div>
      <SourceList rows={sources} />

      <div
        style={{
          marginTop: 24,
          paddingTop: 12,
          borderTop: "1px dashed var(--border)",
          fontSize: 11,
          color: "var(--text-low)",
          textAlign: "center",
        }}
      >
        Data as of {formatTimestamp(lastUpdated)}
      </div>
    </div>
  );
}
