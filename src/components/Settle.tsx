"use client";

import { useMemo, useState } from "react";
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
  settled_at?: string;
};

type Props = {
  cards: Card[];
  currentUser: "quez" | "stevie";
  onSettle: () => void;
  onRefresh: () => void;
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

export default function Settle({ cards, currentUser, onSettle, onRefresh }: Props) {
  const otherUser = currentUser === "quez" ? "stevie" : "quez";
  const currentUserCapitalized = currentUser.charAt(0).toUpperCase() + currentUser.slice(1);
  const otherUserCapitalized = otherUser.charAt(0).toUpperCase() + otherUser.slice(1);

  const [settling, setSettling] = useState(false);

  const breakdown = useMemo(() => {
    let currentUserPaid = 0;
    let otherUserPaid = 0;
    let currentUserFairShare = 0;
    let otherUserFairShare = 0;
    let totalExpenses = 0;
    let totalProfits = 0;

    // Only calculate for unsettled cards
    const activeCards = cards.filter((c) => !c.settled_at);

    for (const c of activeCards) {
      const total = calcTotal(c);
      const isProfit = c.type === "profit" || c.sale_price;

      if (isProfit) {
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
      } else {
        const currentUserShare = total * (c.split_percent / 100);
        const otherUserShare = total * ((100 - c.split_percent) / 100);

        if (c.paid_by === currentUserCapitalized) {
          currentUserPaid += total;
          currentUserFairShare += currentUserShare;
          otherUserFairShare += otherUserShare;
        } else if (c.paid_by === otherUserCapitalized) {
          otherUserPaid += total;
          otherUserFairShare += otherUserShare;
          currentUserFairShare += currentUserShare;
        } else {
          currentUserPaid += currentUserShare;
          otherUserPaid += otherUserShare;
        }
        totalExpenses += total;
      }
    }

    const currentUserBalance = currentUserPaid - currentUserFairShare;
    const otherUserBalance = otherUserPaid - otherUserFairShare;

    let owesAmount = 0;
    let owesDirection = ""; // "you_owe" | "they_owe" | "even"

    if (currentUserBalance >= 0 && otherUserBalance <= 0) {
      owesAmount = Math.abs(otherUserBalance);
      owesDirection = "they_owe";
    } else if (otherUserBalance >= 0 && currentUserBalance <= 0) {
      owesAmount = Math.abs(currentUserBalance);
      owesDirection = "you_owe";
    } else {
      owesDirection = "even";
    }

    const fairShareEach = (totalExpenses + totalProfits) / 2;

    return {
      currentUserPaid,
      otherUserPaid,
      currentUserFairShare,
      otherUserFairShare,
      currentUserBalance,
      otherUserBalance,
      owesAmount,
      owesDirection,
      totalExpenses,
      totalProfits,
      fairShareEach,
      activeCount: activeCards.length,
    };
  }, [cards, currentUser]);

  const handleSettle = async () => {
    if (breakdown.activeCount === 0) return;

    setSettling(true);

    // Get IDs of all unsettled cards
    const activeCardIds = cards.filter((c) => !c.settled_at).map((c) => c.id);

    const { error } = await supabase
      .from("cards")
      .update({ settled_at: new Date().toISOString() })
      .in("id", activeCardIds);

    setSettling(false);

    if (error) {
      alert("Error settling: " + error.message);
      return;
    }

    onSettle();
    onRefresh();
  };

  const allSettled = breakdown.activeCount === 0;

  return (
    <div className="page page-narrow">
      <div className="settle-hero">
        <div className="settle-flow">
          <div className="avatar u2">{otherUserCapitalized[0]}</div>
          <div className="settle-arrow">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12h15" />
              <path d="M14 6l6 6-6 6" />
            </svg>
          </div>
          <div className="avatar u1">{currentUserCapitalized[0]}</div>
        </div>
        <div className="owes">
          {breakdown.owesDirection === "they_owe" && (
            <> <b>{otherUserCapitalized}</b> owes <b>{currentUserCapitalized}</b> </>
          )}
          {breakdown.owesDirection === "you_owe" && (
            <> <b>{currentUserCapitalized}</b> owes <b>{otherUserCapitalized}</b> </>
          )}
          {breakdown.owesDirection === "even" && <b>All even</b>}
        </div>
        <div className="big amount">${breakdown.owesAmount.toFixed(2)}</div>
        <div className="owes" style={{ fontSize: 12, color: "var(--text-low)" }}>
          {breakdown.owesDirection === "even"
            ? "You're perfectly balanced"
            : allSettled
            ? "Cycle complete — start fresh"
            : "to even out this cycle"}
        </div>
      </div>

      <div className="section-head">
        <h2>How we got here</h2>
      </div>
      <div className="card breakdown">
        <div className="break-row">
          <span className="l">
            <span className="dot u1"></span>
            {currentUserCapitalized} covered
          </span>
          <span className="r amount">${breakdown.currentUserPaid.toFixed(2)}</span>
        </div>
        <div className="break-row">
          <span className="l">
            <span className="dot u2"></span>
            {otherUserCapitalized} covered
          </span>
          <span className="r amount">${breakdown.otherUserPaid.toFixed(2)}</span>
        </div>
        <div className="break-row">
          <span className="l">Fair share each (½)</span>
          <span className="r amount">${breakdown.fairShareEach.toFixed(2)}</span>
        </div>
        <div className="break-row total">
          <span className="l">
            {breakdown.owesDirection === "they_owe" && `${otherUserCapitalized} pays ${currentUserCapitalized}`}
            {breakdown.owesDirection === "you_owe" && `${currentUserCapitalized} pays ${otherUserCapitalized}`}
            {breakdown.owesDirection === "even" && "No payment needed"}
          </span>
          <span className="r amount">
            {breakdown.owesDirection !== "even" ? `${breakdown.owesAmount.toFixed(2)}` : "$0.00"}
          </span>
        </div>
      </div>

      <button
        className="cta"
        onClick={handleSettle}
        disabled={settling || allSettled}
        style={{ width: "100%", margin: "22px 0 10px", opacity: allSettled ? 0.5 : 1 }}
      >
        {settling ? "Settling..." : allSettled ? "Cycle settled" : "Mark as settled"}
      </button>
      <button className="cta ghost" style={{ width: "100%", margin: "0 0 22px" }}>
        Send a reminder
      </button>

      {cards.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: "48px 24px", marginTop: "16px" }}>
          <p style={{ fontSize: "48px", marginBottom: "8px" }}>💸</p>
          <p style={{ color: "var(--text-mid)" }}>No entries yet. Add some to see the settlement.</p>
        </div>
      )}
    </div>
  );
}