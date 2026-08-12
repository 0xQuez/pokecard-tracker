"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import {
  queueValuation,
  type QueueOutcome,
  type SupabaseClientLike,
  type ValuationRequestRow,
} from "@/lib/valuation-ui";

export interface ValuationRequestButtonProps {
  /** Optional link to an owned card (cards.id). */
  cardId?: number | null;
  /** The raw search string the user typed (e.g. "Dragonite ex 4/102"). Required. */
  cardQuery: string;
  /** Optional app-level profile label (e.g. "Quez"). */
  userId?: string | null;
  /** Injectable for tests; defaults to the shared supabase client. */
  client?: SupabaseClientLike;
  /**
   * Called after a request is queued or a recent result is shown, so a parent
   * can mount a `<ValuationResultCard valuationId={...} />`.
   */
  onValuation?: (outcome: QueueOutcome) => void;
  /** Optional label override. */
  label?: string;
}

type ButtonState = "idle" | "busy" | "queued" | "error";

/**
 * "Get Valuation" trigger for the HunterTool search UI. One click inserts a
 * `valuation_requests` row (status='pending') via the Supabase client, or shows
 * an existing recent (≤24h) valuation for the same card instead of duplicating.
 */
export default function ValuationRequestButton({
  cardId,
  cardQuery,
  userId,
  client = supabase,
  onValuation,
  label = "Get Valuation",
}: ValuationRequestButtonProps) {
  const [state, setState] = useState<ButtonState>("idle");
  const [feedback, setFeedback] = useState<string>("");

  const disabled = state === "busy" || !cardQuery || cardQuery.trim().length < 2;

  const handleClick = async () => {
    if (disabled) return;
    setState("busy");
    setFeedback("");
    try {
      const outcome: QueueOutcome = await queueValuation(client, {
        cardId: cardId ?? null,
        cardQuery,
        userId: userId ?? null,
      });
      if (outcome.kind === "error") {
        setState("error");
        setFeedback(outcome.message);
        return;
      }
      setState("queued");
      setFeedback(outcome.message);
      onValuation?.(outcome);
    } catch (e) {
      setState("error");
      setFeedback(e instanceof Error ? e.message : "Failed to queue valuation.");
    }
  };

  const busyLabel = state === "queued" ? "✓ Queued" : "Queuing…";

  return (
    <div data-testid="valuation-request-button">
      <button
        className="cta"
        onClick={handleClick}
        disabled={disabled}
        data-state={state}
        style={{ width: "100%", margin: "8px 0 0" }}
      >
        {state === "busy" ? busyLabel : state === "queued" ? "✓ Valuation queued" : label}
      </button>
      {feedback && (
        <div
          data-testid="valuation-feedback"
          data-kind={state}
          style={{
            marginTop: 6,
            fontSize: 12,
            color: state === "error" ? "var(--clay)" : "var(--sage)",
          }}
        >
          {feedback}
        </div>
      )}
    </div>
  );
}

export type { ValuationRequestRow };
