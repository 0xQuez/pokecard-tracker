"use client";

import { useState, useCallback } from "react";
import type { CardPriceResult, CardIdentity } from "@/lib/models";

export default function PriceLookup() {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<CardIdentity[] | null>(null);
  const [selectedCard, setSelectedCard] = useState<CardPriceResult | null>(null);
  const [loadingPrice, setLoadingPrice] = useState(false);
  const [error, setError] = useState("");

  const handleSearch = useCallback(async () => {
    if (!query.trim() || query.length < 2) return;

    setSearching(true);
    setError("");
    setResults(null);
    setSelectedCard(null);

    try {
      const res = await fetch(`/api/prices/search?q=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");
      setResults(data.results);
    } catch (e: any) {
      setError(e.message || "Search failed");
    } finally {
      setSearching(false);
    }
  }, [query]);

  const handleSelectCard = useCallback(async (card: CardIdentity) => {
    setLoadingPrice(true);
    setError("");

    try {
      const res = await fetch(`/api/prices/lookup?id=${card.setId}&name=${encodeURIComponent(card.name)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lookup failed");
      setSelectedCard(data);
    } catch (e: any) {
      setError(e.message || "Price lookup failed");
    } finally {
      setLoadingPrice(false);
    }
  }, []);

  return (
    <div className="page page-narrow">
      <div className="topbar">
        <div className="hello">
          Price Lookup<b>Check card values on the go</b>
        </div>
        <div className="pair">
          <div className="avatar u1">Q</div>
          <div className="avatar u2">S</div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div className="field">
          <input
            className="text-input"
            type="text"
            placeholder='e.g. "Shadowless Charizard"'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            style={{ fontSize: 16, padding: "14px 16px" }}
          />
        </div>
        <button
          className="cta"
          onClick={handleSearch}
          disabled={searching || query.length < 2}
          style={{ width: "100%", margin: "0 0 16px" }}
        >
          {searching ? "Searching..." : "Search"}
        </button>
      </div>

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
                  View prices →
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {loadingPrice && (
        <div className="card" style={{ textAlign: "center", padding: 24 }}>
          <p style={{ color: "var(--text-mid)" }}>Fetching prices...</p>
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
              }}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-mid)",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              ← Back to results
            </button>
          </div>

          <div className="settle-hero" style={{ padding: "24px 20px" }}>
            {selectedCard.consolidated.tcgplayerMarket ? (
              <>
                <div style={{ fontSize: 12, color: "var(--text-low)", marginBottom: 4 }}>
                  TCGPlayer Market Price
                </div>
                <div className="big amount">
                  ${selectedCard.consolidated.tcgplayerMarket.toFixed(2)}
                </div>
              </>
            ) : selectedCard.consolidated.ebaySoldRange ? (
              <>
                <div style={{ fontSize: 12, color: "var(--text-low)", marginBottom: 4 }}>
                  eBay Sold Range
                </div>
                <div className="big amount">
                  ${selectedCard.consolidated.ebaySoldRange.low.toFixed(2)} –
                  ${selectedCard.consolidated.ebaySoldRange.high.toFixed(2)}
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 12, color: "var(--text-low)", marginBottom: 4 }}>
                  No prices found
                </div>
                <div className="big amount" style={{ opacity: 0.4 }}>
                  $—
                </div>
              </>
            )}
          </div>

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
                  <span className="l">eBay Median (sold)</span>
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
        </div>
      )}
    </div>
  );
}
