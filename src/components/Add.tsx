"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import { userCapitalize } from "@/lib/helpers";

type Props = {
  onAdd: () => void;
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

export default function Add({ onAdd, currentUser }: Props) {
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
  const [isDesktopTyping, setIsDesktopTyping] = useState(false);
  const descInputRef = useRef<HTMLInputElement>(null);

  const isTransfer = category === "transfer";
  const isSale = category === "sale";

  const amountValue = rawAmount ? parseFloat(rawAmount) : 0;
  const halfAmount = amountValue / 2;
  const formattedAmount = rawAmount || "0.00";
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

  useEffect(() => {
    setIsDesktopTyping(rawAmount.length > 0);
  }, [rawAmount]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!amountValue || amountValue <= 0) return;
    if (!description.trim()) return;

    setSaving(true);

    const cardData: any = {
      card_name: description.trim(),
      card_id: null,
      purchase_price: 0,
      grading_fee: 0,
      shipping_to_grader: 0,
      shipping_from_grader: 0,
      insurance: 0,
      other_costs: 0,
      notes: "",
      paid_by: userCapitalize(payer),
      split_percent: 100,
      type: isTransfer ? "transfer" : isSale ? "profit" : "expense",
      sale_price: isSale ? amountValue : null,
      date_sold: isSale ? new Date().toISOString().split("T")[0] : null,
      date_acquired: null,
      grade_received: null,
    };

    if (isTransfer) {
      cardData.transfer_from = transferDirection === "current_to_other" ? currentUserCapitalized : otherUserCapitalized;
      cardData.transfer_to = transferDirection === "current_to_other" ? otherUserCapitalized : currentUserCapitalized;
      cardData.transfer_amount = amountValue;
    } else if (isSale) {
      // For sales, "paid_by" actually means "who collected"
      if (saleSplit) {
        // Cash was split 50/50 — mark as both collected
        cardData.paid_by = "Both";
      }
      // If not split, paid_by = collector (already set above)
    } else if (category === "grading") {
      cardData.grading_fee = amountValue;
    } else if (category === "shipping") {
      cardData.shipping_to_grader = amountValue / 2;
      cardData.shipping_from_grader = amountValue / 2;
    } else {
      cardData.purchase_price = amountValue;
    }

    const { error } = await supabase.from("cards").insert([cardData]);

    setSaving(false);

    if (error) {
      alert("Error adding entry: " + error.message);
      return;
    }

    // Reset form so next Add starts blank
    setRawAmount("");
    setDescription("");
    setCategory("card");
    setPayer(currentUser);
    setTransferDirection("current_to_other");
    setSaleSplit(false);

    onAdd();
  };

  const getPlaceholder = () => {
    if (isSale) return "e.g. Charizard Base Set sale";
    if (isTransfer) return "e.g. Settlement cash";
    return "e.g. Charizard Base Set purchase";
  };

  return (
    <div className="page page-narrow">
      <div className="amount-card">
        <div className="amount-entry">
          <span className="cur">$</span>
          <span className="val">
            {formattedAmount}
            {isDesktopTyping && <span className="caret"></span>}
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

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="desc">What was it?</label>
            <input
              ref={descInputRef}
              id="desc"
              className="text-input"
              type="text"
              placeholder={getPlaceholder()}
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
          )}

          {isSale && (
            <div className="field">
              <label>Who collected?</label>
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

          <button
            type="submit"
            className="cta"
            disabled={saving || !amountValue || !description.trim()}
            style={{ width: "100%", marginTop: "20px" }}
          >
            {saving ? "Saving..." : "Save entry"}
          </button>
        </form>
      </div>
    </div>
  );
}