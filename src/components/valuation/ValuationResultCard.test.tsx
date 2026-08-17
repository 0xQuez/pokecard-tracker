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
    share_token: "tok-9",
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

  it("shows the Share with vendor controls on a completed result", async () => {
    const cap: RealtimeCapture = { update: null, channelName: null, removedChannels: [] };
    const client = makeRealtimeClient({ request: request("done"), result: result() }, cap);
    render(<ValuationResultCard valuationId={9} client={client} />);

    await screen.findByText(/Dragonite ex/i);
    expect(screen.getByTestId("share-with-vendor")).toBeTruthy();
    expect(screen.getByTestId("regenerate-link")).toBeTruthy();
  });

  it("copies the share link when 'Share with vendor' is clicked", async () => {
    const cap: RealtimeCapture = { update: null, channelName: null, removedChannels: [] };
    const client = makeRealtimeClient({ request: request("done"), result: result() }, cap);
    // jsdom has no navigator.clipboard; the fallback resolves silently, so we
    // assert the visible "copied" feedback appears.
    render(<ValuationResultCard valuationId={9} client={client} />);
    await screen.findByText(/Dragonite ex/i);
    screen.getByTestId("share-with-vendor").click();
    expect(await screen.findByText(/Link copied/i)).toBeTruthy();
  });

  it("regenerates the token on demand and reports the rotation", async () => {
    const cap: RealtimeCapture = { update: null, channelName: null, removedChannels: [] };
    const client = makeRealtimeClient({ request: request("done"), result: result() }, cap);
    const regenerateShare = vi.fn(async () => ({ kind: "ok", shareToken: "tok-new" } as const));
    render(
      <ValuationResultCard
        valuationId={9}
        client={client}
        regenerateShare={regenerateShare as any}
      />
    );
    await screen.findByText(/Dragonite ex/i);
    act(() => {
      screen.getByTestId("regenerate-link").click();
    });
    expect(await screen.findByTestId("regenerate-ok")).toHaveTextContent(/new link created/i);
    expect(regenerateShare).toHaveBeenCalledWith(9);
  });

  it("polls and surfaces the result when realtime never fires (guest anon)", async () => {
    const running = request("running");
    const done = request("done");
    // config is read at query time, so mutating it simulates the worker finishing
    // in the DB while the client never receives a realtime UPDATE.
    const config = { request: running, result: null as ValuationResultRow | null };
    const cap: RealtimeCapture = { update: null, channelName: null, removedChannels: [], requestFetches: 0 };
    const client = makeRealtimeClient(config, cap);

    render(<ValuationResultCard valuationId={9} client={client} pollIntervalMs={20} />);

    // Initially running — no curve yet.
    expect(await screen.findByTestId("valuation-status")).toHaveAttribute("data-status", "running");
    expect(screen.queryByText("$850.00")).toBeNull();
    const fetchAfterMount = cap.requestFetches;

    // Worker finishes; realtime channel is dead (no UPDATE ever fires).
    config.request = done;
    config.result = result();

    // The poll (every 20ms) re-reads the row and flips to done without refresh.
    expect(await screen.findByText(/Dragonite ex/i)).toBeTruthy();
    expect(screen.getByTestId("valuation-status")).toHaveAttribute("data-status", "done");
    expect(cap.requestFetches).toBeGreaterThan(fetchAfterMount);
  });

  it("stops polling once the request reaches done", async () => {
    const running = request("running");
    const done = request("done");
    const config = { request: running, result: null as ValuationResultRow | null };
    const cap: RealtimeCapture = { update: null, channelName: null, removedChannels: [], requestFetches: 0 };
    const client = makeRealtimeClient(config, cap);

    render(<ValuationResultCard valuationId={9} client={client} pollIntervalMs={10} />);
    await screen.findByTestId("valuation-status");

    config.request = done;
    config.result = result();
    await screen.findByText(/Dragonite ex/i); // poll picks it up
    const fetchAfterDone = cap.requestFetches;

    // Several poll cycles of wall-clock time elapse; the interval was cleared so
    // no further request reads happen.
    await new Promise((r) => setTimeout(r, 60));
    expect(cap.requestFetches).toBe(fetchAfterDone);
  });
});
