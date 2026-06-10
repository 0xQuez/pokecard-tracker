"use client";

import { useState, useEffect } from "react";
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
};

type Props = { cards: Card[]; onDelete: (id: number) => void };

export default function CardList({ cards, onDelete }: Props) {
  const [filter, setFilter] = useState<string>("all");
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const filtered =
    filter === "all" ? cards : cards.filter((c) => c.paid_by === filter);

  const handleDelete = async (id: number) => {
    const { error } = await supabase.from("cards").delete().eq("id", id);
    if (error) {
      alert("Delete failed: " + error.message);
      return;
    }
    onDelete(id);
    setConfirmDelete(null);
  };

  const updateCard = async (id: number, updates: any) => {
    const { error } = await supabase
      .from("cards")
      .update(updates)
      .eq("id", id);
    if (error) {
      alert("Save failed: " + error.message);
      return;
    }
    // Trigger re-fetch by calling onDelete trick — no, we need a refresh
    // We'll just reload page... actually we'll call the parent
    window.location.reload();
  };

  if (cards.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <p className="text-4xl mb-2">📦</p>
        <p>No cards yet. Add your first one above.</p>
      </div>
    );
  }

  const totalInvested = cards.reduce((sum, c) => sum + calcTotal(c), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-2">
          <button
            onClick={() => setFilter("all")}
            className={`text-xs px-2 py-1 rounded ${
              filter === "all" ? "bg-gray-900 text-white" : "bg-white border"
            }`}
          >
            All ({cards.length})
          </button>
          <button
            onClick={() => setFilter("Quez")}
            className={`text-xs px-2 py-1 rounded ${
              filter === "Quez" ? "bg-gray-900 text-white" : "bg-white border"
            }`}
          >
            Quez
          </button>
          <button
            onClick={() => setFilter("Stevie")}
            className={`text-xs px-2 py-1 rounded ${
              filter === "Stevie" ? "bg-gray-900 text-white" : "bg-white border"
            }`}
          >
            Stevie
          </button>
        </div>
        <span className="text-sm font-semibold">
          Total invested: ${totalInvested.toFixed(2)}
        </span>
      </div>

      <div className="space-y-2">
        {filtered.map((card) => {
          const total = calcTotal(card);
          return (
            <div key={card.id} className="bg-white border rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <div>
                  <span className="font-medium text-sm">{card.card_name}</span>
                  {card.card_id && (
                    <span className="text-xs text-gray-500 ml-2">
                      #{card.card_id}
                    </span>
                  )}
                </div>
                {confirmDelete === card.id ? (
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleDelete(card.id)}
                      className="text-xs bg-red-600 text-white px-2 py-1 rounded"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="text-xs bg-gray-200 px-2 py-1 rounded"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(card.id)}
                    className="text-xs text-gray-400 hover:text-red-600"
                  >
                    Delete
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                <span>Purchase: ${card.purchase_price.toFixed(2)}</span>
                {card.grading_fee > 0 && (
                  <span>Grade: ${card.grading_fee.toFixed(2)}</span>
                )}
                {card.insurance > 0 && (
                  <span>Ins: ${card.insurance.toFixed(2)}</span>
                )}
                {(card.shipping_to_grader > 0 ||
                  card.shipping_from_grader > 0) && (
                  <span>
                    Ship: $
                    {(
                      card.shipping_to_grader + card.shipping_from_grader
                    ).toFixed(2)}
                  </span>
                )}
                {card.other_costs > 0 && (
                  <span>Other: ${card.other_costs.toFixed(2)}</span>
                )}
                <span className="font-semibold text-gray-900">
                  Total: ${total.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-gray-500">
                  Paid by: {card.paid_by} ({card.split_percent}%)
                </span>
                {card.notes && (
                  <span className="text-xs text-gray-400 italic truncate max-w-[60%]">
                    {card.notes}
                  </span>
                )}
              </div>
              {card.date_acquired && (
                <div className="text-xs text-gray-400 mt-1">
                  Added: {new Date(card.date_acquired).toLocaleDateString()}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

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
