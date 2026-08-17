// Integration test for the T22.7 scan-flow wiring in the HunterTool SearchTab.
// Verifies the END-TO-END glue: CardScanner → uploadCardImage (T22.2) →
// identifyCard (T22.5) → resolveIdentity → CandidatePicker confirm (T22.6) →
// queueValuation (T18.8) → ValuationResultCard. Every network boundary is
// mocked; the component itself is exercised for real.
//
// Runs under vitest (jsdom). jest-dom matchers are NOT used here to avoid the
// pre-existing multi-file matcher-isolation quirk in this repo — assertions use
// plain vitest expects.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

// ── Mocks ────────────────────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  queueValuation: vi.fn(),
  uploadCardImageToBucket: vi.fn(),
  identifyCard: vi.fn(),
}));
const { queueValuation, uploadCardImageToBucket, identifyCard } = h;

vi.mock("@/lib/supabaseClient", () => ({ supabase: { __mock: true } }));
vi.mock("@/lib/valuation-ui", () => ({ queueValuation: h.queueValuation }));
vi.mock("@/lib/card-image-upload", () => ({ uploadCardImageToBucket: h.uploadCardImageToBucket }));
// Keep resolveIdentity + buildQueueParams real; only mock the network boundary.
vi.mock("@/lib/scan-flow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scan-flow")>()),
  identifyCard: h.identifyCard,
}));
vi.mock("@/components/WeeklyHunt", () => ({ default: () => null }));
// The result card is a heavy realtime component; stub it so the "done" state
// assertion is about the flow, not the result card internals (T18.8 tests it).
vi.mock("@/components/valuation/ValuationResultCard", () => ({
  default: ({ valuationId }: { valuationId: number }) => (
    <div data-testid="scan-result-card">valuation {valuationId}</div>
  ),
}));

import HunterTool from "./HunterTool";

function makeFile(): File {
  return new File([new Uint8Array([1, 2, 3])], "card.jpg", { type: "image/jpeg" });
}

// The shape identifyCard resolves to AFTER mapRawCandidates (picker shape:
// set is a string, variant is a single print, variantHints already expanded).
const REGULAR_CANDIDATE = {
  name: "Charmander",
  set: "Scarlet & Violet Promo",
  number: "44",
  variant: "regular",
  price: null,
  imageUrl: "https://img/charmander.jpg",
  confidence: "high",
};

const PC_EXCLUSIVE_CANDIDATE = {
  name: "Charmander",
  set: "Scarlet & Violet Promo",
  number: "44",
  variant: "Pokemon Center Exclusive",
  price: null,
  imageUrl: "https://img/charmander-pc.jpg",
  confidence: "high",
};

const CONFIRM_RESPONSE = {
  candidates: [REGULAR_CANDIDATE, PC_EXCLUSIVE_CANDIDATE],
  needsConfirmation: true,
};

async function captureCard() {
  render(<HunterTool />);
  fireEvent.click(screen.getByRole("button", { name: /scan card/i }));
  await waitFor(() => expect(screen.getByTestId("card-scanner-file-input")).toBeTruthy());
  fireEvent.change(screen.getByTestId("card-scanner-file-input"), {
    target: { files: [makeFile()] },
  });
  await waitFor(() => expect(screen.getByTestId("card-scanner-use")).toBeTruthy());
  fireEvent.click(screen.getByTestId("card-scanner-use"));
  await waitFor(() => expect(screen.getByTestId("scanned-card")).toBeTruthy());
}

beforeEach(() => {
  queueValuation.mockReset();
  uploadCardImageToBucket.mockReset().mockResolvedValue({
    ok: true,
    path: "scans/abc.jpg",
    publicUrl: "https://cdn.example.com/scans/abc.jpg",
  });
  identifyCard.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("HunterTool scan flow wiring (T22.7)", () => {
  it("queues a valuation on auto-confirm when needsConfirmation is false", async () => {
    // needsConfirmation false → single high-confidence match → auto-queue.
    identifyCard.mockResolvedValue({
      ok: true,
      data: { needsConfirmation: false, candidates: [REGULAR_CANDIDATE] },
    });
    queueValuation.mockResolvedValue({
      kind: "queued",
      requestId: 99,
      request: { id: 99 },
      message: "Queued",
    });

    await captureCard();
    fireEvent.click(screen.getByTestId("scan-identify"));

    // upload → identify → queue
    await waitFor(() => expect(queueValuation).toHaveBeenCalledTimes(1));
    expect(uploadCardImageToBucket).toHaveBeenCalledTimes(1);
    expect(identifyCard).toHaveBeenCalledWith("https://cdn.example.com/scans/abc.jpg");
    const [, params] = queueValuation.mock.calls[0];
    // auto-confirm uses the single candidate's query (regular print first).
    expect(params.cardQuery).toMatch(/Charmander/);
    expect(params.cardQuery).toMatch(/regular/);

    // done → ValuationResultCard renders with the queued request id.
    await waitFor(() => expect(screen.getByTestId("scan-result-card")).toBeTruthy());
    expect(screen.getByTestId("scan-result-card").textContent).toContain("99");
  });

  it("asks the user to confirm via CandidatePicker when needsConfirmation is true", async () => {
    identifyCard.mockResolvedValue({ ok: true, data: CONFIRM_RESPONSE });

    await captureCard();
    fireEvent.click(screen.getByTestId("scan-identify"));

    // Confirmation picker appears; nothing queued yet.
    await waitFor(() => expect(screen.getByTestId("scan-confirm")).toBeTruthy());
    expect(queueValuation).not.toHaveBeenCalled();

    // The scanner returned variantHints ["regular","Pokemon Center Exclusive"],
    // so the picker expands to two rows. Tap the PC-exclusive print.
    const pcCard = screen
      .getAllByTestId("candidate-card")
      .find((el) => el.getAttribute("data-variant") === "Pokemon Center Exclusive");
    expect(pcCard).toBeTruthy();
    queueValuation.mockResolvedValue({
      kind: "queued",
      requestId: 101,
      request: { id: 101 },
      message: "Queued",
    });
    fireEvent.click(pcCard!);

    await waitFor(() => expect(queueValuation).toHaveBeenCalledTimes(1));
    const [, params] = queueValuation.mock.calls[0];
    expect(params.cardQuery).toMatch(/Pokemon Center Exclusive/);
    await waitFor(() => expect(screen.getByTestId("scan-result-card")).toBeTruthy());
  });

  it("shows a retry path when the upload fails", async () => {
    uploadCardImageToBucket.mockResolvedValue({
      ok: false,
      error: new Error("Image is 12.0 MB. The maximum is 10 MB."),
    });

    await captureCard();
    fireEvent.click(screen.getByTestId("scan-identify"));

    await waitFor(() => expect(screen.getByTestId("scan-error")).toBeTruthy());
    expect(screen.getByTestId("scan-error").textContent).toMatch(/maximum is 10 MB/);
    expect(identifyCard).not.toHaveBeenCalled();
    // A retry button exists (never a dead end).
    expect(screen.getByTestId("scan-retry")).toBeTruthy();

    // Retry succeeds after fixing the mock.
    uploadCardImageToBucket.mockResolvedValue({
      ok: true,
      path: "scans/abc.jpg",
      publicUrl: "https://cdn.example.com/scans/abc.jpg",
    });
    identifyCard.mockResolvedValue({
      ok: true,
      data: { needsConfirmation: false, candidates: [REGULAR_CANDIDATE] },
    });
    queueValuation.mockResolvedValue({
      kind: "queued",
      requestId: 7,
      request: { id: 7 },
      message: "Queued",
    });
    fireEvent.click(screen.getByTestId("scan-retry"));
    await waitFor(() => expect(queueValuation).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("scan-result-card").textContent).toContain("7");
  });

  it("offers manual entry when the identify API returns no matches", async () => {
    identifyCard.mockResolvedValue({ ok: true, data: { needsConfirmation: true, candidates: [] } });

    await captureCard();
    fireEvent.click(screen.getByTestId("scan-identify"));

    await waitFor(() => expect(screen.getByTestId("scan-error")).toBeTruthy());
    expect(screen.getByTestId("scan-error").textContent).toMatch(/No card matched/);
    expect(queueValuation).not.toHaveBeenCalled();

    // Manual-entry fallback routes a typed name/number to queueValuation.
    fireEvent.change(screen.getByTestId("manual-name"), { target: { value: "Charizard" } });
    fireEvent.change(screen.getByTestId("manual-number"), { target: { value: "4/102" } });
    queueValuation.mockResolvedValue({
      kind: "queued",
      requestId: 55,
      request: { id: 55 },
      message: "Queued",
    });
    fireEvent.click(screen.getByTestId("manual-submit"));

    await waitFor(() => expect(queueValuation).toHaveBeenCalledTimes(1));
    const [, params] = queueValuation.mock.calls[0];
    expect(params.cardQuery).toMatch(/Charizard/);
    expect(params.cardQuery).toMatch(/4\/102/);
    await waitFor(() => expect(screen.getByTestId("scan-result-card")).toBeTruthy());
  });
});
