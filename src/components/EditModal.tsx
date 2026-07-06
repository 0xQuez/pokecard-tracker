"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import { calcTotal, userCapitalize } from "@/lib/helpers";

type Card = {
  id: number;
  created_at: string;
  card_name: string;
  card_id?: string;
  purchase_price: number;
  grading_fee: number;
  shipping_to_grader: number;
  shipping_from_grader: number;
  insurance: number;
  other_costs: number;
  notes?: string;
  paid_by: string;
  split_percent: number;
  date_acquired?: string;
  grade_received?: string;
  sale_price?: number;
  date_sold?: string;
  type?: "expense" | "profit" | "transfer";
  settled_at?: string;
  transfer_from?: string;
  transfer_to?: string;
  transfer_amount?: number;
};

type Props = {
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
  card: Card | null;
  currentUser: "quez" | "stevie";
};

const CATEGORIES = [
  { key: "card", label: "🃏 Card", icon: "🃏" },
  { key: "grading", label: "⭐ Grading", icon: "⭐" },
  { key: "shipping", label: "📦 Shipping", icon: "📦" },
  { key: "supplies", label: "🧰 Supplies", icon: "🧰" },
  { key: "sale", label: "💰 Sale", icon: "💰" },
  { key: "transfer", label: "💸 Transfer", icon: "💸" },
];

export default function EditModal({ onClose, onSave, onDelete, card, currentUser }: Props) {
  const otherUser = currentUser === "quez" ? "stevie" : "quez";
  const currentUserCapitalized = userCapitalize(currentUser);
  const otherUserCapitalized = userCapitalize(otherUser);

  const [rawAmount, setRawAmount] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("card");
  const [payer, setPayer] = useState<"quez" | "stevie">(currentUser);
  const [transferDirection, setTransferDirection] = useState<"current_to_other" | "other_to_current">("current_to_other");
  const [saleSplit, setSaleSplit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const descInputRef = useRef<HTMLInputElement>(null);

  const isTransfer = category === "transfer";
  const isSale = category === "sale";

  // Initialize form with card data
  useEffect(() => {
    if (card) {
      const total = calcTotal(card);
      const isProfitCard = card.type === "profit" || card.sale_price;
      const isTransferCard = card.type === "transfer";

      setRawAmount(isProfitCard ? (card.sale_price || total).toString() : total.toString());
      setDescription(card.card_name);
      if (isProfitCard) {
        setCategory("sale");
      } else if (isTransferCard) {
        setCategory("transfer");
        setTransferDirection(card.transfer_from === currentUserCapitalized ? "current_to_other" : "other_to_current");
      } else {
        setCategory("card");
      }
      setPayer(card.paid_by === currentUserCapitalized ? "quez" : "stevie");
      setSaleSplit(card.paid_by === "Both");
    }
  }, [card, currentUser]);

  const amountValue = rawAmount ? parseFloat(rawAmount) : 0;
  const halfAmount = amountValue / 2;
  const formattedHalf = halfAmount.toFixed(2);

  const pressKey = (key: string) => {
    setRawAmount((prev) => {
      if (key === "del") return prev.slice(0, -1);
      if (key === ".") {
        if (!prev.includes(".")) return prev ? prev + "." : "0.";
        return prev;
      }
      const digitsOnly = prev.replace(".", "");
      if (digitsOnly.length >= 7) return prev;
      if (prev === "0" && key !== ".") return key;
      return prev + key;
    });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement === descInputRef.current) return;
      if (/^[0-9.]$/.test(e.key)) {
        e.preventDefault();
        pressKey(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        pressKey("del");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amountValue || amountValue <= 0) return;
    if (!description.trim()) return;
    if (!card) return;

    setSaving(true);

    const cardData: any = {
      card_name: description.trim(),
      card_id: card.card_id,
      purchase_price: 0,
      grading_fee: 0,
      shipping_to_grader: 0,
      shipping_from_grader: 0,
      insurance: 0,
      other_costs: 0,
      notes: card.notes,
      paid_by: isSale && saleSplit ? "Both" : payer === "quez" ? currentUserCapitalized : otherUserCapitalized,
      split_percent: card.split_percent,
      type: isSale ? "profit" : isTransfer ? "transfer" : "expense",
      sale_price: null,
      date_sold: card.date_sold,
      date_acquired: card.date_acquired,
      grade_received: card.grade_received,
    };

    if (isSale) {
      cardData.sale_price = amountValue;
      cardData.date_sold = card.date_sold || new Date().toISOString().split("T")[0];
    } else if (isTransfer) {
      cardData.transfer_from = transferDirection === "current_to_other" ? currentUserCapitalized : otherUserCapitalized;
      cardData.transfer_to = transferDirection === "current_to_other" ? otherUserCapitalized : currentUserCapitalized;
      cardData.transfer_amount = amountValue;
    } else if (category === "grading") {
      cardData.grading_fee = amountValue;
    } else if (category === "shipping") {
      cardData.shipping_to_grader = amountValue / 2;
      cardData.shipping_from_grader = amountValue / 2;
    } else {
      cardData.purchase_price = amountValue;
    }

    const { error } = await supabase.from("cards").update(cardData).eq("id", card.id);

    setSaving(false);

    if (error) {
      alert("Error saving: " + error.message);
      return;
    }

    onSave();
    onClose();
  };

  const handleDelete = async () => {
    if (!card) return;
    if (!window.confirm("Delete this entry?")) return;

    setDeleting(true);

    const { error } = await supabase.from("cards").delete().eq("id", card.id);

    setDeleting(false);

    if (error) {
      alert("Error deleting: " + error.message);
      return;
    }

    onDelete();
    onClose();
  };

  if (!card) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Edit entry</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="amount-entry">
            <span className="cur">$</span>
            <span className="val">
              {rawAmount ? rawAmount : <span className="ph">0.00</span>}
              <span className="caret"></span>
            </span>
            <div>
              <span className="split-pill">
                {isTransfer
                  ? "Full transfer"
                  : isSale
                  ? saleSplit
                    ? "Split equally"
                    : `${formattedHalf} each owed`
                  : `${formattedHalf} each`}
              </span>
            </div>
          </div>

          <div className="field">
            <label htmlFor="edit-desc">What was it?</label>
            <input
              ref={descInputRef}
              id="edit-desc"
              className="text-input"
              type="text"
              placeholder={isSale ? "e.g. Charizard Base Set sale" : isTransfer ? "e.g. Settlement cash" : "e.g. Charizard Base Set purchase"}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label>Category</label>
            <div className="cats">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.key}
                  type="button"
                  className={`chip ${category === cat.key ? "on" : ""}`}
                  onClick={() => setCategory(cat.key)}
                >
                  {cat.icon} {cat.label}
                </button>
              ))}
            </div>
          </div>

          {!isTransfer && !isSale && (
            <div className="field">
              <label>Who paid?</label>
              <div className="payer-toggle">
                <button
                  type="button"
                  className={`payer ${payer === "quez" ? "on" : ""}`}
                  onClick={() => setPayer("quez")}
                >
                  <span className="avatar u1">{currentUserCapitalized[0]}</span>
                  {currentUserCapitalized}
                </button>
                <button
                  type="button"
                  className={`payer ${payer === "stevie" ? "on" : ""}`}
                  onClick={() => setPayer("stevie")}
                >
                  <span className="avatar u2">{otherUserCapitalized[0]}</span>
                  {otherUserCapitalized}
                </button>
              </div>
            </div>
          )}

          {isSale && (
            <div className="field">
              <label>Who collected?</label>
              <div className="payer-toggle">
                <button
                  type="button"
                  className={`payer ${payer === "quez" ? "on" : ""}`}
                  onClick={() => setPayer("quez")}
                >
                  <span className="avatar u1">{currentUserCapitalized[0]}</span>
                  {currentUserCapitalized}
                </button>
                <button
                  type="button"
                  className={`payer ${payer === "stevie" ? "on" : ""}`}
                  onClick={() => setPayer("stevie")}
                >
                  <span className="avatar u2">{otherUserCapitalized[0]}</span>
                  {otherUserCapitalized}
                </button>
              </div>

              <div style={{ marginTop: "12px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={saleSplit}
                    onChange={(e) => setSaleSplit(e.target.checked)}
                    style={{ width: "18px", height: "18px", accentColor: "var(--sage)" }}
                  />
                  <span style={{ color: "var(--text-mid)", fontSize: "14px" }}>
                    Did you split the cash from the sale?
                  </span>
                </label>
                <p style={{ fontSize: "12px", color: "var(--text-low)", marginTop: "6px", marginLeft: "28px" }}>
                  {saleSplit
                    ? "Cash was split equally. This reduces total debt."
                    : "One person kept the cash. Their share counts as collected."}
                </p>
              </div>
            </div>
          )}

          {isTransfer && (
            <div className="field">
              <label>Direction</label>
              <div className="payer-toggle" id="transfer-direction-row">
                <button
                  type="button"
                  className={`payer ${transferDirection === "current_to_other" ? "on" : ""}`}
                  onClick={() => setTransferDirection("current_to_other")}
                >
                  <span className="avatar u1">{currentUserCapitalized[0]}</span>
                  {currentUserCapitalized} → {otherUserCapitalized}
                </button>
                <button
                  type="button"
                  className={`payer ${transferDirection === "other_to_current" ? "on" : ""}`}
                  onClick={() => setTransferDirection("other_to_current")}
                >
                  <span className="avatar u2">{otherUserCapitalized[0]}</span>
                  {otherUserCapitalized} → {currentUserCapitalized}
                </button>
              </div>
            </div>
          )}

          <div className="keypad">
            <button type="button" className="key" onClick={() => pressKey("1")}>1</button>
            <button type="button" className="key" onClick={() => pressKey("2")}>2</button>
            <button type="button" className="key" onClick={() => pressKey("3")}>3</button>
            <button type="button" className="key" onClick={() => pressKey("4")}>4</button>
            <button type="button" className="key" onClick={() => pressKey("5")}>5</button>
            <button type="button" className="key" onClick={() => pressKey("6")}>6</button>
            <button type="button" className="key" onClick={() => pressKey("7")}>7</button>
            <button type="button" className="key" onClick={() => pressKey("8")}>8</button>
            <button type="button" className="key" onClick={() => pressKey("9")}>9</button>
            <button type="button" className="key" onClick={() => pressKey(".")}>.</button>
            <button type="button" className="key" onClick={() => pressKey("0")}>0</button>
            <button type="button" className="key" onClick={() => pressKey("del")}>⌫</button>
          </div>

          <div className="modal-actions">
            <button type="button" className="cta danger" onClick={handleDelete} disabled={deleting || saving}>
              {deleting ? "Deleting..." : "Delete"}
            </button>
            <button type="button" className="cta ghost" onClick={onClose} disabled={saving || deleting}>
              Cancel
            </button>
            <button type="submit" className="cta" disabled={saving || deleting || !amountValue || !description.trim()}>
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}