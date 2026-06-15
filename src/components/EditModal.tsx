"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";

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
  card: Card | null;
  currentUser: "quez" | "stevie";
};

const CATEGORIES = [
  { key: "card", label: "🃏 Card", icon: "🃏" },
  { key: "grading", label: "⭐ Grading", icon: "⭐" },
  { key: "shipping", label: "📦 Shipping", icon: "📦" },
  { key: "supplies", label: "📦 Supplies", icon: "📦" },
  { key: "profit", label: "💰 Profit", icon: "💰" },
];

function calcTotal(c: Card): number {
  return (
    c.purchase_price +
    c.grading_fee +
    c.shipping_to_grader +
    c.shipping_from_grader +
    c.insurance +
    c.other_costs
  );
}

export default function EditModal({ onClose, onSave, card, currentUser }: Props) {
  const otherUser = currentUser === "quez" ? "stevie" : "quez";
  const currentUserCapitalized = currentUser.charAt(0).toUpperCase() + currentUser.slice(1);
  const otherUserCapitalized = otherUser.charAt(0).toUpperCase() + otherUser.slice(1);

  const [rawAmount, setRawAmount] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("card");
  const [payer, setPayer] = useState<"quez" | "stevie">(currentUser);
  const [saving, setSaving] = useState(false);
  const descInputRef = useRef<HTMLInputElement>(null);

  // Initialize form with card data
  useEffect(() => {
    if (card) {
      const total = calcTotal(card);
      const isProfit = card.type === "profit" || card.sale_price;

      setRawAmount(isProfit ? (card.sale_price || total).toString() : total.toString());
      setDescription(card.card_name);
      setCategory(isProfit ? "profit" : "card");
      setPayer(card.paid_by === currentUserCapitalized ? "quez" : "stevie");
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

    const isProfit = category === "profit";

    const cardData: any = {
      card_name: description.trim(),
      card_id: card.card_id,
      purchase_price: isProfit ? 0 : amountValue,
      grading_fee: 0,
      shipping_to_grader: 0,
      shipping_from_grader: 0,
      insurance: 0,
      other_costs: 0,
      notes: card.notes,
      paid_by: payer === "quez" ? currentUserCapitalized : otherUserCapitalized,
      split_percent: card.split_percent,
      type: isProfit ? "profit" : "expense",
      sale_price: card.sale_price,
      date_sold: card.date_sold,
      date_acquired: card.date_acquired,
      grade_received: card.grade_received,
    };

    if (isProfit) {
      cardData.sale_price = amountValue;
      cardData.date_sold = card.date_sold || new Date().toISOString().split("T")[0];
    } else if (category === "grading") {
      cardData.grading_fee = amountValue;
    } else if (category === "shipping") {
      cardData.shipping_to_grader = amountValue / 2;
      cardData.shipping_from_grader = amountValue / 2;
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
              <span className="split-pill">½&nbsp;${formattedHalf} each</span>
            </div>
          </div>

          <div className="field">
            <label htmlFor="edit-desc">What was it?</label>
            <input
              ref={descInputRef}
              id="edit-desc"
              className="text-input"
              type="text"
              placeholder={category === "profit" ? "e.g. Charizard Base Set sale" : "e.g. Charizard Base Set purchase"}
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
            <button type="button" className="cta ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="cta" disabled={saving || !amountValue || !description.trim()}>
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}