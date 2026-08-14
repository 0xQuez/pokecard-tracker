// Component tests for <CandidatePicker> (T22.6). Runs under vitest (jsdom).
// The picker is pure/presentational — no supabase, no network — so these are
// straightforward render + fireEvent checks.
/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import CandidatePicker from "./CandidatePicker";
import type { IdentifyCandidate } from "@/lib/scan-flow";

// Mirrors the mock shapes in src/lib/scan-flow.test.ts — same name/set/number,
// differing only by stamp/variant + a ~4x price gap (the whole reason the
// confirmation picker exists).
const REGULAR: IdentifyCandidate = {
  name: "Charmander",
  set: "Scarlet & Violet Promo",
  number: "044",
  variant: null,
  price: 61,
  imageUrl: "https://img/charmander.jpg",
  confidence: "high",
  score: 0.93,
};

const PC_EXCLUSIVE: IdentifyCandidate = {
  name: "Charmander",
  set: "Scarlet & Violet Promo",
  number: "044",
  variant: "Pokemon Center Exclusive",
  price: 245,
  imageUrl: "https://img/charmander-pc.jpg",
  confidence: "high",
  score: 0.91,
};

/**
 * Build a mock top-20 ranked candidate list. Candidate i gets a descending
 * score so the ranking is deterministic: #1 at 0.98 down to #20 at 0.60.
 */
function mockTwenty(): IdentifyCandidate[] {
  return Array.from({ length: 20 }, (_, i) => ({
    name: `Candidate ${i + 1}`,
    set: "Scarlet & Violet",
    number: String(1 + i),
    variant: i === 0 ? "Holo" : null,
    price: 10 + i,
    imageUrl: `https://img/cand-${i + 1}.jpg`,
    confidence: i < 6 ? "high" : i < 13 ? "medium" : "low",
    score: Math.round((0.98 - i * 0.02) * 100) / 100,
  }));
}

describe("CandidatePicker", () => {
  it("renders every candidate with name, set/number and variant label", () => {
    render(
      <CandidatePicker
        candidates={[REGULAR, PC_EXCLUSIVE]}
        onSelect={vi.fn()}
      />
    );

    const cards = screen.getAllByTestId("candidate-card");
    expect(cards).toHaveLength(2);

    // names are present
    expect(screen.getAllByText("Charmander")).toHaveLength(2);
    // set · number line
    expect(screen.getAllByText(/Scarlet & Violet Promo · #044/)).toHaveLength(2);
    // variant label only on the PC-exclusive candidate
    expect(screen.getByText("Pokemon Center Exclusive")).toBeTruthy();
  });

  it("surfaces the price hint so the user can tell prints apart (4x gap)", () => {
    render(
      <CandidatePicker
        candidates={[REGULAR, PC_EXCLUSIVE]}
        onSelect={vi.fn()}
      />
    );
    const prices = screen
      .getAllByTestId("candidate-price")
      .map((el) => el.textContent);
    expect(prices).toContain("$61.00");
    expect(prices).toContain("$245.00");
  });

  it("fires onSelect with the chosen candidate on tap", () => {
    const onSelect = vi.fn();
    render(
      <CandidatePicker
        candidates={[REGULAR, PC_EXCLUSIVE]}
        onSelect={onSelect}
      />
    );

    // Tap the PC-exclusive card (identified by its variant label's card).
    const pcCard = screen
      .getAllByTestId("candidate-card")
      .find((el) => el.getAttribute("data-variant") === "Pokemon Center Exclusive");
    expect(pcCard).toBeTruthy();
    fireEvent.click(pcCard!);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toEqual(PC_EXCLUSIVE);
  });

  it("fires onCancel when the start-over button is tapped", () => {
    const onCancel = vi.fn();
    render(
      <CandidatePicker
        candidates={[REGULAR]}
        onSelect={vi.fn()}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /start over/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders an empty/error slot when there are no candidates", () => {
    render(<CandidatePicker candidates={[]} onSelect={vi.fn()} />);
    const picker = screen.getByTestId("candidate-picker");
    expect(picker.getAttribute("data-empty")).toBe("true");
    expect(screen.getByText(/no confident match/i)).toBeTruthy();
    expect(screen.getByText(/clearer photo/i)).toBeTruthy();
    // no tappable cards, no start-over button when nothing to disambiguate
    expect(screen.queryAllByTestId("candidate-card")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /start over/i })).toBeNull();
    // no "show more" when there's nothing to expand
    expect(screen.queryByTestId("show-more")).toBeNull();
  });

  it("shows a ranked slice by default and expands to all 20 on 'show more'", () => {
    render(<CandidatePicker candidates={mockTwenty()} onSelect={vi.fn()} />);

    // Default progressive disclosure: only the top slice (4) is rendered.
    expect(screen.getAllByTestId("candidate-card")).toHaveLength(4);

    // The slice is ranked: top candidate first, with its score and bar.
    const top = screen.getAllByTestId("candidate-card")[0];
    expect(top.textContent).toContain("Candidate 1");
    expect(top.getAttribute("data-score")).toBe("0.98");
    expect(screen.getByText("98%")).toBeTruthy();
    expect(screen.getAllByTestId("candidate-score-bar")).toHaveLength(4);

    // "Show more" expands to the full 20.
    const showMore = screen.getByTestId("show-more");
    expect(showMore.textContent).toMatch(/show more/i);
    fireEvent.click(showMore);
    expect(screen.getAllByTestId("candidate-card")).toHaveLength(20);
    // After expansion the affordance is gone.
    expect(screen.queryByTestId("show-more")).toBeNull();
    // Last-ranked candidate is now visible with a low score.
    const last = screen.getAllByTestId("candidate-card")[19];
    expect(last.textContent).toContain("Candidate 20");
    expect(last.getAttribute("data-score")).toBe("0.6");
    expect(screen.getByText("60%")).toBeTruthy();
  });

  it("ranks out-of-order input by score and flags the top pick as 'Best match'", () => {
    const [a, b, c] = mockTwenty();
    // Deliberately shuffled input; the picker must re-rank by score desc.
    render(
      <CandidatePicker
        candidates={[b, c, a]}
        onSelect={vi.fn()}
        initialVisibleCount={3}
      />
    );
    const cards = screen.getAllByTestId("candidate-card");
    expect(cards).toHaveLength(3);
    // Top-ranked (highest score) surfaces first with the badge.
    expect(cards[0].textContent).toContain("Candidate 1");
    const badge = screen.getByTestId("best-match");
    expect(badge).toBeTruthy();
    // Only ONE best-match badge across the list.
    expect(screen.getAllByTestId("best-match")).toHaveLength(1);
  });

  it("does not show a 'Best match' badge for a lone candidate", () => {
    render(<CandidatePicker candidates={[REGULAR]} onSelect={vi.fn()} />);
    expect(screen.queryByTestId("best-match")).toBeNull();
    // Single candidate still tappable; no show-more.
    expect(screen.getAllByTestId("candidate-card")).toHaveLength(1);
    expect(screen.queryByTestId("show-more")).toBeNull();
  });

  it("tap-to-confirm on any expanded candidate fires onSelect with that candidate", () => {
    const onSelect = vi.fn();
    render(<CandidatePicker candidates={mockTwenty()} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("show-more"));
    const cards = screen.getAllByTestId("candidate-card");
    // Pick a mid-list candidate (index 12 → Candidate 13) after expansion.
    fireEvent.click(cards[12]);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toMatchObject({ name: "Candidate 13" });
  });
});
