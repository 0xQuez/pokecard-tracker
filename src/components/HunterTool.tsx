"use client";

import { useState, useCallback, useRef } from "react";
import WeeklyHunt from "@/components/WeeklyHunt";
import ValuationRequestButton from "@/components/valuation/ValuationRequestButton";
import ValuationResultCard from "@/components/valuation/ValuationResultCard";
import CardScanner from "@/components/hunter/CardScanner";
import CandidatePicker from "@/components/valuation/CandidatePicker";
import { supabase } from "@/lib/supabaseClient";
import { queueValuation, type QueueOutcome } from "@/lib/valuation-ui";
import { uploadCardImageToBucket } from "@/lib/card-image-upload";
import {
  identifyCard,
  resolveIdentity,
  buildQueueParams,
  type IdentifyCandidate,
} from "@/lib/scan-flow";
import type { CardPriceResult, CardIdentity, CardRarity, CardCondition, CardEdition, GradeLevel } from "@/lib/models";

export default function HunterTool() {
  const [activeTab, setActiveTab] = useState<"search" | "weekly">("search");
  return (
    <div className="page page-narrow">
      <div className="topbar">
        <div className="hello">
          HunterTool
          <b>Find cards worth buying &amp; grading</b>
        </div>
        <div className="pair">
          <div className="avatar u1">Q</div>
          <div className="avatar u2">S</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginTop: 12, marginBottom: 4 }}>
        <button
          onClick={() => setActiveTab("search")}
          style={{
            flex: 1,
            padding: "10px 0",
            borderRadius: 8,
            border: "1px solid",
            borderColor: activeTab === "search" ? "var(--ink)" : "var(--border)",
            background: activeTab === "search" ? "var(--ink)" : "transparent",
            color: activeTab === "search" ? "#fff" : "var(--text-mid)",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
        >
          🔍 Search &amp; Calc
        </button>
        <button
          onClick={() => setActiveTab("weekly")}
          style={{
            flex: 1,
            padding: "10px 0",
            borderRadius: 8,
            border: "1px solid",
            borderColor: activeTab === "weekly" ? "var(--ink)" : "var(--border)",
            background: activeTab === "weekly" ? "var(--ink)" : "transparent",
            color: activeTab === "weekly" ? "#fff" : "var(--text-mid)",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
        >
          🎯 Weekly Hunt
        </button>
      </div>

      {activeTab === "search" ? <SearchTab /> : <WeeklyHunt />}
    </div>
  );
}

function SearchTab() {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<(CardIdentity & { marketPrice?: number })[] | null>(null);
  const [selectedCard, setSelectedCard] = useState<CardPriceResult | null>(null);
  const [loadingPrice, setLoadingPrice] = useState(false);
  const [error, setError] = useState("");
  const [valuationRequestId, setValuationRequestId] = useState<number | null>(null);
  const [scannedFile, setScannedFile] = useState<File | null>(null);
  const [scannedUrl, setScannedUrl] = useState<string | null>(null);

  // ── Scan flow state machine (T22.7 glue) ──────────────────────────────────
  // idle → uploading → identifying → confirming → queuing → done (or error)
  type ScanStep =
    | "idle"
    | "uploading"
    | "identifying"
    | "confirming"
    | "queuing"
    | "done"
    | "error";
  const [scanStep, setScanStep] = useState<ScanStep>("idle");
  const [scanCandidates, setScanCandidates] = useState<IdentifyCandidate[]>([]);
  const [scanError, setScanError] = useState("");
  const [scanResultId, setScanResultId] = useState<number | null>(null);
  // Manual-entry fallback fields (no-match path).
  const [manualName, setManualName] = useState("");
  const [manualNumber, setManualNumber] = useState("");

  const RARITIES: CardRarity[] = [
    "common",
    "rare",
    "reverse holo",
    "holo rare",
    "ultra rare",
    "secret rare",
  ];
  const CONDITIONS: CardCondition[] = ["NM", "LP", "MP", "HP", "DMG"];
  const EDITIONS: CardEdition[] = [
    "1st Edition",
    "Unlimited",
    "shadowless",
    "no rarity symbol",
    "4th print",
  ];
  const GRADES: GradeLevel[] = ["PSA 6", "PSA 7", "PSA 8", "PSA 9", "PSA 10"];

  type FilterKey = "rarity" | "condition" | "edition" | "graded";

  const [filters, setFilters] = useState<Record<FilterKey, string | null>>({
    rarity: null,
    condition: null,
    edition: null,
    graded: null,
  });

  const [rawPriceInput, setRawPriceInput] = useState<number | "">("");

  const setFilter = (key: FilterKey, value: string | null) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const buildQuery = useCallback(() => {
    let q = query.trim();
    const parts: string[] = [];
    if (filters.rarity) parts.push(filters.rarity);
    if (filters.condition) parts.push(filters.condition);
    if (filters.edition) parts.push(filters.edition);
    if (filters.graded) parts.push(filters.graded);
    if (parts.length > 0) {
      q += " " + parts.join(" ");
    }
    return q;
  }, [query, filters]);

  const handleSearch = useCallback(async () => {
    const q = buildQuery();
    if (!q || q.length < 2) return;

    setSearching(true);
    setError("");
    setResults(null);
    setSelectedCard(null);

    try {
      const res = await fetch(
        `/api/hunter/search?q=${encodeURIComponent(q)}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");
      setResults(data.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }, [buildQuery]);

  const handleSelectCard = useCallback(
    async (card: CardIdentity & { marketPrice?: number }) => {
      setLoadingPrice(true);
      setError("");
      setValuationRequestId(null);
      try {
        const res = await fetch(
          `/api/hunter/lookup?id=${card.setId}&name=${encodeURIComponent(
            card.name
          )}`
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Lookup failed");
        setSelectedCard(data);
        if (data.consolidated?.tcgplayerMarket) {
          setRawPriceInput(data.consolidated.tcgplayerMarket);
        } else if (data.consolidated?.ebaySoldRange?.median) {
          setRawPriceInput(data.consolidated.ebaySoldRange.median);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Price lookup failed");
      } finally {
        setLoadingPrice(false);
      }
    },
    []
  );

  // ── On-demand valuation (T18.8) ─────────────────────────────────────────────
  const queryForCard = useCallback(
    (c: CardIdentity & { marketPrice?: number }) =>
      [c.name, c.set].filter(Boolean).join(" ").trim(),
    []
  );

  const handleValuationQueued = useCallback((o: QueueOutcome) => {
    if (o.kind !== "error") setValuationRequestId(o.requestId);
  }, []);

  // T22.1 — receive a captured image (File) from the scanner. No upload here;
  // a local object URL drives the preview until the identify step (T22.2).
  const scannedUrlRef = useRef<string | null>(null);
  const handleScanned = useCallback((file: File) => {
    if (scannedUrlRef.current) URL.revokeObjectURL(scannedUrlRef.current);
    const url = URL.createObjectURL(file);
    scannedUrlRef.current = url;
    setScannedFile(file);
    setScannedUrl(url);
    // New capture → reset the downstream scan flow.
    setScanStep("idle");
    setScanCandidates([]);
    setScanError("");
    setScanResultId(null);
    setManualName("");
    setManualNumber("");
  }, []);

  const clearScanned = useCallback(() => {
    if (scannedUrlRef.current) URL.revokeObjectURL(scannedUrlRef.current);
    scannedUrlRef.current = null;
    setScannedUrl(null);
    setScannedFile(null);
    setScanStep("idle");
    setScanCandidates([]);
    setScanError("");
    setScanResultId(null);
    setManualName("");
    setManualNumber("");
  }, []);

  // ── Scan flow (T22.7 glue) ─────────────────────────────────────────────────
  // Upload (T22.2) → identify (T22.5) → resolve (auto or confirm via T22.6)
  // → queue valuation (T18.8) → ValuationResultCard.

  // Confirm a chosen identity and queue its valuation (T18.8).
  const confirmIdentity = useCallback(async (identity: IdentifyCandidate) => {
    setScanError("");
    setScanCandidates([]);
    setScanStep("queuing");
    const outcome = await queueValuation(supabase, buildQueueParams(identity));
    if (outcome.kind === "error") {
      setScanError(outcome.message);
      setScanStep("error");
      return;
    }
    setScanResultId(outcome.requestId);
    setScanStep("done");
  }, []);

  const runScan = useCallback(async () => {
    if (!scannedFile) return;
    setScanError("");
    setScanResultId(null);
    setScanCandidates([]);
    setManualName("");
    setManualNumber("");

    // 1. Upload the captured image to the card-images bucket (T22.2).
    setScanStep("uploading");
    const up = await uploadCardImageToBucket(scannedFile, {
      fileName: scannedFile.name,
    });
    if (!up.ok) {
      setScanError(up.error.message);
      setScanStep("error");
      return;
    }

    // 2. Identify via POST /api/hunter/identify (T22.5).
    setScanStep("identifying");
    const id = await identifyCard(up.publicUrl);
    if (!id.ok) {
      setScanError(id.error);
      setScanStep("error");
      return;
    }

    // 3. Decide: auto-confirm the single match, or ask the user to pick.
    const outcome = resolveIdentity(id.data);
    if (outcome.mode === "auto") {
      await confirmIdentity(outcome.identity);
      return;
    }
    if (outcome.candidates.length === 0) {
      // No matches — offer manual entry fallback (routes to queueValuation).
      setScanError(
        "No card matched what was read from this image. You can enter the card details manually below."
      );
      setScanStep("error");
      return;
    }
    setScanCandidates(outcome.candidates);
    setScanStep("confirming");
  }, [scannedFile, confirmIdentity]);

  // Manual-entry fallback: route a typed name/number to the valuation queue.
  const confirmManualEntry = useCallback(async () => {
    const name = manualName.trim();
    const number = manualNumber.trim();
    if (!name) {
      setScanError("Enter at least the card name to value it.");
      setScanStep("error");
      return;
    }
    await confirmIdentity({
      name,
      set: null,
      number: number || null,
      variant: null,
      price: null,
      imageUrl: null,
      confidence: "low",
    });
  }, [manualName, manualNumber, confirmIdentity]);

  const retryScan = useCallback(() => {
    void runScan();
  }, [runScan]);

  const cancelScanConfirm = useCallback(() => {
    setScanCandidates([]);
    setScanError("");
    setScanStep("idle");
  }, []);

  const handleReRun = useCallback(async () => {
    if (!selectedCard) return;
    const outcome = await queueValuation(supabase, {
      cardQuery: queryForCard(selectedCard.card),
      userId: "Quez",
    });
    if (outcome.kind !== "error") setValuationRequestId(outcome.requestId);
  }, [selectedCard, queryForCard]);

  const totalCost =
    (typeof rawPriceInput === "number" ? rawPriceInput : 0) + 80 + 30;

  return (
    <>
      <div style={{ marginTop: 16 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
          <div className="field" style={{ flex: 1 }}>
            <input
              className="text-input"
              type="text"
              placeholder='e.g. "charizard 4/102"'
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              style={{ fontSize: 16, padding: "14px 16px" }}
            />
          </div>
          <CardScanner onCapture={handleScanned} />
        </div>

        {/* Filter chips */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 12,
          }}
        >
          {RARITIES.map((r) => (
            <button
              key={r}
              onClick={() =>
                setFilter("rarity", filters.rarity === r ? null : r)
              }
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                border: "1px solid",
                borderColor: filters.rarity === r ? "var(--clay)" : "var(--border)",
                background: filters.rarity === r ? "var(--clay)" : "transparent",
                color: filters.rarity === r ? "#fff" : "var(--text-mid)",
                fontSize: 12,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              {r}
            </button>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 12,
          }}
        >
          {CONDITIONS.map((c) => (
            <button
              key={c}
              onClick={() =>
                setFilter("condition", filters.condition === c ? null : c)
              }
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                border: "1px solid",
                borderColor: filters.condition === c ? "var(--sage)" : "var(--border)",
                background: filters.condition === c ? "var(--sage)" : "transparent",
                color: filters.condition === c ? "#fff" : "var(--text-mid)",
                fontSize: 12,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              {c}
            </button>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 12,
          }}
        >
          {EDITIONS.map((e) => (
            <button
              key={e}
              onClick={() =>
                setFilter("edition", filters.edition === e ? null : e)
              }
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                border: "1px solid",
                borderColor: filters.edition === e ? "var(--ink)" : "var(--border)",
                background: filters.edition === e ? "var(--ink)" : "transparent",
                color: filters.edition === e ? "#fff" : "var(--text-mid)",
                fontSize: 12,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              {e}
            </button>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 12,
          }}
        >
          {GRADES.map((g) => (
            <button
              key={g}
              onClick={() =>
                setFilter("graded", filters.graded === g ? null : g)
              }
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                border: "1px solid",
                borderColor: filters.graded === g ? "var(--gold)" : "var(--border)",
                background: filters.graded === g ? "var(--gold)" : "transparent",
                color: filters.graded === g ? "#fff" : "var(--text-mid)",
                fontSize: 12,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              {g}
            </button>
          ))}
        </div>

        <button
          className="cta"
          onClick={handleSearch}
          disabled={searching || query.length < 2}
          style={{ width: "100%", margin: "0 0 16px" }}
        >
          {searching ? "Searching…" : "Hunt"}
        </button>
      </div>

      {/* Scanned card (T19) — captured image handed back from the modal */}
      {scannedUrl && (
        <div
          className="card"
          style={{ marginTop: 12, padding: 12, border: "1px solid var(--sage)" }}
          data-testid="scanned-card"
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
              🃏 Scanned card
            </div>
            <button
              onClick={clearScanned}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-mid)",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          </div>
          <img
            src={scannedUrl}
            alt="Scanned card"
            style={{
              width: "100%",
              maxWidth: 240,
              borderRadius: 8,
              border: "1px solid var(--border)",
              display: "block",
            }}
          />
          <div
            style={{
              fontSize: 11,
              color: "var(--text-mid)",
              wordBreak: "break-all",
              marginTop: 6,
            }}
          >
            {scannedFile ? `${scannedFile.name} · ${Math.round(scannedFile.size / 1024)} KB` : "Captured image"}
          </div>

          {/* Identify CTA (T22.7) — starts the upload → identify → queue flow */}
          {scanStep === "idle" && (
            <button
              className="cta"
              onClick={() => void runScan()}
              data-testid="scan-identify"
              style={{ width: "100%", marginTop: 10 }}
            >
              Identify this card →
            </button>
          )}
        </div>
      )}

      {/* Scan flow loading states (T22.7) */}
      {(scanStep === "uploading" || scanStep === "identifying") && (
        <div className="card" style={{ textAlign: "center", padding: 20 }} data-testid="scan-loading">
          <p style={{ color: "var(--text-mid)" }}>
            {scanStep === "uploading" ? "Uploading image…" : "Identifying card…"}
          </p>
        </div>
      )}

      {scanStep === "queuing" && (
        <div className="card" style={{ textAlign: "center", padding: 20 }} data-testid="scan-queuing">
          <p style={{ color: "var(--text-mid)" }}>Queuing valuation…</p>
        </div>
      )}

      {/* Confirmation picker (T22.6) — the user must choose before anything queues */}
      {scanStep === "confirming" && (
        <div className="card" style={{ marginTop: 12, padding: 14 }} data-testid="scan-confirm">
          <CandidatePicker
            candidates={scanCandidates}
            onSelect={(c) => void confirmIdentity(c)}
            onCancel={cancelScanConfirm}
            title="Which card is this?"
            note="The scanner found a few possible prints — prices vary a lot between them."
          />
        </div>
      )}

      {/* Error + retry (T22.7) — never a dead end */}
      {scanStep === "error" && (
        <div
          className="card"
          style={{ marginTop: 12, padding: 16, border: "1px solid var(--clay)" }}
          data-testid="scan-error"
        >
          <div style={{ color: "var(--clay)", fontSize: 13, marginBottom: 12 }}>
            {scanError}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="cta"
              onClick={retryScan}
              data-testid="scan-retry"
              style={{ flex: 1 }}
            >
              Try again
            </button>
            <button
              onClick={clearScanned}
              style={{
                flex: 1,
                padding: "10px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "transparent",
                cursor: "pointer",
                color: "var(--text-mid)",
              }}
            >
              Start over
            </button>
          </div>

          {/* Manual-entry fallback for the no-match path */}
          <div style={{ marginTop: 14, borderTop: "1px dashed var(--border)", paddingTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)", marginBottom: 8 }}>
              Or enter the card manually
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                className="text-input"
                type="text"
                placeholder="Card name (e.g. Charizard)"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                data-testid="manual-name"
                style={{ flex: 2, fontSize: 14, padding: "10px 12px" }}
              />
              <input
                className="text-input"
                type="text"
                placeholder="Set # (e.g. 151/165)"
                value={manualNumber}
                onChange={(e) => setManualNumber(e.target.value)}
                data-testid="manual-number"
                style={{ flex: 1, fontSize: 14, padding: "10px 12px" }}
              />
            </div>
            <button
              className="cta"
              onClick={() => void confirmManualEntry()}
              data-testid="manual-submit"
              style={{ width: "100%" }}
            >
              Value this card →
            </button>
          </div>
        </div>
      )}

      {/* Valuation result for the scanned card (T18.8) */}
      {scanStep === "done" && scanResultId && (
        <div style={{ marginTop: 12 }}>
          <ValuationResultCard valuationId={scanResultId} />
        </div>
      )}

      {error && (
        <div
          className="card"
          style={{
            textAlign: "center",
            padding: 24,
            color: "var(--clay)",
            border: "1px solid var(--clay)",
          }}
        >
          {error}
        </div>
      )}

      {results && results.length === 0 && !error && (
        <div className="card" style={{ textAlign: "center", padding: 24 }}>
          <p style={{ fontSize: 32, marginBottom: 8 }}>🔍</p>
          <p style={{ color: "var(--text-mid)" }}>No cards found. Try a different search.</p>
        </div>
      )}

      {results && results.length > 0 && !selectedCard && (
        <div className="card tx-group" style={{ marginTop: 8 }}>
          {results.map((card, i) => (
            <button
              key={card.setId || i}
              className="tx"
              onClick={() => handleSelectCard(card)}
              style={{
                width: "100%",
                textAlign: "left",
                cursor: "pointer",
                border: "none",
                background: "transparent",
                color: "inherit",
                fontSize: "inherit",
              }}
            >
              <div className="cat">🃏</div>
              <div className="tx-info">
                <div className="t">{card.name}</div>
                {card.set && <div className="s">{card.set}</div>}
              </div>
              <div className="tx-amt">
                <div className="a" style={{ color: "var(--sage)" }}>
                  {card.marketPrice
                    ? `$${card.marketPrice.toFixed(2)}`
                    : "View →"}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {loadingPrice && (
        <div className="card" style={{ textAlign: "center", padding: 24 }}>
          <p style={{ color: "var(--text-mid)" }}>Fetching prices…</p>
        </div>
      )}

      {selectedCard && !loadingPrice && (
        <div style={{ marginTop: 16 }}>
          <div className="section-head">
            <h2>{selectedCard.card.name}</h2>
            <button
              onClick={() => {
                setSelectedCard(null);
                setResults(null);
                setRawPriceInput("");
              }}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-mid)",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              ← Back
            </button>
          </div>

          {/* Market price hero */}
          <div className="settle-hero" style={{ padding: "24px 20px" }}>
            {selectedCard.consolidated.tcgplayerMarket ? (
              <>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-low)",
                    marginBottom: 4,
                  }}
                >
                  TCGPlayer Market
                </div>
                <div className="big amount">
                  ${selectedCard.consolidated.tcgplayerMarket.toFixed(2)}
                </div>
              </>
            ) : selectedCard.consolidated.ebaySoldRange ? (
              <>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-low)",
                    marginBottom: 4,
                  }}
                >
                  eBay Sold Range
                </div>
                <div className="big amount">
                  ${selectedCard.consolidated.ebaySoldRange.low.toFixed(2)} –
                  ${selectedCard.consolidated.ebaySoldRange.high.toFixed(2)}
                </div>
              </>
            ) : (
              <>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-low)",
                    marginBottom: 4,
                  }}
                >
                  No prices found
                </div>
                <div className="big amount" style={{ opacity: 0.4 }}>
                  $—
                </div>
              </>
            )}
          </div>

          {/* On-demand valuation trigger (T18.8) */}
          <div className="card" style={{ marginTop: 12 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                marginBottom: 4,
                color: "var(--ink)",
              }}
            >
              Card Valuation
            </div>
            <p style={{ fontSize: 12, color: "var(--text-mid)", margin: "0 0 4px" }}>
              Get a per-condition price estimate (NM / LP / MP / HP / DMG) from recent
              eBay sold listings cross-checked against TCGPlayer. Takes a minute or two.
            </p>
            <ValuationRequestButton
              cardQuery={queryForCard(selectedCard.card)}
              userId="Quez"
              onValuation={handleValuationQueued}
            />
          </div>

          {/* Breakdown */}
          <div className="card breakdown" style={{ marginTop: 12 }}>
            {selectedCard.consolidated.tcgplayerMarket && (
              <div className="break-row">
                <span className="l">TCGPlayer Market</span>
                <span className="r amount">
                  ${selectedCard.consolidated.tcgplayerMarket.toFixed(2)}
                </span>
              </div>
            )}
            {selectedCard.consolidated.ebaySoldRange && (
              <>
                <div className="break-row">
                  <span className="l">eBay Low (sold)</span>
                  <span className="r amount">
                    ${selectedCard.consolidated.ebaySoldRange.low.toFixed(2)}
                  </span>
                </div>
                <div className="break-row">
                  <span className="l">Bay Median (sold)</span>
                  <span className="r amount">
                    ${selectedCard.consolidated.ebaySoldRange.median.toFixed(2)}
                  </span>
                </div>
                <div className="break-row">
                  <span className="l">eBay High (sold)</span>
                  <span className="r amount">
                    ${selectedCard.consolidated.ebaySoldRange.high.toFixed(2)}
                  </span>
                </div>
                <div className="break-row">
                  <span className="l">Recent sales</span>
                  <span className="r amount">
                    {selectedCard.consolidated.recentSoldCount}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* External links */}
          <div className="card" style={{ marginTop: 12 }}>
            <div className="break-row">
              <span className="l">eBay active listings</span>
              <a
                className="r"
                href={`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(
                  selectedCard.card.name + " pokemon card"
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--sage)" }}
              >
                Search →
              </a>
            </div>
            <div className="break-row">
              <span className="l">Sold listings</span>
              <a
                className="r"
                href={`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(
                  selectedCard.card.name + " pokemon card"
                )}&LH_Sold=1&LH_Complete=1`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--sage)" }}
              >
                View →
              </a>
            </div>
            <div className="break-row">
              <span className="l">PSA Population Report</span>
              <a
                className="r"
                href={`https://www.psacard.com/cert/${encodeURIComponent(
                  selectedCard.card.name.replace(/\s+/g, "-")
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--sage)" }}
              >
                Open →
              </a>
            </div>
          </div>

          {/* PSA Graded Prices */}
          {selectedCard.psaPrices && selectedCard.psaPrices.length > 0 && (
            <div className="card" style={{ marginTop: 12 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  marginBottom: 8,
                  color: "var(--ink)",
                }}
              >
                PSA Graded Sold Prices (eBay)
              </div>
              {<div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(5, 1fr)",
                  gap: 6,
                  textAlign: "center",
                }}
              >
                {selectedCard.psaPrices.map((p) => (
                  <div
                    key={p.grade}
                    style={{
                      background: "var(--surface)",
                      borderRadius: 8,
                      padding: "8px 4px",
                    }}
                  >
                    <div style={{ fontSize: 11, color: "var(--text-low)" }}>
                      {p.grade}
                    </div>
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 700,
                        marginTop: 2,
                      }}
                    >
                      ${p.avgSold.toFixed(0)}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-mid)" }}>
                      {p.count} sold
                    </div>
                  </div>
                ))}
              </div>}
            </div>
          )}

          {/* Buy calculator */}
          <div className="card" style={{ marginTop: 12 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                marginBottom: 10,
                color: "var(--ink)",
              }}
            >
              Buy Calculator
            </div>
            <div className="field" style={{ marginBottom: 10 }}>
              <label
                style={{
                  fontSize: 12,
                  color: "var(--text-mid)",
                  display: "block",
                  marginBottom: 4,
                }}
              >
                Raw card purchase price
              </label>
              <input
                className="text-input"
                type="number"
                min={0}
                step={0.01}
                value={rawPriceInput}
                onChange={(e) => {
                  const val = e.target.value;
                  setRawPriceInput(val === "" ? "" : Number(val));
                }}
                style={{ fontSize: 15, padding: "10px 12px" }}
              />
            </div>

            <div className="break-row">
              <span className="l">Grading fee</span>
              <span className="r amount">$80.00</span>
            </div>
            <div className="break-row">
              <span className="l">Shipping (to &amp; back)</span>
              <span className="r amount">$30.00</span>
            </div>
            <div
              className="break-row"
              style={{
                borderTop: "1px dashed var(--border)",
                paddingTop: 6,
                marginTop: 6,
              }}
            >
              <span className="l" style={{ fontWeight: 600 }}>
                Total cost
              </span>
              <span className="r amount" style={{ fontWeight: 700 }}>
                ${totalCost.toFixed(2)}
              </span>
            </div>

            {/* 2× metric per grade */}
            {selectedCard.hunt && (
              <div style={{ marginTop: 12 }}>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-mid)",
                    marginBottom: 6,
                  }}
                >
                  Is PSA sold price ≥ 2× total cost?
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(5, 1fr)",
                    gap: 6,
                  }}
                >
                  {selectedCard.psaPrices.map((p) => {
                    const gradeBuyKey = `psa${
                      p.grade.split(" ")[1]
                    }Buy` as keyof typeof selectedCard.hunt;
                    const isBuy = selectedCard.hunt
                      ? (selectedCard.hunt[gradeBuyKey] as boolean)
                      : false;
                    return (
                      <div
                        key={p.grade}
                        style={{
                          textAlign: "center",
                          padding: "6px 4px",
                          borderRadius: 8,
                          background: isBuy
                            ? "rgba(73,184,113,0.15)"
                            : "var(--surface)",
                          color: isBuy ? "var(--sage)" : "var(--text-mid)",
                          border: `1px solid ${
                            isBuy ? "var(--sage)" : "var(--border)"
                          }`,
                        }}
                      >
                        <div style={{ fontSize: 10, fontWeight: 600 }}>
                          {p.grade}
                        </div>
                        <div style={{ fontSize: 11, marginTop: 2 }}>
                          {isBuy ? "✅ BUY" : "❌ No"}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {selectedCard.hunt.bestMarginGrade && (
                  <div
                    style={{
                      marginTop: 10,
                      padding: "8px 10px",
                      borderRadius: 6,
                      background: "rgba(73,184,113,0.08)",
                      color: "var(--sage)",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    🎯 Best margin: {selectedCard.hunt.bestMarginGrade} at +$
                    {selectedCard.hunt.bestMargin.toFixed(0)} per card
                  </div>
                )}
              </div>
            )}
          </div>

          {/* On-demand valuation result (T18.8) */}
          {valuationRequestId && (
            <div style={{ marginTop: 12 }}>
              <ValuationResultCard
                valuationId={valuationRequestId}
                onReRun={handleReRun}
              />
            </div>
          )}
        </div>
      )}

    </>
  );
}
