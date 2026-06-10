"use client";

import { useState, useMemo } from "react";

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
  type?: "expense" | "profit";
};

type Props = {
  cards: Card[];
  currentUser: "quez" | "stevie";
};

type Filter = "all" | "quez" | "stevie" | "expenses" | "profits";

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

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getDayLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";

  return date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

export default function Activity({ cards, currentUser }: Props) {
  const otherUser = currentUser === "quez" ? "stevie" : "quez";
  const currentUserCapitalized = currentUser.charAt(0).toUpperCase() + currentUser.slice(1);
  const otherUserCapitalized = otherUser.charAt(0).toUpperCase() + otherUser.slice(1);

  const [filter, setFilter] = useState<Filter>("all");

  const filteredCards = useMemo(() => {
    return cards.filter((c) => {
      const isProfit = c.type === "profit" || c.sale_price;
      if (filter === "quez") return c.paid_by === currentUserCapitalized;
      if (filter === "stevie") return c.paid_by === otherUserCapitalized;
      if (filter === "expenses") return !isProfit;
      if (filter === "profits") return isProfit;
      return true;
    });
  }, [cards, filter, currentUser]);

  const grouped = useMemo(() => {
    const groups: Record<string, Card[]> = {};
    for (const card of filteredCards) {
      const day = getDayLabel(card.created_at);
      if (!groups[day]) groups[day] = [];
      groups[day].push(card);
    }
    return groups;
  }, [filteredCards]);

  const dayOrder = Object.keys(grouped).sort(
    (a, b) => new Date(grouped[b][0].created_at).getTime() - new Date(grouped[a][0].created_at).getTime()
  );

  return (
    <div className="page page-narrow">
      <div className="filters" style={{ marginTop: 8 }}>
        <button
          className={`chip ${filter === "all" ? "on" : ""}`}
          onClick={() => setFilter("all")}
        >
          All
        </button>
        <button
          className={`chip ${filter === "quez" ? "on" : ""}`}
          onClick={() => setFilter("quez")}
        >
          <span className="dot u1"></span>{currentUserCapitalized}
        </button>
        <button
          className={`chip ${filter === "stevie" ? "on" : ""}`}
          onClick={() => setFilter("stevie")}
        >
          <span className="dot u2"></span>{otherUserCapitalized}
        </button>
        <button
          className={`chip ${filter === "expenses" ? "on" : ""}`}
          onClick={() => setFilter("expenses")}
        >
          Expenses
        </button>
        <button
          className={`chip ${filter === "profits" ? "on" : ""}`}
          onClick={() => setFilter("profits")}
        >
          Profits
        </button>
      </div>

      {dayOrder.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "48px 24px" }}>
          <p className="tx-amt" style={{ fontSize: "48px", marginBottom: "8px" }}>📭</p>
          <p style={{ color: "var(--text-mid)" }}>No entries match this filter</p>
        </div>
      ) : (
        dayOrder.map((day) => (
          <div key={day}>
            <div className="day-label">{day}</div>
            <div className="card tx-group">
              {grouped[day].map((card) => {
                const total = calcTotal(card);
                const isProfit = card.type === "profit" || card.sale_price;
                const amount = isProfit ? (card.sale_price || total) : -total;

                // Category icon
                let catIcon = "🃏";
                if (card.grading_fee > 0 || card.shipping_to_grader > 0 || card.shipping_from_grader > 0) {
                  catIcon = "⭐"; // Grading
                }
                if (isProfit) {
                  catIcon = "💰"; // Profit
                }

                return (
                  <div key={card.id} className="tx">
                    <div className="cat">{catIcon}</div>
                    <div className="tx-info">
                      <div className="t">{card.card_name} {card.card_id ? `#${card.card_id}` : ""}</div>
                      <div className="s">
                        <span className={`dot ${card.paid_by === currentUserCapitalized ? "u1" : "u2"}`}></span>
                        {card.paid_by} paid · {isProfit ? "Profit" : "Expense"}
                      </div>
                    </div>
                    <div className="tx-amt">
                      <div className={`a ${isProfit ? "pos" : "neg"}`}>
                        {isProfit ? "+" : "−"}${(isProfit ? (card.sale_price || total) : total).toFixed(2)}
                      </div>
                      <div className="half">
                        {isProfit
                          ? `${((card.sale_price || total) / 2).toFixed(2)} each`
                          : `${(total * (card.split_percent / 100)).toFixed(2)} each`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}