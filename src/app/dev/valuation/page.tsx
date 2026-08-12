"use client";

// Fixture page for the valuation UI (T18.8) — the "equivalent of Storybook
// stories" for this repo (no Storybook dependency installed). Renders every
// status/state with deterministic mock data so a human can eyeball the layout
// without a running valuation agent or a configured Supabase project.
//
// Visit: /dev/valuation

import { ValuationResultView } from "@/components/valuation/ValuationParts";
import {
  FULL_CURVE,
  FULL_POINTS,
  INSUFFICIENT_CURVE,
  makeResult,
  makeRequest,
} from "@/lib/valuation-fixtures";

const PENDING = makeRequest(1, "pending");
const RUNNING = makeRequest(2, "running");
const DONE = makeResult(3);
const INSUFFICIENT = makeResult(4, {
  condition_curve: INSUFFICIENT_CURVE,
  price_points: [FULL_POINTS[0]],
});
const BLOCKED = makeRequest(5, "blocked", {
  card_query: "Dragonite ex base holo",
  error: "Could not resolve set — multiple Dragonite ex prints matched.",
});
const FAILED = makeRequest(6, "failed", { error: "eBay rate-limited the scraper." });

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 16, marginBottom: 10, color: "var(--ink)" }}>{title}</h2>
      {children}
    </div>
  );
}

export default function ValuationDevPage() {
  return (
    <div className="page page-narrow" style={{ padding: "24px 0" }}>
      <div style={{ marginBottom: 24 }}>
        <div className="hello" style={{ fontSize: 20, fontWeight: 700 }}>
          Valuation UI fixtures
          <b style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--text-mid)" }}>
            Every status + state the components must render. Mock data only — nothing hits Supabase.
          </b>
        </div>
      </div>

      <Section title="1 · Pending (queued)">
        <ValuationResultView status={PENDING.status} identity={null} curve={null} points={null} />
      </Section>

      <Section title="2 · Running (agent researching)">
        <ValuationResultView status={RUNNING.status} identity={null} curve={null} points={null} />
      </Section>

      <Section title="3 · Done — full condition curve">
        <ValuationResultView
          status={DONE.request_id > 0 ? "done" : "done"}
          identity={DONE.card_identity}
          curve={FULL_CURVE}
          points={FULL_POINTS}
          lastUpdated={DONE.created_at}
          onReRun={() => alert("demo: re-run clicked")}
        />
      </Section>

      <Section title="4 · Done — insufficient data (some conditions missing)">
        <ValuationResultView
          status="done"
          identity={DONE.card_identity}
          curve={INSUFFICIENT_CURVE}
          points={INSUFFICIENT.price_points}
          lastUpdated={DONE.created_at}
        />
      </Section>

      <Section title="5 · Blocked (ambiguous identity)">
        <ValuationResultView
          status={BLOCKED.status}
          error={BLOCKED.error}
          identity={null}
          curve={null}
          points={null}
        />
      </Section>

      <Section title="6 · Failed (transient error)">
        <ValuationResultView
          status={FAILED.status}
          error={FAILED.error}
          identity={null}
          curve={null}
          points={null}
        />
      </Section>
    </div>
  );
}
