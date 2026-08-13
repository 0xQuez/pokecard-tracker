// Integration test for the T19 "Scan card" wiring in the HunterTool SearchTab.
// Verifies the button opens the capture modal and the captured image URL is
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
  it("opens the capture modal from the Scan card button", async () => {
    render(<HunterTool />);
    fireEvent.click(screen.getByRole("button", { name: /scan card/i }));
    expect(screen.getByTestId("card-scan-modal")).toBeTruthy();
    // Upload-only fallback in jsdom (no camera).
    await waitFor(() => expect(screen.getByTestId("scan-file-input")).toBeTruthy());
  });

  it("displays the captured image URL returned by the modal", async () => {
    render(<HunterTool />);
    fireEvent.click(screen.getByRole("button", { name: /scan card/i }));
    await waitFor(() => expect(screen.getByTestId("scan-file-input")).toBeTruthy());

    fireEvent.change(screen.getByTestId("scan-file-input"), {
      target: { files: [makeFile()] },
    });

    await waitFor(() => expect(screen.getByTestId("scan-use-card")).toBeTruthy());
    fireEvent.click(screen.getByTestId("scan-use-card"));

    // Modal closes, captured card is shown in the search view.
    await waitFor(() => expect(screen.getByTestId("scanned-card")).toBeTruthy());
    expect(screen.queryByTestId("card-scan-modal")).toBeNull();
    expect(screen.getByTestId("scanned-card").textContent).toMatch(/\/card-images\//);
  });

  it("lets the user clear the scanned card", async () => {
    render(<HunterTool />);
    fireEvent.click(screen.getByRole("button", { name: /scan card/i }));
    await waitFor(() => expect(screen.getByTestId("scan-file-input")).toBeTruthy());
    fireEvent.change(screen.getByTestId("scan-file-input"), {
      target: { files: [makeFile()] },
    });
    await waitFor(() => expect(screen.getByTestId("scan-use-card")).toBeTruthy());
    fireEvent.click(screen.getByTestId("scan-use-card"));
    await waitFor(() => expect(screen.getByTestId("scanned-card")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(screen.queryByTestId("scanned-card")).toBeNull();
  });
});
