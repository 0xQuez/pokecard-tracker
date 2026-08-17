"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { ValuationResultView } from "./ValuationParts";
import {
  regenerateShareToken,
  type CardIdentityJson,
  type ConditionCurveJson,
  type PricePointJson,
  type RegenerateShareOutcome,
  type SupabaseClientLike,
  type ValuationRequestRow,
  type ValuationResultRow,
  type ValuationStatus,
} from "@/lib/valuation-ui";

export interface ValuationResultCardProps {
  /** The `valuation_requests.id` of the request to display. */
  valuationId: number;
  /** Optional card artwork to show in the identity header. */
  imageUrl?: string | null;
  /** Injectable for tests; defaults to the shared supabase client. */
  client?: SupabaseClientLike;
  /** Called when the user hits "Re-run". */
  onReRun?: () => void;
  /** Injectable token rotation (tests). Defaults to the real server route call. */
  regenerateShare?: (resultId: number) => Promise<RegenerateShareOutcome>;
  /**
   * Fallback poll interval while the request is in-flight (pending/claimed/
   * running). Realtime is the fast path; this poll is the safety net for guest
   * anon clients where the UPDATE broadcast can be dropped. Stops once the
   * request reaches a terminal state (done/failed/blocked) or on unmount.
   */
  pollIntervalMs?: number;
}

interface Loaded {
  request: ValuationRequestRow | null;
  result: ValuationResultRow | null;
  error: string | null;
}

/**
 * Displays a valuation request + its result, and live-updates when the agent
 * finishes. Subscribes to postgres_changes on the request row; when the status
 * transitions to 'done' it fetches and renders the written result.
 */
export default function ValuationResultCard({
  valuationId,
  imageUrl,
  client = supabase,
  onReRun,
  regenerateShare,
  pollIntervalMs = 12000,
}: ValuationResultCardProps) {
  const [state, setState] = useState<Loaded>({
    request: null,
    result: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const isTerminal = (status: ValuationStatus | null): boolean =>
      status === "done" || status === "failed" || status === "blocked";

    const stopPolling = () => {
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const fetchResult = async () => {
      const { data, error } = await client
        .from("valuation_results")
        .select("*")
        .eq("request_id", valuationId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setState((s) => ({ ...s, error: error.message }));
        return;
      }
      setState((s) => ({ ...s, result: (data as ValuationResultRow) ?? null }));
    };

    const fetchRequest = async () => {
      const { data, error } = await client
        .from("valuation_requests")
        .select("*")
        .eq("id", valuationId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setState((s) => ({ ...s, error: error.message }));
        stopPolling();
        return;
      }
      if (data) {
        const row = data as ValuationRequestRow;
        setState((s) => ({ ...s, request: row }));
        if (row.status === "done") {
          await fetchResult();
        }
        if (isTerminal(row.status)) {
          stopPolling();
        }
      }
    };

    fetchRequest();

    // Fallback poll: while the request is still in-flight, re-read it every
    // pollIntervalMs. Realtime is the fast path, but guest/anon clients can miss
    // the UPDATE broadcast (RLS / publication quirks); polling guarantees the
    // result appears without a user refresh. The poll stops once the request
    // reaches a terminal state or on unmount.
    const startPolling = () => {
      if (pollTimer !== null) return;
      pollTimer = setInterval(() => {
        fetchRequest();
      }, pollIntervalMs);
    };
    startPolling();

    // Realtime: live-update on request-row changes (pending → claimed → running →
    // done). When the row flips to 'done' we pull the result that was written.
    const channel = client
      .channel(`valuation-result-${valuationId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "valuation_requests",
          filter: `id=eq.${valuationId}`,
        },
        (payload: { new: ValuationRequestRow }) => {
          const row = payload.new;
          setState((s) => ({ ...s, request: row }));
          if (row.status === "done") {
            fetchResult();
            stopPolling();
          } else if (isTerminal(row.status)) {
            stopPolling();
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      stopPolling();
      client.removeChannel(channel);
    };
  }, [valuationId, client, pollIntervalMs]);

  if (state.error) {
    return (
      <div
        data-testid="valuation-error"
        style={{
          border: "1px solid var(--clay)",
          borderRadius: 12,
          padding: 16,
          color: "var(--clay)",
          fontSize: 13,
        }}
      >
        Couldn&apos;t load valuation: {state.error}
      </div>
    );
  }

  if (!state.request) {
    return (
      <div
        data-testid="valuation-loading"
        style={{ color: "var(--text-mid)", fontSize: 13, padding: "8px 0" }}
      >
        Loading valuation…
      </div>
    );
  }

  const identity = (state.result?.card_identity as CardIdentityJson | null) ?? null;
  const curve = (state.result?.condition_curve as ConditionCurveJson | null) ?? null;
  const points = (state.result?.price_points as PricePointJson[] | null) ?? null;

  const handleRegenerate = async (): Promise<RegenerateShareOutcome> => {
    if (!state.result) {
      return { kind: "error", message: "No valuation result yet." };
    }
    const out = await (regenerateShare ?? ((id: number) => regenerateShareToken(id)))(state.result.id);
    if (out.kind === "ok") {
      setState((s) =>
        s.result ? { ...s, result: { ...s.result, share_token: out.shareToken } } : s
      );
    }
    return out;
  };

  return (
    <ValuationResultView
      status={state.request.status as ValuationStatus}
      error={state.request.error}
      identity={identity}
      curve={curve}
      points={points}
      imageUrl={imageUrl}
      lastUpdated={state.result?.created_at ?? state.request.completed_at}
      onReRun={onReRun}
      shareToken={state.result?.share_token ?? null}
      onRegenerate={handleRegenerate}
    />
  );
}
