"use client";

import { useMemo } from "react";
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
};

function formatSettlementDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function History({ cards, currentUser }: Props) {
  const otherUser = currentUser === "quez" ? "stevie" : "quez";
  const currentUserCapitalized = userCapitalize(currentUser);
  const otherUserCapitalized = userCapitalize(otherUser);

  const settledCards = useMemo(() => {
    return cards.filter((c) => c.settled_at);
  }, [cards]);

  const settlementCycles = useMemo(() => {
    const cycles: Record<string, Card[]> = {};
    for (const c of settledCards) {
      if (!c.settled_at) continue;
      const date = new Date(c.settled_at);
      const dayKey = date.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      if (!cycles[dayKey]) cycles[dayKey] = [];
      cycles[dayKey].push(c);
    }
    return Object.entries(cycles).sort((a, b) => {
      const dateA = new Date(a[1][0].settled_at || 0);
      const dateB = new Date(b[1][0].settled_at || 0);
      return dateB.getTime() - dateA.getTime();
    });
  }, [settledCards]);

  const calcCycleStats = (cycleCards: Card[]) => {
    let currentUserExpensesPaid = 0;
    let otherUserExpensesPaid = 0;
    let currentUserProfitCollected = 0;
    let otherUserProfitCollected = 0;
    let totalExpenses = 0;
    let totalProfits = 0;
    let currentUserTransferAdjustment = 0;

    for (const c of cycleCards) {
      const total = calcTotal(c);
      const isProfit = c.type === "profit" || c.sale_price;
      const isTransfer = c.type === "transfer";

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
        if (c.paid_by === "Both") {
          currentUserExpensesPaid += total * (c.split_percent / 100);
          otherUserExpensesPaid += total * ((100 - c.split_percent) / 100);
        } else if (c.paid_by === currentUserCapitalized) {
          currentUserExpensesPaid += total;
        } else {
          otherUserExpensesPaid += total;
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

    return {
      currentUserExpensesPaid,
      otherUserExpensesPaid,
      currentUserProfitCollected,
      otherUserProfitCollected,
      currentUserNet,
      otherUserNet,
      currentUserBalance,
      otherUserBalance,
      totalExpenses,
      totalProfits,
      totalNetSpent,
      fairShareEach,
      currentUserTransferAdjustment,
      count: cycleCards.length,
    };
  };

  if (settledCards.length === 0) {
    return (
      <div className="page page-narrow">
        <div className="hero" style={{ textAlign: "center", padding: "48px 24px" }}>
          <p style={{ fontSize: "48px", marginBottom: "8px" }}>📜</p>
          <p style={{ fontSize: "18px", marginBottom: "4px", color: "var(--text-hi)" }}>No history yet</p>
          <p style={{ color: "var(--text-mid)" }}>
            Once you settle up, previous cycles will show up here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page page-narrow">
      {settlementCycles.map(([dayLabel, cycleCards]) => {
        const stats = calcCycleStats(cycleCards);
        const latestSettled = cycleCards[0]?.settled_at;

        return (
          <div key={dayLabel} className="settlement-cycle">
            <div className="settlement-header">
              <div>
                <div className="label">Settled on</div>
                <div className="cycle-date">{formatSettlementDate(latestSettled || "")}</div>
              </div>
              <div className="cycle-count">{stats.count} entries</div>
            </div>

            <div className="card tx-group" style={{ marginBottom: "16px" }}>
              {cycleCards.map((card) => {
                const total = calcTotal(card);
                const isTransfer = card.type === "transfer";
                const isProfit = card.type === "profit" || card.sale_price;
                const amount = isTransfer ? total : isProfit ? (card.sale_price || total) : total;

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
                        {card.card_name}
                        {isTransfer && card.transfer_from && card.transfer_to && (
                          <span style={{ fontWeight: "normal", fontSize: "12px", marginLeft: "8px", color: "var(--text-mid)" }}>
                            ({card.transfer_from} → {card.transfer_to})
                          </span>
                        )}
                      </div>
                      <div className="s">
                        <span
                          className={`dot ${card.paid_by === currentUserCapitalized || card.transfer_from === currentUserCapitalized ? "u1" : "u2"}`}
                        ></span>
                        {isTransfer && card.transfer_from && card.transfer_to
                          ? `${card.transfer_from} sent ${card.transfer_to} $${total.toFixed(2)}`
                          : isProfit
                            ? `${card.paid_by} collected`
                            : `${card.paid_by} paid`}
                      </div>
                    </div>
                    <div className={`tx-amt amount ${isTransfer ? "transfer" : isProfit ? "pos" : "neg"}`}>
                      {isTransfer ? "" : isProfit ? "+" : "−"}${amount.toFixed(2)}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="card breakdown" style={{ marginBottom: "24px" }}>
              <div className="break-row">
                <span className="l">
                  <span className="dot u1"></span>
                  {currentUserCapitalized} expenses
                </span>
                <span className="r amount">${stats.currentUserExpensesPaid.toFixed(2)}</span>
              </div>
              <div className="break-row">
                <span className="l">
                  <span className="dot u2"></span>
                  {otherUserCapitalized} expenses
                </span>
                <span className="r amount">${stats.otherUserExpensesPaid.toFixed(2)}</span>
              </div>
              {stats.currentUserProfitCollected > 0 && (
                <div className="break-row" style={{ color: "var(--moss)" }}>
                  <span className="l">
                    <span className="dot u1"></span>
                    {currentUserCapitalized} collected
                  </span>
                  <span className="r amount">${stats.currentUserProfitCollected.toFixed(2)}</span>
                </div>
              )}
              {stats.otherUserProfitCollected > 0 && (
                <div className="break-row" style={{ color: "var(--moss)" }}>
                  <span className="l">
                    <span className="dot u2"></span>
                    {otherUserCapitalized} collected
                  </span>
                  <span className="r amount">${stats.otherUserProfitCollected.toFixed(2)}</span>
                </div>
              )}
              <div className="break-row">
                <span className="l">Fair share each (½)</span>
                <span className="r amount">${stats.fairShareEach.toFixed(2)}</span>
              </div>
              {stats.currentUserTransferAdjustment !== 0 && (
                <div className="break-row" style={{ color: "var(--sand)" }}>
                  <span className="l">Transfers adjustment</span>
                  <span className="r amount">
                    {stats.currentUserTransferAdjustment > 0 ? "+" : ""}${stats.currentUserTransferAdjustment.toFixed(2)}
                  </span>
                </div>
              )}
              <div className="break-row total">
                <span className="l">
                  {stats.currentUserBalance > 0
                    ? `${otherUserCapitalized} owed ${currentUserCapitalized}`
                    : stats.otherUserBalance > 0
                    ? `${currentUserCapitalized} owed ${otherUserCapitalized}`
                    : "All even"}
                </span>
                <span className="r amount">
                  {Math.abs(Math.max(stats.currentUserBalance, stats.otherUserBalance)).toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}