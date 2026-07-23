"use client";

import { useState, useMemo } from "react";
import { calcTotal, formatDate, getDayLabel, userCapitalize } from "@/lib/helpers";

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
  cards: Card[];
  currentUser: "quez" | "stevie";
  onEdit?: (card: Card) => void;
};

type Filter = "all" | "quez" | "stevie" | "expenses" | "profits";

export default function Activity({ cards, currentUser, onEdit }: Props) {
  const otherUser = currentUser === "quez" ? "stevie" : "quez";
  const currentUserCapitalized = userCapitalize(currentUser);
  const otherUserCapitalized = userCapitalize(otherUser);

  const [filter, setFilter] = useState<Filter>("all");

  const filteredCards = useMemo(() => {
    return cards.filter((c) => {
      const isProfit = c.type === "profit" || c.sale_price;
      const isTransfer = c.type === "transfer";
      if (filter === "quez") return c.paid_by === currentUserCapitalized || c.transfer_from === currentUserCapitalized || c.transfer_to === currentUserCapitalized;
      if (filter === "stevie") return c.paid_by === otherUserCapitalized || c.transfer_from === otherUserCapitalized || c.transfer_to === otherUserCapitalized;
      if (filter === "expenses") return !isProfit && !isTransfer;
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
      <div className="filters">
        <button className={`chip ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")}>All</button>
        <button className={`chip ${filter === "quez" ? "on" : ""}`} onClick={() => setFilter("quez")}>
          <span className="dot u1"></span>{currentUserCapitalized}
        </button>
        <button className={`chip ${filter === "stevie" ? "on" : ""}`} onClick={() => setFilter("stevie")}>
          <span className="dot u2"></span>{otherUserCapitalized}
        </button>
        <button className={`chip ${filter === "expenses" ? "on" : ""}`} onClick={() => setFilter("expenses")}>
          Expenses
        </button>
        <button className={`chip ${filter === "profits" ? "on" : ""}`} onClick={() => setFilter("profits")}>
          Profits
        </button>
      </div>

      {dayOrder.length === 0 ? (
        <div className="empty-activity">
          <p className="empty-icon">📭</p>
          <p className="empty-title">{filter === "all" ? "No entries yet" : "Nothing matches this filter"}</p>
          <p className="empty-text">{filter === "all" ? "Add cards to see activity here." : "Try another filter to see more results."}</p>
        </div>
      ) : (
        dayOrder.map((day) => (
          <div key={day}>
            <div className="day-label">{day}</div>
            <div className="card tx-group">
              {grouped[day].map((card) => {
                const total = calcTotal(card);
                const isTransfer = card.type === "transfer";
                const isProfit = card.type === "profit" || card.sale_price;
                const amount = isTransfer ? total : isProfit ? (card.sale_price || total) : -total;

                let catIcon = "🃏";
                if (card.grading_fee > 0 || card.shipping_to_grader > 0 || card.shipping_from_grader > 0) {
                  catIcon = "⭐";
                }
                if (isProfit) catIcon = "💰";
                if (isTransfer) catIcon = "💸";

                return (
                  <div key={card.id} className="tx">
                    <div className="cat">{catIcon}</div>
                    <div className="tx-info">
                      <div className="t">
                        {card.card_name} {card.card_id ? `#${card.card_id}` : ""}
                        {isTransfer && card.transfer_from && card.transfer_to && (
                          <span className="tx-transfer-note">
                            ({card.transfer_from} → {card.transfer_to})
                          </span>
                        )}
                      </div>
                      <div className="s">
                        <span className={`dot ${card.paid_by === currentUserCapitalized || card.transfer_from === currentUserCapitalized ? "u1" : "u2"}`}></span>
                        {isTransfer && card.transfer_from && card.transfer_to
                          ? `${card.transfer_from} sent ${card.transfer_to} $${total.toFixed(2)}`
                          : `${card.paid_by} ${isProfit ? "collected" : "paid"} · ${isProfit ? "Profit" : "Expense"}`}
                      </div>
                    </div>
                    <div className="tx-amt">
                      <div className={`a ${isTransfer ? "transfer" : isProfit ? "pos" : "neg"}`}>
                        {isTransfer ? "" : isProfit ? "+" : "−"}${(isProfit ? (card.sale_price || total) : total).toFixed(2)}
                      </div>
                      <div className="half">
                        {isTransfer
                          ? `${total.toFixed(2)} sent`
                          : isProfit
                            ? `${((card.sale_price || total) / 2).toFixed(2)} each`
                            : `${(total / 2).toFixed(2)} each`}
                      </div>
                    </div>
                    {onEdit && (
                      <button
                        type="button"
                        className="edit-btn"
                        onClick={(e) => { e.stopPropagation(); onEdit(card); }}
                      >
                        ✎
                      </button>
                    )}
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