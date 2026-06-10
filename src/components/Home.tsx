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
  type?: "expense" | "profit";
};

type Props = {
  cards: Card[];
  currentUser: "quez" | "stevie";
};

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

export default function Home({ cards, currentUser }: Props) {
  const otherUser = currentUser === "quez" ? "stevie" : "quez";
  const currentUserCapitalized = currentUser.charAt(0).toUpperCase() + currentUser.slice(1);
  const otherUserCapitalized = otherUser.charAt(0).toUpperCase() + otherUser.slice(1);

  const breakdown = useMemo(() => {
    let currentUserPaid = 0;
    let otherUserPaid = 0;
    let currentUserFairShare = 0;
    let otherUserFairShare = 0;
    let totalExpenses = 0;
    let totalProfits = 0;
    let totalGraded = 0;
    let totalSold = 0;

    for (const c of cards) {
      const total = calcTotal(c);
      const currentUserShare = total * (c.split_percent / 100);
      const otherUserShare = total * ((100 - c.split_percent) / 100);

      if (c.type === "profit" || c.sale_price) {
        // Profit entry - split 50/50
        const profit = c.sale_price || total;
        if (c.paid_by === currentUserCapitalized) {
          currentUserPaid += profit;
          currentUserFairShare += profit / 2;
          otherUserFairShare += profit / 2;
        } else {
          otherUserPaid += profit;
          otherUserFairShare += profit / 2;
          currentUserFairShare += profit / 2;
        }
        totalProfits += profit;
        if (c.sale_price) totalSold++;
      } else {
        // Expense entry
        if (c.paid_by === currentUserCapitalized) {
          currentUserPaid += total;
          currentUserFairShare += currentUserShare;
          otherUserFairShare += otherUserShare;
        } else if (c.paid_by === otherUserCapitalized) {
          otherUserPaid += total;
          otherUserFairShare += otherUserShare;
          currentUserFairShare += currentUserShare;
        } else {
          // Both - each paid their split share
          currentUserPaid += currentUserShare;
          otherUserPaid += otherUserShare;
        }
        totalExpenses += total;
        if (c.grading_fee > 0 || c.shipping_to_grader > 0 || c.shipping_from_grader > 0 || c.insurance > 0) {
          totalGraded++;
        }
      }
    }

    const currentUserBalance = currentUserPaid - currentUserFairShare;
    const otherUserBalance = otherUserPaid - otherUserFairShare;

    let story = "";
    let owesAmount = 0;
    let owesDirection = ""; // "you_owe" | "they_owe" | "even"

    if (currentUserBalance >= 0 && otherUserBalance <= 0) {
      owesAmount = Math.abs(otherUserBalance);
      owesDirection = "they_owe";
      story = `${otherUserCapitalized} owes ${currentUserCapitalized} $${owesAmount.toFixed(2)}`;
    } else if (otherUserBalance >= 0 && currentUserBalance <= 0) {
      owesAmount = Math.abs(currentUserBalance);
      owesDirection = "you_owe";
      story = `${currentUserCapitalized} owes ${otherUserCapitalized} $${owesAmount.toFixed(2)}`;
    } else {
      owesDirection = "even";
      story = "Balanced — no one owes anything";
    }

    const totalInvested = totalExpenses;
    const splitAmount = totalInvested / 2;

    // Recent activity - last 5
    const recent = [...cards]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 5);

    return {
      currentUserPaid,
      otherUserPaid,
      currentUserFairShare,
      otherUserFairShare,
      currentUserBalance,
      otherUserBalance,
      story,
      owesAmount,
      owesDirection,
      totalInvested,
      totalExpenses,
      totalProfits,
      totalGraded,
      totalSold,
      splitAmount,
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
            <div className="big amount">${breakdown.totalInvested.toFixed(2)}</div>
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
                {currentUserCapitalized} paid
              </div>
              <div className="spent amount">${breakdown.currentUserPaid.toFixed(2)}</div>
              <div className="note">Your contributions</div>
            </div>
            <div className="card partner">
              <div className="who">
                <div className="avatar u2">{otherUserCapitalized[0]}</div>
                {otherUserCapitalized} paid
              </div>
              <div className="spent amount">${breakdown.otherUserPaid.toFixed(2)}</div>
              <div className="note">Their contributions</div>
            </div>
          </div>
        </div>

        <div>
          <div className="section-head">
            <h2>Recent activity</h2>
            <a data-go="activity">See all</a>
          </div>
          <div className="card tx-group">
            {breakdown.recent.map((card, i) => {
              const total = calcTotal(card);
              const isProfit = card.type === "profit" || card.sale_price;
              const amount = isProfit ? (card.sale_price || total) : -total;
              const halfAmount = isProfit
                ? (card.sale_price || total) / 2
                : total * (card.split_percent / 100);

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
                      {card.paid_by} paid · {formatDate(card.created_at)}
                    </div>
                  </div>
                  <div className="tx-amt">
                    <div className={`a ${isProfit ? "pos" : "neg"}`}>
                      {isProfit ? "+" : "−"}${(isProfit ? (card.sale_price || total) : total).toFixed(2)}
                    </div>
                    <div className="half">{halfAmount.toFixed(2)} each</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}