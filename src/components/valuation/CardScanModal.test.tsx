// Component tests for <CardScanModal> (T19). Runs under vitest (jsdom).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

// The modal imports { supabase } from supabaseClient as its default client;
// mock it so the real (env-dependent) client is never constructed in tests.
// The modal under test is always given an explicit `client` prop.
vi.mock("@/lib/supabaseClient", () => ({
  supabase: { __mock: true },
}));

import CardScanModal from "./CardScanModal";
import type { CardImageClient } from "@/lib/card-scan";

function makeStorageClient(opts: { error?: boolean; log?: string[] } = {}): CardImageClient {
  const { error = false, log = [] } = opts;
  return {
    storage: {
      from(bucket: string) {
        log.push(`from:${bucket}`);
        return {
          upload(path: string) {
            log.push(`upload:${path}`);
            return Promise.resolve(
              error
                ? { data: null, error: { message: "upload failed" } }
                : { data: { path }, error: null }
            );
          },
        };
      },
    },
  } as unknown as CardImageClient;
}

/** A getUserMedia that resolves a fake, stoppable stream. */
function cameraGum(): typeof navigator.mediaDevices.getUserMedia {
  return (async () => ({ getTracks: () => [{ stop: vi.fn() }] }) as unknown as MediaStream) as typeof navigator.mediaDevices.getUserMedia;
}

function uploadGum(): typeof navigator.mediaDevices.getUserMedia {
  return (async () => {
    throw new Error("no camera");
  }) as typeof navigator.mediaDevices.getUserMedia;
}

function makeFile(name = "scan.jpg"): File {
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
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CardScanModal", () => {
  it("renders the capture view when a camera is available", async () => {
    const log: string[] = [];
    render(
      <CardScanModal
        onClose={() => {}}
        onCaptured={() => {}}
        getUserMedia={cameraGum()}
        client={makeStorageClient({ log })}
      />
    );
    await waitFor(() => expect(screen.getByTestId("scan-capture")).toBeTruthy());
    expect(screen.getByTestId("scan-video")).toBeTruthy();
  });

  it("falls back to upload-only when the camera is unavailable", async () => {
    render(
      <CardScanModal
        onClose={() => {}}
        onCaptured={() => {}}
        getUserMedia={uploadGum()}
        client={makeStorageClient()}
      />
    );
    await waitFor(() => expect(screen.getByTestId("scan-file-input")).toBeTruthy());
    expect(screen.queryByTestId("scan-capture")).toBeNull();
    expect(screen.getByText(/no camera detected/i)).toBeTruthy();
  });

  it("uploads a chosen file and returns its public URL", async () => {
    const log: string[] = [];
    const onCaptured = vi.fn();
    render(
      <CardScanModal
        onClose={() => {}}
        onCaptured={onCaptured}
        getUserMedia={uploadGum()}
        client={makeStorageClient({ log })}
      />
    );
    await waitFor(() => expect(screen.getByTestId("scan-file-input")).toBeTruthy());

    fireEvent.change(screen.getByTestId("scan-file-input"), {
      target: { files: [makeFile()] },
    });

    await waitFor(() => expect(log.some((l) => l.startsWith("upload:scan-"))).toBe(true));
    expect(screen.getByTestId("scan-preview")).toBeTruthy();
    // Preview + URL display + "Use this card" confirm step.
    expect(screen.getByTestId("scan-result")).toBeTruthy();

    fireEvent.click(screen.getByTestId("scan-use-card"));
    expect(onCaptured).toHaveBeenCalledTimes(1);
    expect(onCaptured.mock.calls[0][0]).toMatch(/\/card-images\//);
  });

  it("surfaces an upload error without calling onCaptured", async () => {
    const log: string[] = [];
    const onCaptured = vi.fn();
    render(
      <CardScanModal
        onClose={() => {}}
        onCaptured={onCaptured}
        getUserMedia={uploadGum()}
        client={makeStorageClient({ error: true, log })}
      />
    );
    await waitFor(() => expect(screen.getByTestId("scan-file-input")).toBeTruthy());

    fireEvent.change(screen.getByTestId("scan-file-input"), {
      target: { files: [makeFile()] },
    });

    expect(await screen.findByTestId("scan-error")).toBeTruthy();
    expect(screen.getByTestId("scan-error").textContent).toMatch(/upload failed/);
    expect(onCaptured).not.toHaveBeenCalled();
  });

  it("captures the camera frame and uploads it", async () => {
    const log: string[] = [];
    const onCaptured = vi.fn();
    render(
      <CardScanModal
        onClose={() => {}}
        onCaptured={onCaptured}
        getUserMedia={cameraGum()}
        client={makeStorageClient({ log })}
      />
    );
    await waitFor(() => expect(screen.getByTestId("scan-capture")).toBeTruthy());

    fireEvent.click(screen.getByTestId("scan-capture"));

    await waitFor(() => expect(log.some((l) => l.startsWith("upload:scan-"))).toBe(true));
    expect(screen.getByTestId("scan-preview")).toBeTruthy();

    fireEvent.click(screen.getByTestId("scan-use-card"));
    expect(onCaptured).toHaveBeenCalledTimes(1);
  });

  it("closes without a capture when the close button is pressed", async () => {
    const onClose = vi.fn();
    render(
      <CardScanModal onClose={onClose} onCaptured={() => {}} getUserMedia={uploadGum()} client={makeStorageClient()} />
    );
    // Let the async camera-availability effect settle before interacting.
    await waitFor(() => expect(screen.getByTestId("scan-file-input")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
