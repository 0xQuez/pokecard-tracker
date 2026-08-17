"use client";

// "Scan card" capture modal for the HunterTool search view (T19).
// Two modes, auto-selected on open:
//   - camera: in-app capture via getUserMedia (mobile / devices with a camera)
//   - upload: file picker (accept="image/*") fallback (desktop without camera)
// Captures are uploaded to the public `card-images` Supabase bucket and the
// resulting public URL is handed to the parent via `onCaptured`.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import {
  canvasToFile,
  uploadCardScan,
  type CardImageClient,
} from "@/lib/card-scan";

export interface CardScanModalProps {
  /** Close the modal without a capture. */
  onClose: () => void;
  /** Called with the uploaded image's public URL once a scan is ready. */
  onCaptured: (url: string) => void;
  /** Injectable storage client; defaults to the shared supabase client. */
  client?: CardImageClient;
  /** Injectable getUserMedia for tests; defaults to navigator.mediaDevices. */
  getUserMedia?: typeof navigator.mediaDevices.getUserMedia;
}

type Mode = "starting" | "camera" | "upload";

export default function CardScanModal({
  onClose,
  onCaptured,
  client = supabase as unknown as CardImageClient,
  getUserMedia,
}: CardScanModalProps) {
  const [mode, setMode] = useState<Mode>("starting");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Resolve camera availability once on open; fall back to upload-only.
  useEffect(() => {
    let cancelled = false;
    const gum =
      getUserMedia ?? navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);

    (async () => {
      if (!gum) {
        if (!cancelled) setMode("upload");
        return;
      }
      try {
        const s = await gum({ video: true });
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        setStream(s);
        setMode("camera");
      } catch {
        if (!cancelled) setMode("upload");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getUserMedia]);

  // Attach the live stream to the <video> once both are present.
  useEffect(() => {
    if (mode === "camera" && stream && videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [mode, stream]);

  // Stop camera tracks when the modal closes.
  useEffect(() => {
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [stream]);

  const handleUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      setError("");
      setPreview(URL.createObjectURL(file));
      const res = await uploadCardScan(client, file);
      if (res.ok) {
        setResultUrl(res.url);
      } else {
        setError(res.error);
      }
      setUploading(false);
    },
    [client]
  );

  const capture = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError("Camera capture isn't available on this device. Upload a photo instead.");
      return;
    }
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const file = await canvasToFile(canvas);
    if (!file) {
      setError("Couldn't encode the captured image. Try uploading a photo instead.");
      return;
    }
    await handleUpload(file);
  }, [handleUpload]);

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleUpload(file);
      e.target.value = "";
    },
    [handleUpload]
  );

  const close = useCallback(() => {
    onClose();
  }, [onClose]);

  const overlayStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 100,
    background: "rgba(20,18,16,0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  };

  const modalStyle: React.CSSProperties = {
    background: "var(--paper)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: 20,
    width: "100%",
    maxWidth: 420,
    maxHeight: "90vh",
    overflowY: "auto",
  };

  return (
    <div data-testid="card-scan-modal" style={overlayStyle} onClick={(e) => e.target === e.currentTarget && close()}>
      <div style={modalStyle} role="dialog" aria-modal="true" aria-label="Scan a card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>📷 Scan a card</div>
          <button
            onClick={close}
            aria-label="Close"
            style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--text-mid)" }}
          >
            ✕
          </button>
        </div>

        {mode === "starting" && (
          <p style={{ fontSize: 13, color: "var(--text-mid)" }}>Starting camera…</p>
        )}

        {mode === "camera" && (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              data-testid="scan-video"
              style={{ width: "100%", borderRadius: 8, background: "#000", aspectRatio: "3/4", objectFit: "cover" }}
            />
            <button
              className="cta"
              onClick={capture}
              disabled={uploading}
              data-testid="scan-capture"
              style={{ width: "100%", margin: "12px 0 4px" }}
            >
              {uploading ? "Uploading…" : "Capture"}
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              style={{ width: "100%", padding: "10px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", cursor: "pointer", color: "var(--text-mid)", fontSize: 13 }}
            >
              Upload a photo instead
            </button>
          </>
        )}

        {mode === "upload" && (
          <>
            <p style={{ fontSize: 13, color: "var(--text-mid)", margin: "0 0 12px" }}>
              No camera detected. Upload a photo of the card instead.
            </p>
            <label
              className="cta"
              data-testid="scan-upload-label"
              style={{
                display: "block",
                width: "100%",
                textAlign: "center",
                cursor: uploading ? "default" : "pointer",
                opacity: uploading ? 0.6 : 1,
              }}
            >
              {uploading ? "Uploading…" : "Choose a photo"}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={onFileChange}
                disabled={uploading}
                data-testid="scan-file-input"
                style={{ display: "none" }}
              />
            </label>
          </>
        )}

        <canvas ref={canvasRef} style={{ display: "none" }} />

        {preview && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, color: "var(--text-mid)", marginBottom: 6 }}>Preview</div>
            <img
              src={preview}
              alt="Captured card preview"
              data-testid="scan-preview"
              style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border)" }}
            />
          </div>
        )}

        {resultUrl && (
          <div data-testid="scan-result" style={{ marginTop: 14, padding: "10px 12px", borderRadius: 8, background: "rgba(73,184,113,0.08)", border: "1px solid var(--sage)" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--sage)", marginBottom: 4 }}>✓ Card uploaded</div>
            <div style={{ fontSize: 11, color: "var(--text-mid)", wordBreak: "break-all", marginBottom: 10 }}>{resultUrl}</div>
            <button
              className="cta"
              onClick={() => onCaptured(resultUrl)}
              data-testid="scan-use-card"
              style={{ width: "100%" }}
            >
              Use this card →
            </button>
          </div>
        )}

        {error && (
          <div
            data-testid="scan-error"
            style={{ marginTop: 12, padding: "8px 10px", borderRadius: 6, background: "rgba(221,96,76,0.08)", color: "var(--clay)", border: "1px solid var(--clay)", fontSize: 13 }}
          >
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
