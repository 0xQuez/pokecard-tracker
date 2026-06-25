"use client";

import { useMemo } from "react";
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
  cards: Card[];
  currentUser: "quez" | "stevie";
  onEdit?: (card: Card) => void;
};

function calcTotal(c: Card): number {
  if (c.type === "transfer") {
    return c.transfer_amount || 0;
  }
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
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";

  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
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

export default function Home({ cards, currentUser, onEdit }: Props) {
  const otherUser = currentUser === "quez" ? "stevie" : "quez";
  const currentUserCapitalized = currentUser.charAt(0).toUpperCase() + currentUser.slice(1);
  const otherUserCapitalized = otherUser.charAt(0).toUpperCase() + otherUser.slice(1);

  const breakdown = useMemo(() => {
    // Expenses track who paid
    let currentUserExpensesPaid = 0;
    let otherUserExpensesPaid = 0;

    // Profits track who collected (reduces their "net spent")
    let currentUserProfitCollected = 0;
    let otherUserProfitCollected = 0;

    // Transfers: direct cash flows
    let currentUserTransferAdjustment = 0;
    let currentUserTransfersGiven = 0;
    let currentUserTransfersReceived = 0;

    let totalExpenses = 0;
    let totalProfits = 0;
    let totalGraded = 0;
    let totalSold = 0;

    for (const c of cards) {
      const total = calcTotal(c);
      const isTransfer = c.type === "transfer";
      const isProfit = c.type === "profit" || c.sale_price;

      if (isTransfer) {
        if (c.transfer_from === currentUserCapitalized) {
          currentUserTransferAdjustment -= total;
          currentUserTransfersGiven += total;
        } else if (c.transfer_to === currentUserCapitalized) {
          currentUserTransferAdjustment += total;
          currentUserTransfersReceived += total;
        }
      } else if (isProfit) {
        const profit = c.sale_price || total;
        // Sale: profit is REVENUE for whoever collected
        if (c.paid_by === "Both") {
          // Cash was split equally
          currentUserProfitCollected += profit / 2;
          otherUserProfitCollected += profit / 2;
        } else if (c.paid_by === currentUserCapitalized) {
          currentUserProfitCollected += profit;
        } else {
          otherUserProfitCollected += profit;
        }
        totalProfits += profit;
        if (c.sale_price) totalSold++;
      } else {
        // Expense: whoever paid gets the full amount added
        if (c.paid_by === currentUserCapitalized) {
          currentUserExpensesPaid += total;
        } else if (c.paid_by === otherUserCapitalized) {
          otherUserExpensesPaid += total;
        } else {
          // Both paid their split share
          const currentUserShare = total * (c.split_percent / 100);
          const otherUserShare = total * ((100 - c.split_percent) / 100);
          currentUserExpensesPaid += currentUserShare;
          otherUserExpensesPaid += otherUserShare;
        }
        totalExpenses += total;
        if (c.grading_fee > 0 || c.shipping_to_grader > 0 || c.shipping_from_grader > 0 || c.insurance > 0) {
          totalGraded++;
        }
      }
    }

    // Net spent = expenses paid - profit collected (per person)
    const currentUserNet = currentUserExpensesPaid - currentUserProfitCollected;
    const otherUserNet = otherUserExpensesPaid - otherUserProfitCollected;
    const totalNetSpent = currentUserNet + otherUserNet;
    const fairShareEach = totalNetSpent / 2;

    // Balance = net spent - fair share
    // Positive = overpaid (owed money), Negative = underpaid (owes money)
    const currentUserBalance = currentUserNet - fairShareEach + currentUserTransferAdjustment;
    const otherUserBalance = otherUserNet - fairShareEach - currentUserTransferAdjustment;

    let owesAmount = 0;
    let owesDirection = "";

    if (currentUserBalance >= 0 && otherUserBalance <= 0) {
      owesAmount = Math.abs(otherUserBalance);
      owesDirection = "they_owe";
    } else if (otherUserBalance >= 0 && currentUserBalance <= 0) {
      owesAmount = Math.abs(currentUserBalance);
      owesDirection = "you_owe";
    } else {
      owesDirection = "even";
    }

    const splitAmount = fairShareEach;

    const recent = [...cards]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 5);

    return {
      currentUserExpensesPaid,
      otherUserExpensesPaid,
      currentUserProfitCollected,
      otherUserProfitCollected,
      currentUserNet,
      otherUserNet,
      currentUserBalance,
      otherUserBalance,
      currentUserTransferAdjustment,
      owesAmount,
      owesDirection,
      totalNetSpent,
      totalExpenses,
      totalProfits,
      totalGraded,
      totalSold,
      splitAmount,
      currentUserTransfersGiven,
      currentUserTransfersReceived,
      recent,
    };
  }, [cards, currentUser]);

  if (cards.length === 0) {
    return (
      <div className="page">
        <div className="hero" style={{ textAlign: "center" }}>
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
          <div className="hero">
            <div className="label">Shared balance</div>
            <div className="big amount">${breakdown.totalNetSpent.toFixed(2)}</div>
            <div className="sub">
              {breakdown.owesDirection === "they_owe" && (
                <>
                  {otherUserCapitalized} owes you <b>${breakdown.owesAmount.toFixed(2)}</b>
                </>
              )}
              {breakdown.owesDirection === "you_owe" && (
                <>
                  You owe {otherUserCapitalized} <b>${breakdown.owesAmount.toFixed(2)}</b>
                </>
              )}
              {breakdown.owesDirection === "even" && <b>All even</b>}
            </div>
            <div className="splitbar">
              <div className="track">
                <div className="f1" style={{ width: "50%" }}></div>
                <div className="f2" style={{ width: "50%" }}></div>
              </div>
              <div className="legend">
                <span>
                  <span className="dot u1"></span>
                  {currentUserCapitalized} · <span className="amount">${breakdown.splitAmount.toFixed(2)}</span>
                </span>
                <span>
                  <span className="dot u2"></span>
                  {otherUserCapitalized} · <span className="amount">${breakdown.splitAmount.toFixed(2)}</span>
                </span>
              </div>
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

          <div className="partners">
            <div className="card partner">
              <div className="who">
                <div className="avatar u1">{currentUserCapitalized[0]}</div>
                {currentUserCapitalized} contributions
              </div>
              <div className="spent amount neg">${breakdown.currentUserExpensesPaid.toFixed(2)} spent</div>
              {breakdown.currentUserProfitCollected > 0 && (
                <div className="spent amount pos" style={{ fontSize: "16px", marginTop: "4px" }}>
                  +${breakdown.currentUserProfitCollected.toFixed(2)} collected
                </div>
              )}
              <div className="note" style={{ marginTop: "4px" }}>
                Net: ${breakdown.currentUserNet.toFixed(2)}
              </div>
              {(breakdown.currentUserTransfersGiven > 0 || breakdown.currentUserTransfersReceived > 0) && (
                <div style={{ marginTop: "4px", fontSize: "13px", color: "var(--text-mid)" }}>
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
                <div className="spent amount pos" style={{ fontSize: "16px", marginTop: "4px" }}>
                  +${breakdown.otherUserProfitCollected.toFixed(2)} collected
                </div>
              )}
              <div className="note" style={{ marginTop: "4px" }}>
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
                        <span style={{ fontWeight: "normal", fontSize: "12px", marginLeft: "8px", color: "var(--text-mid)" }}>
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
                    <div className="half">{isTransfer ? "full transfer" : isProfit ? `${((card.sale_price || total) / 2).toFixed(2)} each` : `${(total * (card.split_percent / 100)).toFixed(2)} each`}</div>
                  </div>
                  {onEdit && (
                    <button
                      type="button"
                      className="edit-btn"
                      onClick={(e) => { e.stopPropagation(); onEdit(card); }}
                      style={{
                        width: 32, height: 32, borderRadius: "50%",
                        display: "grid", placeItems: "center",
                        background: "var(--surface-2)", border: "1px solid var(--line)",
                        color: "var(--text-mid)", fontSize: 14, cursor: "pointer",
                        flexShrink: 0, marginLeft: 12
                      }}
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