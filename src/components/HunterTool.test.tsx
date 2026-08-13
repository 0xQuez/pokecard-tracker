// Integration test for the T22.1 "Scan card" wiring in the HunterTool SearchTab.
// Verifies the button opens the capture component and the captured image File is
// handed back and displayed. Runs under vitest (jsdom).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

// HunterTool constructs the shared (env-dependent) supabase client and calls
// queueValuation — stub both; WeeklyHunt is a sibling tab we don't test here.
vi.mock("@/lib/supabaseClient", () => ({
  supabase: {
    storage: {
      from() {
        return {
          upload: () =>
            Promise.resolve({ data: { path: "scan-x.jpg" }, error: null }),
        };
      },
    },
  },
}));

vi.mock("@/lib/valuation-ui", () => ({
  queueValuation: vi.fn(),
}));

vi.mock("@/components/WeeklyHunt", () => ({ default: () => null }));

import HunterTool from "./HunterTool";

function makeFile(): File {
  return new File([new Uint8Array([1, 2, 3])], "card.jpg", { type: "image/jpeg" });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("HunterTool SearchTab scan wiring", () => {
  it("opens the capture panel from the Scan card button", async () => {
    render(<HunterTool />);
    fireEvent.click(screen.getByRole("button", { name: /scan card/i }));
    // jsdom has no camera → upload-only fallback.
    await waitFor(() => expect(screen.getByTestId("card-scanner-panel")).toBeTruthy());
    expect(screen.getByTestId("card-scanner-file-input")).toBeTruthy();
  });

  it("displays the captured image File returned by the scanner", async () => {
    render(<HunterTool />);
    fireEvent.click(screen.getByRole("button", { name: /scan card/i }));
    await waitFor(() => expect(screen.getByTestId("card-scanner-file-input")).toBeTruthy());

    fireEvent.change(screen.getByTestId("card-scanner-file-input"), {
      target: { files: [makeFile()] },
    });
    await waitFor(() => expect(screen.getByTestId("card-scanner-use")).toBeTruthy());
    fireEvent.click(screen.getByTestId("card-scanner-use"));

    // Panel closes, captured card is shown in the search view (local object URL).
    await waitFor(() => expect(screen.getByTestId("scanned-card")).toBeTruthy());
    expect(screen.queryByTestId("card-scanner-panel")).toBeNull();
    expect(screen.getByTestId("scanned-card").textContent).toMatch(/card\.jpg/);
  });

  it("lets the user clear the scanned card", async () => {
    render(<HunterTool />);
    fireEvent.click(screen.getByRole("button", { name: /scan card/i }));
    await waitFor(() => expect(screen.getByTestId("card-scanner-file-input")).toBeTruthy());
    fireEvent.change(screen.getByTestId("card-scanner-file-input"), {
      target: { files: [makeFile()] },
    });
    await waitFor(() => expect(screen.getByTestId("card-scanner-use")).toBeTruthy());
    fireEvent.click(screen.getByTestId("card-scanner-use"));
    await waitFor(() => expect(screen.getByTestId("scanned-card")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(screen.queryByTestId("scanned-card")).toBeNull();
  });
});
