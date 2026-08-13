// Component tests for <CardScanner> (T22.1). Runs under vitest (jsdom).
// Verifies the pure capture+preview flow — camera viewfinder, file fallback,
// permission-denied handling, and Retake / Use photo — with NO upload/API calls.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

import CardScanner from "./CardScanner";

/** A getUserMedia that resolves a fake, stoppable stream. */
function cameraGum(): typeof navigator.mediaDevices.getUserMedia {
  return (async () => ({ getTracks: () => [{ stop: vi.fn() }] }) as unknown as MediaStream) as typeof navigator.mediaDevices.getUserMedia;
}

/** A getUserMedia that rejects with a permission error. */
function deniedGum(): typeof navigator.mediaDevices.getUserMedia {
  return (async () => {
    const e = new Error("Permission denied");
    e.name = "NotAllowedError";
    throw e;
  }) as typeof navigator.mediaDevices.getUserMedia;
}

/** A getUserMedia that rejects with "no camera" (NotFoundError). */
function noCameraGum(): typeof navigator.mediaDevices.getUserMedia {
  return (async () => {
    const e = new Error("Requested device not found");
    e.name = "NotFoundError";
    throw e;
  }) as typeof navigator.mediaDevices.getUserMedia;
}

function makeFile(name = "card.jpg"): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/jpeg" });
}

beforeEach(() => {
  // Stub canvas capture primitives jsdom lacks.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as any);
  Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
    configurable: true,
    value(cb: (b: Blob | null) => void) {
      cb(new Blob(["img"], { type: "image/jpeg" }));
    },
  });
  // jsdom has no createObjectURL/revokeObjectURL by default in this setup.
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:mock"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CardScanner", () => {
  it("renders the Scan card entry point and opens the panel", async () => {
    render(<CardScanner onCapture={() => {}} getUserMedia={cameraGum()} />);
    expect(screen.getByRole("button", { name: /scan card/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /scan card/i }));
    await waitFor(() => expect(screen.getByTestId("card-scanner-panel")).toBeTruthy());
  });

  it("shows the live camera viewfinder with a capture button when a camera is available", async () => {
    render(<CardScanner onCapture={() => {}} getUserMedia={cameraGum()} />);
    fireEvent.click(screen.getByRole("button", { name: /scan card/i }));
    await waitFor(() => expect(screen.getByTestId("card-scanner-video")).toBeTruthy());
    expect(screen.getByTestId("card-scanner-capture")).toBeTruthy();
  });

  it("falls back to upload with a clear message when there is no camera", async () => {
    render(<CardScanner onCapture={() => {}} getUserMedia={noCameraGum()} />);
    fireEvent.click(screen.getByRole("button", { name: /scan card/i }));
    await waitFor(() => expect(screen.getByTestId("card-scanner-file-input")).toBeTruthy());
    expect(screen.getByText(/no camera detected/i)).toBeTruthy();
    expect(screen.queryByTestId("card-scanner-video")).toBeNull();
  });

  it("shows a permission-denied message and file-upload fallback when denied", async () => {
    render(<CardScanner onCapture={() => {}} getUserMedia={deniedGum()} />);
    fireEvent.click(screen.getByRole("button", { name: /scan card/i }));
    await waitFor(() => expect(screen.getByTestId("card-scanner-file-input")).toBeTruthy());
    expect(screen.getByText(/camera permission was denied/i)).toBeTruthy();
    // The file-upload fallback is still available.
    expect(screen.getByTestId("card-scanner-upload-label")).toBeTruthy();
  });

  it("selecting a file shows a preview with Retake and Use photo", async () => {
    render(<CardScanner onCapture={() => {}} getUserMedia={noCameraGum()} />);
    fireEvent.click(screen.getByRole("button", { name: /scan card/i }));
    await waitFor(() => expect(screen.getByTestId("card-scanner-file-input")).toBeTruthy());

    fireEvent.change(screen.getByTestId("card-scanner-file-input"), {
      target: { files: [makeFile()] },
    });

    await waitFor(() => expect(screen.getByTestId("card-scanner-preview")).toBeTruthy());
    expect(screen.getByTestId("card-scanner-retake")).toBeTruthy();
    expect(screen.getByTestId("card-scanner-use")).toBeTruthy();
  });

  it("handles the chosen file to onCapture on Use photo", async () => {
    const onCapture = vi.fn();
    render(<CardScanner onCapture={onCapture} getUserMedia={noCameraGum()} />);
    fireEvent.click(screen.getByRole("button", { name: /scan card/i }));
    await waitFor(() => expect(screen.getByTestId("card-scanner-file-input")).toBeTruthy());

    const file = makeFile("my-card.png");
    fireEvent.change(screen.getByTestId("card-scanner-file-input"), {
      target: { files: [file] },
    });
    await waitFor(() => expect(screen.getByTestId("card-scanner-use")).toBeTruthy());
    fireEvent.click(screen.getByTestId("card-scanner-use"));

    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture.mock.calls[0][0]).toBe(file);
  });

  it("captures the camera frame and hands it to onCapture", async () => {
    const onCapture = vi.fn();
    render(<CardScanner onCapture={onCapture} getUserMedia={cameraGum()} />);
    fireEvent.click(screen.getByRole("button", { name: /scan card/i }));
    await waitFor(() => expect(screen.getByTestId("card-scanner-capture")).toBeTruthy());

    fireEvent.click(screen.getByTestId("card-scanner-capture"));
    await waitFor(() => expect(screen.getByTestId("card-scanner-use")).toBeTruthy());

    fireEvent.click(screen.getByTestId("card-scanner-use"));
    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture.mock.calls[0][0]).toBeInstanceOf(File);
    expect(onCapture.mock.calls[0][0].name).toBe("scan.jpg");
  });

  it("Retake clears the preview and returns to the acquisition view", async () => {
    render(<CardScanner onCapture={() => {}} getUserMedia={cameraGum()} />);
    fireEvent.click(screen.getByRole("button", { name: /scan card/i }));
    await waitFor(() => expect(screen.getByTestId("card-scanner-capture")).toBeTruthy());
    fireEvent.click(screen.getByTestId("card-scanner-capture"));
    await waitFor(() => expect(screen.getByTestId("card-scanner-retake")).toBeTruthy());

    fireEvent.click(screen.getByTestId("card-scanner-retake"));
    await waitFor(() => expect(screen.getByTestId("card-scanner-capture")).toBeTruthy());
    expect(screen.queryByTestId("card-scanner-preview")).toBeNull();
  });

  it("does not upload or call the network during capture", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const onCapture = vi.fn();
    render(<CardScanner onCapture={onCapture} getUserMedia={cameraGum()} />);
    fireEvent.click(screen.getByRole("button", { name: /scan card/i }));
    await waitFor(() => expect(screen.getByTestId("card-scanner-capture")).toBeTruthy());
    fireEvent.click(screen.getByTestId("card-scanner-capture"));
    await waitFor(() => expect(screen.getByTestId("card-scanner-use")).toBeTruthy());
    fireEvent.click(screen.getByTestId("card-scanner-use"));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onCapture).toHaveBeenCalledTimes(1);
  });
});
