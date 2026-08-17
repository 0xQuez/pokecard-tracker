// Integration test for the guest render guard in page.tsx (T26.3).
// Verifies that when a guest session is active, the Page component renders only
// the hunter surface and does NOT mount financial tabs or fetch the card ledger.
// Runs under vitest (jsdom).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// SessionStorage gate — a guest session is what the real user creates via the
// ProfileGate guest option, and what page.tsx restores on load.
const guestSession = () => {
  sessionStorage.setItem("pokecards_auth", "true");
  sessionStorage.setItem("pokecards_profile", "guest");
};

// Stub the Supabase client so any ledger fetch is observable, not real.
const fromSpy = vi.fn();
vi.mock("@/lib/supabaseClient", () => ({
  supabase: {
    from: (...args: unknown[]) => fromSpy(...args),
  },
}));

vi.mock("@/lib/valuation-ui", () => ({
  queueValuation: vi.fn(),
}));

vi.mock("@/components/WeeklyHunt", () => ({
  default: () => <div data-testid="weekly-hunt-stub" />,
}));

// Financial/owner tabs must never render for a guest. Give each a sentinel so
// the guard's render path is provable: absence = guard is actually protecting.
vi.mock("@/components/Home", () => ({ default: () => <div data-testid="financial-home" /> }));
vi.mock("@/components/Activity", () => ({ default: () => <div data-testid="financial-activity" /> }));
vi.mock("@/components/Add", () => ({ default: () => <div data-testid="financial-add" /> }));
vi.mock("@/components/Settle", () => ({ default: () => <div data-testid="financial-settle" /> }));
vi.mock("@/components/History", () => ({ default: () => <div data-testid="financial-history" /> }));

import Page from "../app/page";

beforeEach(() => {
  fromSpy.mockReset();
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Page guest render guard", () => {
  it("renders only the hunter surface for a guest session", () => {
    guestSession();
    render(<Page />);
    expect(screen.getByText("Find cards worth buying & grading")).toBeTruthy();
  });

  it("does not mount any financial or owner tab for a guest", () => {
    guestSession();
    render(<Page />);
    for (const id of [
      "financial-home",
      "financial-activity",
      "financial-add",
      "financial-settle",
      "financial-history",
      "weekly-hunt-stub",
    ]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
  });

  it("never fetches the card ledger for a guest", () => {
    guestSession();
    render(<Page />);
    expect(fromSpy).not.toHaveBeenCalled();
  });
});
