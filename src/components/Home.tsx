"use client";

import { useMemo } from "react";
import { calcTotal, formatDate, userCapitalize } from "@/lib/helpers";
import { calcSettlementBreakdown } from "@/lib/settlement";

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

export default function Home({ cards, currentUser, onEdit }: Props) {
  const otherUser = currentUser === "quez" ? "stevie" : "quez";
  const currentUserCapitalized = userCapitalize(currentUser);
  const otherUserCapitalized = userCapitalize(otherUser);

  const breakdown = useMemo(() => {
    const settlement = calcSettlementBreakdown(cards, currentUser);
    let totalGraded = 0;
    let totalSold = 0;

    for (const c of cards) {
      const isTransfer = c.type === "transfer";
      const isProfit = c.type === "profit" || c.sale_price;

      if (isProfit) {
        if (c.sale_price) totalSold++;
      } else if (!isTransfer) {
        if (c.grading_fee > 0 || c.shipping_to_grader > 0 || c.shipping_from_grader > 0 || c.insurance > 0) {
          totalGraded++;
        }
      }
    }

    const recent = [...cards]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 5);

    return {
      ...settlement,
      totalGraded,
      totalSold,
      splitAmount: settlement.fairShareEach,
      recent,
    };
  }, [cards, currentUser]);

  if (cards.length === 0) {
    return (
      <div className="page">
        <div className="hero hero-center">
          <div className="label">Shared balance</div>
          <div className="big amount">$0.00</div>
          <div className="sub">Add your first card to get started</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="desk-grid">
        <div>
          <div className="hero settle-hero" style={{ padding: "34px 24px", textAlign: "center", background: "var(--grad-hero)", borderRadius: "var(--r-xl)" }}>
            <div className="label" style={{ fontSize: 13, color: "var(--text-low)", marginBottom: 4, textTransform: "uppercase", letterSpacing: ".08em" }}>Who owes what</div>
            <div className="settle-flow" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 8 }}>
              <div className="avatar u2" style={{ width: 40, height: 40, fontSize: 18 }}>{otherUserCapitalized[0]}</div>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ width: 28, height: 28, color: "var(--text-low)" }}>
                {breakdown.owesDirection === "they_owe" && <><path d="M4 12h15" /><path d="M14 6l6 6-6 6" /></>}
                {breakdown.owesDirection === "you_owe" && <><path d="M7 16l-4-4 4-4" /><path d="M3 12h13" /><path d="M17 8l4 4-4 4" /></>}
                {breakdown.owesDirection === "even" && <><path d="M5 12h14" /><path d="M12 5l7 7-7 7" /></>}
              </svg>
              <div className="avatar u1" style={{ width: 40, height: 40, fontSize: 18 }}>{currentUserCapitalized[0]}</div>
            </div>
            <div className="owes" style={{ fontSize: 14, color: "var(--text-mid)", marginBottom: 4 }}>
              {breakdown.owesDirection === "they_owe" && <>{otherUserCapitalized} owes {currentUserCapitalized}</>}
              {breakdown.owesDirection === "you_owe" && <>{currentUserCapitalized} owes {otherUserCapitalized}</>}
              {breakdown.owesDirection === "even" && <>All even</>}
            </div>
            <div className="big amount" style={{ fontSize: 42, fontWeight: 600, lineHeight: 1.15 }}>
              ${breakdown.owesAmount.toFixed(2)}
            </div>
          </div>

          <div className="stat-row">
            <div className="card stat">
              <div className="k">Spent</div>
              <div className="v neg amount">${breakdown.totalExpenses.toFixed(2)}</div>
              <div className="d">{breakdown.totalGraded} in grading</div>
            </div>
            <div className="card stat">
              <div className="k">Earned</div>
              <div className="v pos amount">${breakdown.totalProfits.toFixed(2)}</div>
              <div className="d">{breakdown.totalSold} sold</div>
            </div>
          </div>

          <div className="card stat" style={{ marginBottom: 16 }}>
            <div className="k">Shared P&amp;L</div>
            {(() => {
              const netPnL = -breakdown.totalNetSpent;
              return (
                <div className={`v amount ${netPnL >= 0 ? "pos" : "neg"}`} style={{ fontSize: 28 }}>
                  {netPnL >= 0 ? "+" : "−"}${Math.abs(netPnL).toFixed(2)}
                </div>
              );
            })()}
            <div className="d">Net of sales minus expenses</div>
          </div>

          <div className="partners">
            <div className="card partner">
              <div className="who">
                <div className="avatar u1">{currentUserCapitalized[0]}</div>
                {currentUserCapitalized} contributions
              </div>
              <div className="spent amount neg">${breakdown.currentUserExpensesPaid.toFixed(2)} spent</div>
              {breakdown.currentUserProfitCollected > 0 && (
                <div className="spent amount pos partner-profit">
                  +${breakdown.currentUserProfitCollected.toFixed(2)} collected
                </div>
              )}
              <div className="note partner-note">
                Net: ${breakdown.currentUserNet.toFixed(2)}
              </div>
              {(breakdown.currentUserTransfersGiven > 0 || breakdown.currentUserTransfersReceived > 0) && (
                <div className="partner-transfers">
                  {breakdown.currentUserTransfersGiven > 0 && (
                    <div className="neg">Sent: ${breakdown.currentUserTransfersGiven.toFixed(2)}</div>
                  )}
                  {breakdown.currentUserTransfersReceived > 0 && (
                    <div className="pos">Received: ${breakdown.currentUserTransfersReceived.toFixed(2)}</div>
                  )}
                </div>
              )}
            </div>
            <div className="card partner">
              <div className="who">
                <div className="avatar u2">{otherUserCapitalized[0]}</div>
                {otherUserCapitalized} contributions
              </div>
              <div className="spent amount neg">${breakdown.otherUserExpensesPaid.toFixed(2)} spent</div>
              {breakdown.otherUserProfitCollected > 0 && (
                <div className="spent amount pos partner-profit">
                  +${breakdown.otherUserProfitCollected.toFixed(2)} collected
                </div>
              )}
              <div className="note partner-note">
                Net: ${breakdown.otherUserNet.toFixed(2)}
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="section-head">
            <h2>Recent activity</h2>
            <a data-go="activity">See all</a>
          </div>
          <div className="card tx-group">
            {breakdown.recent.map((card) => {
              const total = calcTotal(card);
              const isTransfer = card.type === "transfer";
              const isProfit = card.type === "profit" || card.sale_price;

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
                        : isProfit
                          ? (card.paid_by === "Both"
                            ? `Both collected · ${formatDate(card.created_at)}`
                            : `${card.paid_by} collected · ${formatDate(card.created_at)}`)
                          : `${card.paid_by} paid · ${formatDate(card.created_at)}`}
                    </div>
                  </div>
                  <div className="tx-amt">
                    <div className={`a ${isTransfer ? "transfer" : isProfit ? "pos" : "neg"}`}>
                      {isTransfer ? "" : isProfit ? "+" : "−"}${(isProfit ? (card.sale_price || total) : total).toFixed(2)}
                    </div>
                    <div className="half">{isTransfer ? "full transfer" : isProfit ? `${((card.sale_price || total) / 2).toFixed(2)} each` : `${(total / 2).toFixed(2)} each`}</div>
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
      </div>
    </div>
  );
}