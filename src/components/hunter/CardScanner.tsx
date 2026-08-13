"use client";

// "Scan card" capture component for the HunterTool flow (T22.1).
// Pure capture + preview — NO upload, NO API calls. Hands the chosen image
// back to the parent as a File/Blob via `onCapture`.
//
// Two acquisition paths, auto-selected on open:
//   - camera: live getUserMedia viewfinder + capture button (mobile / devices
//     with a camera). Permission-denied and no-camera both fall back to upload
//     with a clear message.
//   - upload: hidden file input (accept="image/*") — desktop / any device
//     without camera access.
// After a capture or file selection a preview is shown with Retake / Use photo.
import { useCallback, useEffect, useRef, useState } from "react";
import { canvasToFile } from "@/lib/card-scan";

export interface CardScannerProps {
  /** Called once with the captured/selected image as a File. */
  onCapture: (file: File) => void;
  /** Injectable getUserMedia for tests; defaults to navigator.mediaDevices. */
  getUserMedia?: typeof navigator.mediaDevices.getUserMedia;
  /** Label for the entry button. Defaults to "📷 Scan card". */
  buttonLabel?: string;
}

type Phase = "idle" | "starting" | "camera" | "fallback" | "preview";

function isPermissionError(err: unknown): boolean {
  const e = err as { name?: string; message?: string };
  if (/NotAllowed|Permission|SecurityError/i.test(e?.name || "")) return true;
  return (e?.message || "").toLowerCase().includes("permission");
}

export default function CardScanner({
  onCapture,
  getUserMedia,
  buttonLabel = "📷 Scan card",
}: CardScannerProps) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState("");
  const [captured, setCaptured] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stopStream = useCallback((s: MediaStream | null) => {
    s?.getTracks().forEach((t) => t.stop());
  }, []);

  const startCamera = useCallback(async () => {
    setPhase("starting");
    setError("");
    const gum =
      getUserMedia ??
      navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (!gum) {
      setPhase("fallback");
      setError("No camera detected — upload a photo instead.");
      return;
    }
    try {
      const s = await gum({ video: { facingMode: "environment" } });
      setStream(s);
      setPhase("camera");
    } catch (err) {
      setError(
        isPermissionError(err)
          ? "Camera permission was denied. Upload a photo instead."
          : "No camera detected — upload a photo instead."
      );
      setPhase("fallback");
    }
  }, [getUserMedia]);

  // Kick off camera detection the first time the panel opens.
  useEffect(() => {
    if (open && phase === "idle") void startCamera();
  }, [open, phase, startCamera]);

  // Attach the live stream to the <video> once both are present.
  useEffect(() => {
    if (phase === "camera" && stream && videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [phase, stream]);

  // Stop camera tracks on unmount.
  useEffect(() => {
    return () => stopStream(stream);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep previewUrl in sync with the captured file (revoke the old one).
  useEffect(() => {
    if (!captured) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(captured);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [captured]);

  const openPanel = useCallback(() => {
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    stopStream(stream);
    setStream(null);
    setCaptured(null);
    setError("");
    setPhase("idle");
    setOpen(false);
  }, [stopStream, stream]);

  const capture = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError(
        "Camera capture isn't available on this device. Upload a photo instead."
      );
      setPhase("fallback");
      return;
    }
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const file = await canvasToFile(canvas);
    if (!file) {
      setError("Couldn't encode the captured image. Try uploading a photo instead.");
      setPhase("fallback");
      return;
    }
    setCaptured(file);
    setPhase("preview");
  }, []);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCaptured(file);
      setPhase("preview");
      setError("");
    }
    e.target.value = "";
  }, []);

  const retake = useCallback(() => {
    if (stream) {
      stopStream(stream);
      setStream(null);
      void startCamera();
    } else {
      setError("");
      setPhase("fallback");
    }
  }, [startCamera, stopStream, stream]);

  const usePhoto = useCallback(() => {
    if (captured) onCapture(captured);
    close();
  }, [captured, close, onCapture]);

  const btnStyle: React.CSSProperties = {
    whiteSpace: "nowrap",
    width: "auto",
    padding: "0 16px",
  };

  return (
    <div data-testid="card-scanner">
      {!open && (
        <button
          className="cta"
          onClick={openPanel}
          data-testid="card-scanner-open"
          title="Point your camera at a card (or upload a photo) to identify it"
          style={btnStyle}
        >
          {buttonLabel}
        </button>
      )}

      {open && (
        <div className="card" data-testid="card-scanner-panel" style={{ marginTop: 12, padding: 16 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>
              📷 Scan a card
            </div>
            <button
              onClick={close}
              aria-label="Close"
              style={{
                background: "none",
                border: "none",
                fontSize: 18,
                cursor: "pointer",
                color: "var(--text-mid)",
              }}
            >
              ✕
            </button>
          </div>

          {phase === "starting" && (
            <p style={{ fontSize: 13, color: "var(--text-mid)" }}>Starting camera…</p>
          )}

          {phase === "camera" && (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                data-testid="card-scanner-video"
                style={{
                  width: "100%",
                  borderRadius: 8,
                  background: "#000",
                  aspectRatio: "3/4",
                  objectFit: "cover",
                }}
              />
              <button
                className="cta"
                onClick={capture}
                data-testid="card-scanner-capture"
                style={{ width: "100%", margin: "12px 0 4px" }}
              >
                Capture
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  width: "100%",
                  padding: "10px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  cursor: "pointer",
                  color: "var(--text-mid)",
                  fontSize: 13,
                  marginTop: 8,
                }}
              >
                Upload a photo instead
              </button>
            </>
          )}

          {phase === "fallback" && (
            <>
              <p style={{ fontSize: 13, color: "var(--text-mid)", margin: "0 0 12px" }}>
                {error || "No camera detected — upload a photo instead."}
              </p>
              <label
                className="cta"
                data-testid="card-scanner-upload-label"
                style={{ display: "block", width: "100%", textAlign: "center", cursor: "pointer" }}
              >
                Choose a photo
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={onFileChange}
                  data-testid="card-scanner-file-input"
                  style={{ display: "none" }}
                />
              </label>
              <button
                onClick={() => void startCamera()}
                style={{
                  width: "100%",
                  padding: "10px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  cursor: "pointer",
                  color: "var(--text-mid)",
                  fontSize: 13,
                  marginTop: 8,
                }}
              >
                Try camera again
              </button>
            </>
          )}

          <canvas ref={canvasRef} style={{ display: "none" }} />

          {phase === "preview" && (
            <>
              <div style={{ fontSize: 12, color: "var(--text-mid)", marginBottom: 6 }}>
                Preview
              </div>
              {previewUrl && (
                <img
                  src={previewUrl}
                  alt="Captured card preview"
                  data-testid="card-scanner-preview"
                  style={{
                    width: "100%",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    display: "block",
                  }}
                />
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button
                  onClick={retake}
                  data-testid="card-scanner-retake"
                  style={{
                    flex: 1,
                    padding: "12px 0",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "transparent",
                    cursor: "pointer",
                    color: "var(--text-mid)",
                    fontSize: 14,
                    fontWeight: 600,
                  }}
                >
                  Retake
                </button>
                <button
                  className="cta"
                  onClick={usePhoto}
                  data-testid="card-scanner-use"
                  style={{ flex: 1 }}
                >
                  Use photo →
                </button>
              </div>
            </>
          )}

          {error && phase !== "fallback" && (
            <div
              data-testid="card-scanner-error"
              style={{
                marginTop: 12,
                padding: "8px 10px",
                borderRadius: 6,
                background: "rgba(214,162,133,0.08)",
                color: "var(--clay)",
                border: "1px solid var(--clay)",
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
