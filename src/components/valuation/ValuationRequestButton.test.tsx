// Component tests for <ValuationRequestButton>. Runs under vitest (jsdom).
/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// The component imports { supabase } from supabaseClient as its default client;
// mock it so the real (env-dependent) client is never constructed in tests.
vi.mock("@/lib/supabaseClient", () => ({
  supabase: { __mock: true },
}));

import ValuationRequestButton from "./ValuationRequestButton";
import type { ValuationRequestRow } from "@/lib/valuation-ui";

function makeQueueClient(opts: {
  recent?: boolean;
  insertError?: boolean;
  log?: string[];
} = {}) {
  const { recent = false, insertError = false, log = [] } = opts;
  const request: ValuationRequestRow = {
    id: 42,
    user_id: "Quez",
    card_query: "Dragonite ex",
    card_id: null,
    status: recent ? "done" : "pending",
    priority: 0,
    claimed_by: null,
    created_at: "2026-08-12T10:00:00Z",
    started_at: null,
    completed_at: recent ? "2026-08-12T10:03:00Z" : null,
    error: null,
  };
  const result = {
    id: 42,
    request_id: 42,
    card_identity: { name: "Dragonite ex" },
    price_points: [],
    condition_curve: {},
    created_at: "2026-08-12T10:03:00Z",
  };
  return {
    client: {
      from(_table: string) {
        const q = {
          select() {
            return q;
          },
          eq() {
            return q;
          },
          gte() {
            return q;
          },
          order() {
            return { limit: () => Promise.resolve({ data: recent ? [{ ...request, valuation_results: [result] }] : [], error: null }) };
          },
          limit() {
            return Promise.resolve({ data: recent ? [{ ...request, valuation_results: [result] }] : [], error: null });
          },
          single() {
            return Promise.resolve(insertError ? { data: null, error: { message: "db down" } } : { data: request, error: null });
          },
          insert(row: { card_query?: string }) {
            log.push("insert");
            if (insertError) {
              return { select: () => ({ single: () => Promise.resolve({ data: null, error: { message: "db down" } }) }) };
            }
            const inserted: ValuationRequestRow = {
              ...request,
              id: 99,
              card_query: row.card_query ?? "",
              status: "pending",
            };
            return { select: () => ({ single: () => Promise.resolve({ data: inserted, error: null }) }) };
          },
        };
        return q;
      },
    },
    log,
  };
}

describe("ValuationRequestButton", () => {
  it("renders the trigger and is disabled without a valid query", () => {
    render(<ValuationRequestButton cardQuery="" client={makeQueueClient().client} />);
    const btn = screen.getByRole("button", { name: /get valuation/i });
    expect(btn).toBeDisabled();
  });

  it("queues a valuation on click and shows queued feedback", async () => {
    const { client, log } = makeQueueClient();
    const onValuation = vi.fn();
    render(
      <ValuationRequestButton
        cardQuery="Dragonite ex"
        client={client}
        onValuation={onValuation}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /get valuation/i }));

    await waitFor(() => expect(log).toContain("insert"));
    expect(onValuation).toHaveBeenCalledTimes(1);
    const outcome = onValuation.mock.calls[0][0];
    expect(outcome.kind).toBe("queued");
    expect(outcome.requestId).toBe(99);
    // feedback shows the queued message
    expect(screen.getByTestId("valuation-feedback").textContent).toMatch(/queued/i);
  });

  it("shows an existing recent valuation instead of inserting a duplicate", async () => {
    const { client, log } = makeQueueClient({ recent: true });
    const onValuation = vi.fn();
    render(
      <ValuationRequestButton cardQuery="Dragonite ex" client={client} onValuation={onValuation} />
    );

    fireEvent.click(screen.getByRole("button", { name: /get valuation/i }));

    await waitFor(() => expect(onValuation).toHaveBeenCalledTimes(1));
    const outcome = onValuation.mock.calls[0][0];
    expect(outcome.kind).toBe("shown_recent");
    expect(outcome.requestId).toBe(42);
    expect(log).not.toContain("insert");
    expect(await screen.findByText(/already exists/i)).toBeTruthy();
  });

  it("surfaces an error when the insert fails", async () => {
    const { client } = makeQueueClient({ insertError: true });
    render(<ValuationRequestButton cardQuery="Charizard" client={client} />);

    fireEvent.click(screen.getByRole("button", { name: /get valuation/i }));

    expect(await screen.findByText(/db down/i)).toBeTruthy();
  });
});
