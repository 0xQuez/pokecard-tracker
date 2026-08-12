// Component tests for <ValuationResultCard>: load states + realtime auto-update.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";

vi.mock("@/lib/supabaseClient", () => ({
  supabase: { __mock: true },
}));

import ValuationResultCard from "./ValuationResultCard";
import { makeRealtimeClient, type RealtimeCapture } from "./valuation-mock-client";
import type { ValuationRequestRow, ValuationResultRow } from "@/lib/valuation-ui";

function request(status: ValuationRequestRow["status"]): ValuationRequestRow {
  return {
    id: 9,
    user_id: "Quez",
    card_query: "Dragonite ex",
    card_id: null,
    status,
    priority: 0,
    claimed_by: status === "pending" ? null : "worker-1",
    created_at: "2026-08-12T10:00:00Z",
    started_at: status === "pending" ? null : "2026-08-12T10:00:30Z",
    completed_at: status === "done" ? "2026-08-12T10:03:00Z" : null,
    error: status === "blocked" ? "ambiguous identity" : null,
  };
}

function result(): ValuationResultRow {
  return {
    id: 9,
    request_id: 9,
    card_identity: { set: "Dragon", number: "90/97", variant: null, name: "Dragonite ex" },
    price_points: [
      { source: "ebay", url: "https://ebay.com/itm/1", price: 850, condition_verified: "NM", is_trust_anchor: true },
      { source: "tcgplayer", url: "https://tcg.com/p/2", price: 499.99 },
    ],
    condition_curve: {
      NM: { estimated_price: 850, sample_count: 8 },
      LP: { estimated_price: 690, sample_count: 6 },
      MP: { estimated_price: 520, sample_count: 7 },
      HP: { estimated_price: 380, sample_count: 4 },
      DMG: { estimated_price: 240, sample_count: 3 },
    },
    created_at: "2026-08-12T10:03:00Z",
  };
}

describe("ValuationResultCard", () => {
  it("renders the pending state until the agent picks it up", async () => {
    const cap: RealtimeCapture = { update: null, channelName: null, removedChannels: [] };
    const client = makeRealtimeClient({ request: request("pending"), result: null }, cap);
    render(<ValuationResultCard valuationId={9} client={client} />);

    expect(await screen.findByTestId("valuation-status")).toHaveAttribute("data-status", "pending");
    expect(screen.getByText(/queued/i)).toBeTruthy();
  });

  it("renders the running state", async () => {
    const cap: RealtimeCapture = { update: null, channelName: null, removedChannels: [] };
    const client = makeRealtimeClient({ request: request("running"), result: null }, cap);
    render(<ValuationResultCard valuationId={9} client={client} />);

    expect(await screen.findByTestId("valuation-status")).toHaveAttribute("data-status", "running");
    expect(screen.getByText(/researching prices/i)).toBeTruthy();
  });

  it("renders a completed result with full curve, sources and trust anchor", async () => {
    const cap: RealtimeCapture = { update: null, channelName: null, removedChannels: [] };
    const client = makeRealtimeClient({ request: request("done"), result: result() }, cap);
    render(<ValuationResultCard valuationId={9} client={client} />);

    // identity header
    expect(await screen.findByText(/Dragonite ex/i)).toBeTruthy();
    // full curve (all 5 conditions present)
    for (const cond of ["NM", "LP", "MP", "HP", "DMG"]) {
      const cell = await screen.findByTestId(`curve-${cond}`);
      expect(cell).toHaveAttribute("data-has-data", "true");
    }
    expect(screen.getAllByText("$850.00").length).toBeGreaterThan(0);
    // sources with a trust anchor
    expect(screen.getAllByTestId("trust-anchor").length).toBeGreaterThan(0);
    expect(screen.getByText(/Last updated/i)).toBeTruthy();
    // re-run button
    expect(screen.getByTestId("re-run")).toBeTruthy();
  });

  it("renders blocked state with the error reason", async () => {
    const cap: RealtimeCapture = { update: null, channelName: null, removedChannels: [] };
    const client = makeRealtimeClient({ request: request("blocked"), result: null }, cap);
    render(<ValuationResultCard valuationId={9} client={client} />);

    expect(await screen.findByTestId("valuation-status")).toHaveAttribute("data-status", "blocked");
    expect(screen.getByText(/ambiguous identity/i)).toBeTruthy();
  });

  it("auto-updates live when realtime reports status → done", async () => {
    const running = request("running");
    const done = request("done");
    // config.request is read at query time, so mutating it drives later fetches.
    const config = { request: running, result: null as ValuationResultRow | null };
    const cap: RealtimeCapture = { update: null, channelName: null, removedChannels: [] };
    const client = makeRealtimeClient(config, cap);

    render(<ValuationResultCard valuationId={9} client={client} />);

    // Initially running — no curve yet.
    expect(await screen.findByTestId("valuation-status")).toHaveAttribute("data-status", "running");
    expect(screen.queryByText("$850.00")).toBeNull();

    // Agent finishes: realtime UPDATE arrives, DB now has a result.
    expect(cap.update).toBeTruthy();
    config.request = done;
    config.result = result();
    act(() => {
      cap.update!({ new: done });
    });

    // The card should fetch + render the result.
    expect(await screen.findByText(/Dragonite ex/i)).toBeTruthy();
    expect(await screen.findByTestId("valuation-status")).toHaveAttribute("data-status", "done");
    expect((await screen.findAllByText("$850.00")).length).toBeGreaterThan(0);
  });

  it("unsubscribes from realtime on unmount", async () => {
    const cap: RealtimeCapture = { update: null, channelName: null, removedChannels: [] };
    const client = makeRealtimeClient({ request: request("pending"), result: null }, cap);
    const { unmount } = render(<ValuationResultCard valuationId={9} client={client} />);
    await screen.findByTestId("valuation-status");
    expect(cap.channelName).toMatch(/valuation-result-9/);
    unmount();
    expect(cap.removedChannels).toContain("valuation-result-9");
  });

  it("renders an error state when loading fails", async () => {
    const client = {
      from() {
        return {
          select() {
            const q = {
              eq() {
                return q;
              },
              maybeSingle() {
                return Promise.resolve({ data: null, error: { message: "network down" } });
              },
            };
            return q;
          },
        };
      },
      channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
      removeChannel: () => {},
    };
    render(<ValuationResultCard valuationId={9} client={client as any} />);
    expect(await screen.findByTestId("valuation-error")).toHaveTextContent(/network down/);
  });
});
