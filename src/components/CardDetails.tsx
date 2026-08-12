"use client";

import { useState } from "react";
import { CARD_CONDITIONS, GRADING_OPTIONS, publicCardImageUrl } from "@/lib/helpers";

export type CardDetailsValue = {
  condition: string;
  card_grade: string;
  cert_number: string;
  purchased_date: string;
};

type Props = {
  value: CardDetailsValue;
  onChange: (next: CardDetailsValue) => void;
  /** Existing stored image path or public URL (e.g. when editing). */
  existingImage?: string;
  /** Newly selected image file, owned by the parent so it can upload on submit. */
  imageFile: File | null;
  onImageFileChange: (f: File | null) => void;
  /** True when the user removed the existing image (edit mode). */
  imageCleared: boolean;
  onClearImage: () => void;
  /** Whether the section starts expanded (e.g. when editing a card that has details). */
  defaultOpen?: boolean;
};

export default function CardDetails({
  value,
  onChange,
  existingImage,
  imageFile,
  onImageFileChange,
  imageCleared,
  onClearImage,
  defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  // Prefer a freshly selected file; otherwise fall back to the stored image
  // unless the user asked to remove it.
  const hasPreview = Boolean(imageFile) || (!imageCleared && Boolean(existingImage));
  const preview = imageFile
    ? URL.createObjectURL(imageFile)
    : !imageCleared && existingImage
      ? publicCardImageUrl(existingImage)
      : "";

  const patch = (next: Partial<CardDetailsValue>) => onChange({ ...value, ...next });

  return (
    <div className="card-details">
      <button
        type="button"
        className={`card-details-toggle ${open ? "open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span>Card details <em>(optional)</em></span>
        <span className="chev">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="card-details-body">
          <div className="field">
            <label htmlFor="card-condition">Condition (raw)</label>
            <select
              id="card-condition"
              className="text-input select-input"
              value={value.condition}
              onChange={(e) => patch({ condition: e.target.value })}
            >
              <option value="">— none —</option>
              {CARD_CONDITIONS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="card-image">Card image</label>
            <input
              id="card-image"
              type="file"
              accept="image/*"
              className="file-input"
              onChange={(e) => {
                onImageFileChange(e.target.files?.[0] || null);
              }}
            />
            {hasPreview && (
              <div className="image-preview-row">
                {preview && <img className="image-preview" src={preview} alt="Card preview" />}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    onImageFileChange(null);
                    onClearImage();
                  }}
                >
                  Remove image
                </button>
              </div>
            )}
          </div>

          <div className="field">
            <label htmlFor="card-grade">Grade (slab)</label>
            <input
              id="card-grade"
              className="text-input"
              type="text"
              list="grading-options"
              placeholder="e.g. PSA 8"
              value={value.card_grade}
              onChange={(e) => patch({ card_grade: e.target.value })}
            />
            <datalist id="grading-options">
              {GRADING_OPTIONS.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </div>

          <div className="field">
            <label htmlFor="card-cert">Certification number</label>
            <input
              id="card-cert"
              className="text-input"
              type="text"
              inputMode="numeric"
              placeholder="Slab cert number"
              value={value.cert_number}
              onChange={(e) => patch({ cert_number: e.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="card-purchased">Date purchased</label>
            <input
              id="card-purchased"
              className="text-input"
              type="date"
              value={value.purchased_date}
              onChange={(e) => patch({ purchased_date: e.target.value })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
