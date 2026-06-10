"use client";

import { useState, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";

type CardInput = {
  card_name: string;
  card_id?: string;
  purchase_price: string;
  grading_fee: string;
  shipping_to_grader: string;
  shipping_from_grader: string;
  insurance: string;
  other_costs: string;
  notes: string;
  paid_by: string;
  split_percent: string;
  date_acquired: string;
};

type Props = { onAdd: (card: any) => void };

export default function AddCard({ onAdd }: Props) {
  const blank: CardInput = {
    card_name: "",
    card_id: "",
    purchase_price: "",
    grading_fee: "0",
    shipping_to_grader: "0",
    shipping_from_grader: "0",
    insurance: "0",
    other_costs: "0",
    notes: "",
    paid_by: "Quez",
    split_percent: "100",
    date_acquired: "",
  };

  const [form, setForm] = useState<CardInput>(blank);
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.card_name || !form.purchase_price) {
      alert("Card name and purchase price are required.");
      return;
    }
    setSaving(true);

    const payload: any = {
      card_name: form.card_name.trim(),
      card_id: form.card_id?.trim() || null,
      purchase_price: parseFloat(form.purchase_price),
      grading_fee: parseFloat(form.grading_fee) || 0,
      shipping_to_grader: parseFloat(form.shipping_to_grader) || 0,
      shipping_from_grader: parseFloat(form.shipping_from_grader) || 0,
      insurance: parseFloat(form.insurance) || 0,
      other_costs: parseFloat(form.other_costs) || 0,
      notes: form.notes?.trim() || "",
      paid_by: form.paid_by,
      split_percent: parseInt(form.split_percent) || 100,
    };
    if (form.date_acquired) {
      payload.date_acquired = form.date_acquired;
    }

    const { data, error } = await supabase
      .from("cards")
      .insert([payload])
      .select();

    setSaving(false);
    if (error) {
      alert("Error adding card: " + error.message);
      return;
    }
    setForm(blank);
    setExpanded(false);
    if (data && data[0]) {
      onAdd(data[0]);
    } else {
      onAdd(null);
    }
  };

  const totalCost =
    parseFloat(form.purchase_price || "0") +
    parseFloat(form.grading_fee || "0") +
    parseFloat(form.shipping_to_grader || "0") +
    parseFloat(form.shipping_from_grader || "0") +
    parseFloat(form.insurance || "0") +
    parseFloat(form.other_costs || "0");

  return (
    <form onSubmit={submit} className="bg-white border rounded-xl shadow-sm p-4 mb-6">
      <div className="flex gap-2 mb-3">
        <div className="flex-1">
          <input
            className="w-full border rounded-lg px-3 py-2 text-sm"
            placeholder="Card name *"
            value={form.card_name}
            onChange={(e) => setForm({ ...form, card_name: e.target.value })}
            required
          />
        </div>
        <div className="w-28">
          <input
            className="w-full border rounded-lg px-3 py-2 text-sm"
            placeholder="Card ID (e.g. 4/102)"
            value={form.card_id}
            onChange={(e) => setForm({ ...form, card_id: e.target.value })}
          />
        </div>
      </div>

      <div className="mb-3 w-40">
        <label className="text-xs text-gray-500">Purchase price ($) *</label>
        <input
          type="number"
          step="0.01"
          className="w-full border rounded-lg px-3 py-2 text-sm"
          value={form.purchase_price}
          onChange={(e) => setForm({ ...form, purchase_price: e.target.value })}
          required
        />
      </div>

      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="text-sm text-blue-600 hover:underline mb-2"
      >
        {expanded ? "− Less" : "+ Add grading / shipping / other costs"}
      </button>

      {expanded && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <label className="text-xs text-gray-500">Grading fee</label>
            <input
              type="number"
              step="0.01"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={form.grading_fee}
              onChange={(e) => setForm({ ...form, grading_fee: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">Insurance</label>
            <input
              type="number"
              step="0.01"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={form.insurance}
              onChange={(e) => setForm({ ...form, insurance: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">Shipping (to grader)</label>
            <input
              type="number"
              step="0.01"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={form.shipping_to_grader}
              onChange={(e) =>
                setForm({ ...form, shipping_to_grader: e.target.value })
              }
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">Shipping (from grader)</label>
            <input
              type="number"
              step="0.01"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={form.shipping_from_grader}
              onChange={(e) =>
                setForm({ ...form, shipping_from_grader: e.target.value })
              }
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">Other costs</label>
            <input
              type="number"
              step="0.01"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={form.other_costs}
              onChange={(e) =>
                setForm({ ...form, other_costs: e.target.value })
              }
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <label className="text-xs text-gray-500">Paid by</label>
          <select
            className="w-full border rounded-lg px-3 py-2 text-sm"
            value={form.paid_by}
            onChange={(e) => setForm({ ...form, paid_by: e.target.value })}
          >
            <option>Quez</option>
            <option>Stevie</option>
            <option>Both</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500">Split % (vs other)</label>
          <input
            type="number"
            min="0"
            max="100"
            className="w-full border rounded-lg px-3 py-2 text-sm"
            value={form.split_percent}
            onChange={(e) =>
              setForm({ ...form, split_percent: e.target.value })
            }
          />
        </div>
      </div>

      <div className="mb-3">
        <label className="text-xs text-gray-500">Notes (optional)</label>
        <input
          className="w-full border rounded-lg px-3 py-2 text-sm"
          placeholder="e.g. Charizard Base Set shadowless"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">
          Total: ${totalCost.toFixed(2)}
        </span>
        <button
          disabled={saving}
          type="submit"
          className="bg-blue-600 text-white rounded-lg px-6 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Add Card"}
        </button>
      </div>
    </form>
  );
}
