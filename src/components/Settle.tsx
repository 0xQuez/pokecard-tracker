"use client";

import { useMemo, useState } from "react";
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
  cards: Card[];
  currentUser: "quez" | "stevie";
  onSettle: () => void;
  onRefresh: () => void;
};

export default function Settle({ cards, currentUser, onSettle, onRefresh }: Props) {
  const otherUser = currentUser === "quez" ? "stevie" : "quez";
  const currentUserCapitalized = userCapitalize(currentUser);
  const otherUserCapitalized = userCapitalize(otherUser);

  const [settling, setSettling] = useState(false);

  const breakdown = useMemo(() => {
    let currentUserExpensesPaid = 0;
    let otherUserExpensesPaid = 0;
    let currentUserProfitCollected = 0;
    let otherUserProfitCollected = 0;
    let currentUserTransferAdjustment = 0;
    let totalExpenses = 0;
    let totalProfits = 0;

    const activeCards = cards.filter((c) => !c.settled_at);

    for (const c of activeCards) {
      const total = calcTotal(c);
      const isTransfer = c.type === "transfer";
      const isProfit = c.type === "profit" || c.sale_price;

      if (isTransfer) {
        if (c.transfer_from === currentUserCapitalized) {
          currentUserTransferAdjustment -= total;
        } else if (c.transfer_to === currentUserCapitalized) {
          currentUserTransferAdjustment += total;
        }
      } else if (isProfit) {
        const profit = c.sale_price || total;
        if (c.paid_by === "Both") {
          currentUserProfitCollected += profit / 2;
          otherUserProfitCollected += profit / 2;
        } else if (c.paid_by === currentUserCapitalized) {
          currentUserProfitCollected += profit;
        } else {
          otherUserProfitCollected += profit;
        }
        totalProfits += profit;
      } else {
        if (c.paid_by === currentUserCapitalized) {
          currentUserExpensesPaid += total;
        } else if (c.paid_by === otherUserCapitalized) {
          otherUserExpensesPaid += total;
        } else {
          const currentUserShare = total * (c.split_percent / 100);
          const otherUserShare = total * ((100 - c.split_percent) / 100);
          currentUserExpensesPaid += currentUserShare;
          otherUserExpensesPaid += otherUserShare;
        }
        totalExpenses += total;
      }
    }

    const currentUserNet = currentUserExpensesPaid - currentUserProfitCollected;
    const otherUserNet = otherUserExpensesPaid - otherUserProfitCollected;
    const totalNetSpent = currentUserNet + otherUserNet;
    const fairShareEach = totalNetSpent / 2;

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

    return {
      currentUserExpensesPaid,
      otherUserExpensesPaid,
      currentUserProfitCollected,
      otherUserProfitCollected,
      currentUserBalance,
      otherUserBalance,
      owesAmount,
      owesDirection,
      totalExpenses,
      totalProfits,
      totalNetSpent,
      fairShareEach,
      activeCount: activeCards.length,
      currentUserTransferAdjustment,
    };
  }, [cards, currentUser]);

  const handleSettle = async () => {
    if (breakdown.activeCount === 0) return;

    setSettling(true);

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
            {currentUserCapitalized} expenses
          </span>
          <span className="r amount">${breakdown.currentUserExpensesPaid.toFixed(2)}</span>
        </div>
        <div className="break-row">
          <span className="l">
            <span className="dot u2"></span>
            {otherUserCapitalized} expenses
          </span>
          <span className="r amount">${breakdown.otherUserExpensesPaid.toFixed(2)}</span>
        </div>
        {breakdown.currentUserProfitCollected > 0 && (
          <div className="break-row" style={{ color: "var(--moss)" }}>
            <span className="l">
              <span className="dot u1"></span>
              {currentUserCapitalized} collected
            </span>
            <span className="r amount">${breakdown.currentUserProfitCollected.toFixed(2)}</span>
          </div>
        )}
        {breakdown.otherUserProfitCollected > 0 && (
          <div className="break-row" style={{ color: "var(--moss)" }}>
            <span className="l">
              <span className="dot u2"></span>
              {otherUserCapitalized} collected
            </span>
            <span className="r amount">${breakdown.otherUserProfitCollected.toFixed(2)}</span>
          </div>
        )}
        <div className="break-row">
          <span className="l">Fair share each (½)</span>
          <span className="r amount">${breakdown.fairShareEach.toFixed(2)}</span>
        </div>
        {breakdown.currentUserTransferAdjustment !== 0 && (
          <div className="break-row" style={{ color: "var(--sand)" }}>
            <span className="l">
              Transfers adjustment
            </span>
            <span className="r amount">
              {breakdown.currentUserTransferAdjustment > 0 ? "+" : ""}${breakdown.currentUserTransferAdjustment.toFixed(2)}
            </span>
          </div>
        )}
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
    </div>
  );
}