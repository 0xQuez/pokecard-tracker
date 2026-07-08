"use client";

import { useState, useEffect } from "react";

type HuntRow = {
  id: number;
  card_name: string;
  card_number: string | null;
  set_name: string;
  edition: string | null;
  raw_price: number;
  psa6_price: number | null;
  psa7_price: number | null;
  psa8_price: number | null;
  psa9_price: number | null;
  margin: number;
  passes_filter: boolean;
  week_start_date: string;
  created_at: string;
};

export default function WeeklyHunt() {
  const [rows, setRows] = useState<HuntRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tableReady, setTableReady] = useState(true);
  const [nextRun, setNextRun] = useState("Wednesday 9am");
  const [picks, setPicks] = useState<HuntRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/weekly-hunt");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load weekly hunt");
        if (!cancelled) {
          setRows(data.results ?? []);
          setTableReady(data.tableReady ?? true);
          setNextRun(data.nextRun ?? "Wednesday 9am");
          const all = (data.results ?? []) as HuntRow[];
          setPicks(all.filter((r: HuntRow) => r.passes_filter).sort((a: HuntRow, b: HuntRow) => b.margin - a.margin));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const top = rows ? [...rows].sort((a, b) => b.margin - a.margin) : [];

  if (loading) {
    return (
      <div className="card" style={{ textAlign: "center", padding: 24, marginTop: 16 }}>
        <p style={{ color: "var(--text-mid)" }}>Loading this week's hunt…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ textAlign: "center", padding: 24, marginTop: 12, color: "var(--clay)", border: "1px solid var(--clay)" }}>
        {error}
      </div>
    );
  }

  // Empty / no-table state
  if (!rows || rows.length === 0) {
    return (
      <div className="card" style={{ textAlign: "center", padding: 32, marginTop: 16 }}>
        <p style={{ fontSize: 32, marginBottom: 8 }}>🎯</p>
        <p style={{ fontWeight: 600, color: "var(--ink)", marginBottom: 4 }}>Weekly Hunt</p>
        <p style={{ color: "var(--text-mid)", fontSize: 14 }}>
          {!tableReady
            ? `No hunt data available yet — next run: ${nextRun}`
            : "Runs every Wednesday at 9am. Check back then for this week's curated picks."}
        </p>
      </div>
    );
  }

  function psaCell(v: number | null) {
    return v != null ? `$${v.toFixed(0)}` : "—";
  }

  return (
    <div style={{ marginTop: 16 }}>
      {picks.length > 0 && (
        <div className="card" style={{ marginBottom: 12, background: "rgba(73,184,113,0.06)", border: "1px solid var(--sage)" }}>
          <div style={{ fontSize: 13, color: "var(--sage)", fontWeight: 700, marginBottom: 6 }}>
            🏆 Top picks this week
          </div>
          <div style={{ fontSize: 12, color: "var(--text-mid)", lineHeight: 1.5 }}>
            {picks.length} card{picks.length > 1 ? "s" : ""} cleared the 2× margin filter.
            {picks.length > 0 && (
              <span>
                {" "}Best pick: <strong>{picks[0].card_name}</strong> – {picks[0].margin.toFixed(1)}x margin.
              </span>
            )}
          </div>
        </div>
      )}

      <div className="card" style={{ overflowX: "auto", padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>Card</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>#</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>Set</th>
              <th style={{ padding: "10px 12px", textAlign: "right" }}>Raw</th>
              <th style={{ padding: "10px 12px", textAlign: "right" }}>PSA6</th>
              <th style={{ padding: "10px 12px", textAlign: "right" }}>PSA7</th>
              <th style={{ padding: "10px 12px", textAlign: "right" }}>PSA8</th>
              <th style={{ padding: "10px 12px", textAlign: "right" }}>PSA9</th>
              <th style={{ padding: "10px 12px", textAlign: "right" }}>Margin</th>
            </tr>
          </thead>
          <tbody>
            {top.map((r) => (
              <tr
                key={r.id}
                style={{
                  borderBottom: "1px solid var(--surface)",
                  background: r.passes_filter ? "rgba(73,184,113,0.04)" : undefined,
                }}
              >
                <td style={{ padding: "8px 12px", fontWeight: 600 }}>
                  {r.card_name}
                  {r.edition && (
                    <span style={{ fontWeight: 400, fontSize: 11, color: "var(--text-low)", marginLeft: 4 }}>
                      {r.edition}
                    </span>
                  )}
                </td>
                <td style={{ padding: "8px 12px", color: "var(--text-mid)", fontSize: 12, fontWeight: 500 }}>
                  {r.card_number ?? "—"}
                </td>
                <td style={{ padding: "8px 12px", color: "var(--text-mid)", fontSize: 12 }}>
                  {r.set_name}
                </td>
                <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 500 }}>${r.raw_price.toFixed(0)}</td>
                <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--text-mid)", fontSize: 12 }}>{psaCell(r.psa6_price)}</td>
                <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--text-mid)", fontSize: 12 }}>{psaCell(r.psa7_price)}</td>
                <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--text-mid)", fontSize: 12 }}>{psaCell(r.psa8_price)}</td>
                <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--text-mid)", fontSize: 12 }}>{psaCell(r.psa9_price)}</td>
                <td style={{ padding: "8px 12px", textAlign: "right" }}>
                  {r.passes_filter ? (
                    <span style={{ color: "var(--sage)", fontWeight: 700 }}>✅ {r.margin.toFixed(1)}x</span>
                  ) : (
                    <span style={{ color: "var(--text-mid)", fontSize: 12 }}>{r.margin.toFixed(1)}x</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{
        fontSize: 11,
        color: "var(--text-low)",
        textAlign: "right",
        paddingTop: 6,
        paddingRight: 4,
      }}>
        Week of {rows[0]?.week_start_date} — {top.length} cards researched
      </div>
    </div>
  );
}
