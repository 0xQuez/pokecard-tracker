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
};

const PC_EXCLUSIVE: IdentifyCandidate = {
  name: "Charmander",
  set: "Scarlet & Violet Promo",
  number: "044",
  variant: "Pokemon Center Exclusive",
  price: 245,
  imageUrl: "https://img/charmander-pc.jpg",
  confidence: "high",
};

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
    expect(screen.getByText(/no matching cards/i)).toBeTruthy();
    // no tappable cards, no start-over button when nothing to disambiguate
    expect(screen.queryAllByTestId("candidate-card")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /start over/i })).toBeNull();
  });
});
