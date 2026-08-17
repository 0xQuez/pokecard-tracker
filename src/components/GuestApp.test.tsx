// Tests for the guest session shell (T26.3). A guest must see ONLY the card
// hunter surface — no Home/Add/Activity/Settle/History, no WeeklyHunt sub-tab,
// and no financial data. Runs under vitest (jsdom).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// HunterTool constructs the shared (env-dependent) supabase client and calls
// queueValuation — stub both. WeeklyHunt is a sibling sub-tab a guest must not
// see; stub it to a sentinel so absence is verifiable, not just module-load luck.
vi.mock("@/lib/supabaseClient", () => ({
  supabase: {
    storage: {
      from() {
        return {
          upload: () => Promise.resolve({ data: { path: "scan-x.jpg" }, error: null }),
        };
      },
    },
  },
}));

vi.mock("@/lib/valuation-ui", () => ({
  queueValuation: vi.fn(),
}));

vi.mock("@/components/WeeklyHunt", () => ({
  default: () => <div data-testid="weekly-hunt-stub" />,
}));

import GuestApp from "./GuestApp";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("GuestApp guest session surface", () => {
  it("renders only the hunter surface for a guest", () => {
    render(<GuestApp onLogout={vi.fn()} />);
    // Hunter tool is present.
    expect(screen.getByText("Find cards worth buying & grading")).toBeTruthy();
    expect(screen.getByText(/Search & Calc/i)).toBeTruthy();
  });

  it("does not render any financial or owner tab", () => {
    render(<GuestApp onLogout={vi.fn()} />);
    for (const label of ["Home", "Activity", "Add", "Settle", "History", "Weekly Hunt"]) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it("hides the owner avatars for a guest", () => {
    render(<GuestApp onLogout={vi.fn()} />);
    expect(screen.queryByText("Q")).toBeNull();
    expect(screen.queryByText("S")).toBeNull();
  });

  it("never mounts the WeeklyHunt sub-tab", () => {
    render(<GuestApp onLogout={vi.fn()} />);
    expect(screen.queryByTestId("weekly-hunt-stub")).toBeNull();
  });

  it("logs the guest out back to the profile gate", () => {
    const onLogout = vi.fn();
    render(<GuestApp onLogout={onLogout} />);
    fireEvent.click(screen.getByRole("button", { name: /leave guest mode/i }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});
