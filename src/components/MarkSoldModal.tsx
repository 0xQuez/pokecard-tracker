"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { calcTotal, Card } from "@/lib/helpers";

type Props = {
  card: Card;
  onClose: () => void;
  onSave: () => void;
};

function today(): string {
  return new Date().toISOString().split("T")[0];
}

export default function MarkSoldModal({ card, onClose, onSave }: Props) {
  const [rawAmount, setRawAmount] = useState("");
  const [saleDate, setSaleDate] = useState(today());
  const [saving, setSaving] = useState(false);

  const cost = calcTotal(card);
  const amountValue = rawAmount ? parseFloat(rawAmount) : 0;
  const pnl = amountValue - cost;
  const margin = cost > 0 ? (pnl / cost) * 100 : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amountValue || amountValue <= 0) return;

    setSaving(true);
    const { error } = await supabase
      .from("cards")
      .update({ sale_price: amountValue, date_sold: saleDate })
      .eq("id", card.id);

    setSaving(false);

    if (error) {
      alert("Error recording sale: " + error.message);
      return;
    }

    onSave();
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Mark as sold</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Card</label>
            <p style={{ margin: 0, fontSize: 15, color: "var(--text-hi)", fontWeight: 600 }}>
              {card.card_name}
            </p>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-mid)" }}>
              Purchase cost: <span className="amount neg">${cost.toFixed(2)}</span>
            </p>
          </div>

          <div className="field">
            <label htmlFor="sale-price">Sale price</label>
            <div className="amount-entry" style={{ marginBottom: 0 }}>
              <span className="cur">$</span>
              <input
                id="sale-price"
                className="text-input"
                style={{ fontSize: 28, fontWeight: 600, padding: "6px 0", border: "none", background: "transparent" }}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={rawAmount}
                onChange={(e) => setRawAmount(e.target.value)}
                autoFocus
                required
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="sale-date">Sale date</label>
            <input
              id="sale-date"
              className="text-input"
              type="date"
              value={saleDate}
              onChange={(e) => setSaleDate(e.target.value)}
            />
          </div>

          {amountValue > 0 && (
            <div
              className="breakdown"
              style={{ marginBottom: 16, background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: "var(--r-md)" }}
            >
              <div className="break-row">
                <span className="l">Cost basis</span>
                <span className="r amount">${cost.toFixed(2)}</span>
              </div>
              <div className="break-row">
                <span className="l">Sale price</span>
                <span className="r amount">${amountValue.toFixed(2)}</span>
              </div>
              <div className="break-row total">
                <span className="l">Profit / loss</span>
                <span className={`r amount ${pnl >= 0 ? "pos" : "neg"}`}>
                  {pnl >= 0 ? "+" : "−"}${Math.abs(pnl).toFixed(2)}
                  {margin !== null && (
                    <span style={{ fontSize: 12, marginLeft: 6 }}>
                      ({margin >= 0 ? "+" : "−"}{Math.abs(margin).toFixed(1)}%)
                    </span>
                  )}
                </span>
              </div>
            </div>
          )}

          <div className="modal-actions">
            <button type="button" className="cta ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="cta" disabled={saving || !amountValue || amountValue <= 0}>
              {saving ? "Saving..." : "Record sale"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
