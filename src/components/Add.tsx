"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";

type Props = {
  onAdd: () => void;
  currentUser: "quez" | "stevie";
};

const CATEGORIES = [
  { key: "card", label: "🃏 Card", icon: "🃏" },
  { key: "grading", label: "⭐ Grading", icon: "⭐" },
  { key: "shipping", label: "📦 Shipping", icon: "📦" },
  { key: "supplies", label: "📦 Supplies", icon: "📦" },
  { key: "profit", label: "💰 Profit", icon: "💰" },
];

export default function Add({ onAdd, currentUser }: Props) {
  const otherUser = currentUser === "quez" ? "stevie" : "quez";
  const currentUserCapitalized = currentUser.charAt(0).toUpperCase() + currentUser.slice(1);
  const otherUserCapitalized = otherUser.charAt(0).toUpperCase() + otherUser.slice(1);

  const [rawAmount, setRawAmount] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("card");
  const [payer, setPayer] = useState<"quez" | "stevie">(currentUser);
  const [saving, setSaving] = useState(false);
  const [isDesktopTyping, setIsDesktopTyping] = useState(false);
  const descInputRef = useRef<HTMLInputElement>(null);

  const amountValue = rawAmount ? parseFloat(rawAmount) : 0;
  const halfAmount = amountValue / 2;
  const formattedAmount = rawAmount || "0.00";
  const formattedHalf = halfAmount.toFixed(2);

  // Handle keypad press
  const pressKey = (key: string) => {
    setRawAmount((prev) => {
      if (key === "del") {
        return prev.slice(0, -1);
      }
      if (key === ".") {
        if (!prev.includes(".")) return prev ? prev + "." : "0.";
        return prev;
      }
      // Limit to 7 digits + decimal
      const digitsOnly = prev.replace(".", "");
      if (digitsOnly.length >= 7) return prev;
      if (prev === "0" && key !== ".") return key;
      return prev + key;
    });
  };

  // Desktop keyboard support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if typing in description input
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

    setSaving(true);

    const isProfit = category === "profit";

    // Build the card object based on category
    const cardData: any = {
      card_name: description.trim(),
      card_id: null,
      purchase_price: isProfit ? 0 : amountValue,
      grading_fee: 0,
      shipping_to_grader: 0,
      shipping_from_grader: 0,
      insurance: 0,
      other_costs: 0,
      notes: "",
      paid_by: payer === "quez" ? currentUserCapitalized : otherUserCapitalized,
      split_percent: 50, // Always 50/50 for simplicity
      type: isProfit ? "profit" : "expense",
    };

    if (isProfit) {
      cardData.sale_price = amountValue;
      cardData.date_sold = new Date().toISOString().split("T")[0];
    } else if (category === "grading") {
      cardData.grading_fee = amountValue;
    } else if (category === "shipping") {
      cardData.shipping_to_grader = amountValue / 2;
      cardData.shipping_from_grader = amountValue / 2;
    }

    const { data, error } = await supabase.from("cards").insert([cardData]).select();

    setSaving(false);

    if (error) {
      alert("Error adding entry: " + error.message);
      return;
    }

    // Reset form
    setRawAmount("");
    setDescription("");
    setCategory("card");
    setPayer(currentUser);

    onAdd();
  };

  return (
    <div className="page page-narrow">
      <div className="card add-card">
        <div className="amount-entry">
          <span className="cur">$</span>
          <span className="val" id="amt-val">
            {rawAmount ? (
              rawAmount
            ) : (
              <span className="ph">0.00</span>
            )}
            <span className="caret"></span>
          </span>
          <div>
            <span className="split-pill" id="split-pill">
              ½&nbsp;${formattedHalf} each — always 50/50
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="desc-input">What was it?</label>
            <input
              ref={descInputRef}
              id="desc-input"
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
            <div className="cats" id="cat-row">
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
            <div className="payer-toggle" id="payer-row">
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

          {/* Mobile keypad */}
          <div className="keypad" id="keypad">
            <button type="button" className="key" onClick={() => pressKey("1")}>
              1
            </button>
            <button type="button" className="key" onClick={() => pressKey("2")}>
              2
            </button>
            <button type="button" className="key" onClick={() => pressKey("3")}>
              3
            </button>
            <button type="button" className="key" onClick={() => pressKey("4")}>
              4
            </button>
            <button type="button" className="key" onClick={() => pressKey("5")}>
              5
            </button>
            <button type="button" className="key" onClick={() => pressKey("6")}>
              6
            </button>
            <button type="button" className="key" onClick={() => pressKey("7")}>
              7
            </button>
            <button type="button" className="key" onClick={() => pressKey("8")}>
              8
            </button>
            <button type="button" className="key" onClick={() => pressKey("9")}>
              9
            </button>
            <button type="button" className="key" onClick={() => pressKey(".")}>
              .
            </button>
            <button type="button" className="key" onClick={() => pressKey("0")}>
              0
            </button>
            <button type="button" className="key" data-k="del" onClick={() => pressKey("del")}>
              ⌫
            </button>
          </div>

          <button
            type="submit"
            className="cta"
            disabled={saving || !amountValue || !description.trim()}
            style={{
              opacity: saving || !amountValue || !description.trim() ? 0.5 : 1,
              pointerEvents: saving ? "none" : "auto",
            }}
          >
            {saving ? "Saving..." : "Add &amp; split"}
          </button>
        </form>
      </div>
    </div>
  );
}