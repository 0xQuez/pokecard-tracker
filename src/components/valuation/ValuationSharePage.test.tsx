// Component tests for the vendor-facing share page + vendor view.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/supabaseClient", () => ({
  supabase: { __mock: true },
}));

import ValuationSharePage from "./ValuationSharePage";
import { VendorValuationView, headlineValue } from "./ValuationParts";
import { makeRealtimeClient } from "./valuation-mock-client";
import { FULL_CURVE, makeResult } from "@/lib/valuation-fixtures";
import type { ConditionCurveJson } from "@/lib/valuation-ui";

describe("ValuationSharePage", () => {
  it("renders ONLY the shared valuation when the token is valid", async () => {
    const client = makeRealtimeClient({
      request: null,
      result: null,
      sharedValuation: makeResult(3),
    });
    render(<ValuationSharePage token="tok-3" client={client} />);

    // identity header
    expect(await screen.findByText(/Dragonite ex/i)).toBeTruthy();
    // headline value (NM = 850.00)
    expect(screen.getByTestId("headline-value")).toHaveTextContent("$850.00");
    // per-condition curve (all 5)
    for (const cond of ["NM", "LP", "MP", "HP", "DMG"]) {
      expect(screen.getByTestId(`curve-${cond}`)).toHaveAttribute("data-has-data", "true");
    }
    // clickable sources
    expect(screen.getByTestId("source-list")).toBeTruthy();
    // footer
    expect(screen.getByText(/Data as of/i)).toBeTruthy();
    // NO owner-only chrome: no share controls, no re-run button on the vendor view
    expect(screen.queryByTestId("share-with-vendor")).toBeNull();
    expect(screen.queryByTestId("re-run")).toBeNull();
  });

  it("renders an invalid/revoked state for a bad token (no other data leaked)", async () => {
    const client = makeRealtimeClient({ request: null, result: null, sharedValuation: null });
    render(<ValuationSharePage token="old-revoked-token" client={client} />);
    expect(await screen.findByTestId("share-invalid")).toBeTruthy();
    expect(screen.getByText(/no longer valid/i)).toBeTruthy();
    expect(screen.queryByTestId("headline-value")).toBeNull();
  });

  it("renders an error state when the RPC fails", async () => {
    const client = makeRealtimeClient({
      request: null,
      result: null,
      rpcError: "connection reset",
    });
    render(<ValuationSharePage token="tok-3" client={client} />);
    expect(await screen.findByTestId("share-invalid")).toBeTruthy();
    expect(screen.getByText(/connection reset/i)).toBeTruthy();
  });
});

describe("VendorValuationView", () => {
  it("headlineValue: prefers NM, falls back through the condition order, null when no data", () => {
    expect(headlineValue(FULL_CURVE)).toEqual({ condition: "Near Mint", price: 850, sampleCount: 8 });
    const noNmLp: ConditionCurveJson = { NM: null, LP: { estimated_price: 690, sample_count: 6 } };
    expect(headlineValue(noNmLp)).toEqual({ condition: "Lightly Played", price: 690, sampleCount: 6 });
    expect(headlineValue(null).price).toBeNull();
  });

  it("renders the 'Data as of' footer with the result timestamp", () => {
    render(
      <VendorValuationView
        identity={makeResult(3).card_identity}
        curve={FULL_CURVE}
        points={makeResult(3).price_points}
        lastUpdated="2026-08-12T10:03:00Z"
      />
    );
    expect(screen.getByTestId("vendor-valuation-view")).toBeTruthy();
    expect(screen.getByTestId("headline-value")).toHaveTextContent("$850.00");
    expect(screen.getByText(/Data as of/i)).toBeTruthy();
  });

  it("stacks the curve as full-width rows on a narrow (≤520px) screen", () => {
    // Simulate a phone viewport so useIsNarrow() renders the stacked layout.
    const mql = {
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    vi.stubGlobal("matchMedia", vi.fn(() => mql));
    window.matchMedia = vi.fn(() => mql as unknown as MediaQueryList);

    render(
      <VendorValuationView
        identity={makeResult(3).card_identity}
        curve={FULL_CURVE}
        points={makeResult(3).price_points}
        lastUpdated="2026-08-12T10:03:00Z"
      />
    );
    // All five condition rows still render with the same testids + prices.
    for (const cond of ["NM", "LP", "MP", "HP", "DMG"]) {
      expect(screen.getByTestId(`curve-${cond}`)).toHaveAttribute("data-has-data", "true");
    }
    expect(screen.getAllByTestId("confidence-badge").length).toBe(5);
    expect(screen.getAllByText("$850.00").length).toBeGreaterThan(0);
    expect(screen.getByText("$240.00")).toBeTruthy();
  });
});
