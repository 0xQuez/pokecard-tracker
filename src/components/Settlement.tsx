"use client";

import { useMemo } from "react";

type Card = {
  id: number;
  card_name: string;
  card_id?: string;
  purchase_price: number;
  grading_fee: number;
  shipping_to_grader: number;
  shipping_from_grader: number;
  insurance: number;
  other_costs: number;
  paid_by: string;
  split_percent: number;
  sale_price?: number;
};

type Props = { cards: Card[] };

export default function Settlement({ cards }: Props) {
  const breakdown = useMemo(() => {
    let quezPaid = 0;
    let steviePaid = 0;
    let quezOwes = 0;
    let stevieOwes = 0;
    let totalGraded = 0;
    let totalSold = 0;
    const lineItems: {
      name: string;
      total: number;
      paidBy: string;
      split: number;
      quezShare: number;
      stevieShare: number;
    }[] = [];

    for (const c of cards) {
      const total =
        c.purchase_price +
        c.grading_fee +
        c.shipping_to_grader +
        c.shipping_from_grader +
        c.insurance +
        c.other_costs;
      const qShare = total * (c.split_percent / 100);
      const sShare = total * ((100 - c.split_percent) / 100);

      if (c.paid_by === "Quez") {
        quezPaid += total;
        quezOwes += sShare;
        stevieOwes += sShare;
      } else if (c.paid_by === "Stevie") {
        steviePaid += total;
        stevieOwes += qShare;
        quezOwes += qShare;
      } else {
        // Both — each paid their split share
        quezPaid += qShare;
        steviePaid += sShare;
      }

      if (c.grading_fee > 0 || c.shipping_to_grader > 0 || c.shipping_from_grader > 0 || c.insurance > 0) {
        totalGraded++;
      }
      if (c.sale_price) {
        totalSold++;
      }

      lineItems.push({
        name: c.card_name + (c.card_id ? ` (#${c.card_id})` : ""),
        total,
        paidBy: c.paid_by,
        split: c.split_percent,
        quezShare: qShare,
        stevieShare: sShare,
      });
    }

    const quezBalance = quezPaid - quezOwes;
    const stevieBalance = steviePaid - stevieOwes;

    let story = "";
    if (quezBalance >= 0 && stevieBalance <= 0) {
      story = `Stevie owes Quez $${Math.abs(stevieBalance).toFixed(2)}`;
    } else if (stevieBalance >= 0 && quezBalance <= 0) {
      story = `Quez owes Stevie $${Math.abs(quezBalance).toFixed(2)}`;
    } else {
      story = "Balanced — no one owes anything";
    }

    return {
      quezPaid,
      steviePaid,
      quezOwes,
      stevieOwes,
      quezBalance,
      stevieBalance,
      story,
      lineItems,
      totalCards: cards.length,
      totalGraded,
      totalSold,
      totalInvested: cards.reduce(
        (s, c) =>
          s +
          c.purchase_price +
          c.grading_fee +
          c.shipping_to_grader +
          c.shipping_from_grader +
          c.insurance +
          c.other_costs,
        0
      ),
    };
  }, [cards]);

  if (cards.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <p className="text-4xl mb-2">💸</p>
        <p>No cards yet. Settlement will appear here once you add entries.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="bg-white border rounded-xl shadow-sm p-5 mb-6">
        <h2 className="text-lg font-semibold mb-3">Bottom Line</h2>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="text-center">
            <div className="text-xs text-gray-500">Quez paid</div>
            <div className="text-lg font-semibold">
              ${breakdown.quezPaid.toFixed(2)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-500">Stevie paid</div>
            <div className="text-lg font-semibold">
              ${breakdown.steviePaid.toFixed(2)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-500">Total invested</div>
            <div className="text-lg font-semibold">
              ${breakdown.totalInvested.toFixed(2)}
            </div>
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
          <div className="text-sm text-gray-600 mb-1">Who owes whom</div>
          <div className="text-xl font-bold text-blue-900">{breakdown.story}</div>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-4 text-xs text-gray-500">
          <div className="text-center">
            Cards: <span className="font-semibold text-gray-900">{breakdown.totalCards}</span>
          </div>
          <div className="text-center">
            In grading: <span className="font-semibold text-gray-900">{breakdown.totalGraded}</span>
          </div>
          <div className="text-center">
            Sold: <span className="font-semibold text-gray-900">{breakdown.totalSold}</span>
          </div>
        </div>
      </div>

      <div className="bg-white border rounded-xl shadow-sm p-4">
        <h3 className="text-sm font-semibold mb-3">Line Items</h3>
        <div className="space-y-1">
          {breakdown.lineItems.map((li, i) => (
            <div key={i} className="flex items-center justify-between text-xs py-1 border-b last:border-0">
              <span className="truncate flex-1 mr-2">{li.name}</span>
              <span className="text-gray-500 mr-2">{li.paidBy}</span>
              <span className="w-10 text-right text-gray-500">
                ${li.total.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
