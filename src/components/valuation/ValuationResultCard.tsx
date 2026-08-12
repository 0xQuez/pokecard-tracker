"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { ValuationResultView } from "./ValuationParts";
import type {
  CardIdentityJson,
  ConditionCurveJson,
  PricePointJson,
  SupabaseClientLike,
  ValuationRequestRow,
  ValuationResultRow,
  ValuationStatus,
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
}: ValuationResultCardProps) {
  const [state, setState] = useState<Loaded>({
    request: null,
    result: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    const fetchRequest = async () => {
      const { data, error } = await client
        .from("valuation_requests")
        .select("*")
        .eq("id", valuationId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setState((s) => ({ ...s, error: error.message }));
        return;
      }
      if (data) {
        setState((s) => ({ ...s, request: data as ValuationRequestRow }));
        if ((data as ValuationRequestRow).status === "done") {
          await fetchResult();
        }
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

    fetchRequest();

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
          if (row.status === "done") fetchResult();
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      client.removeChannel(channel);
    };
  }, [valuationId, client]);

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
    />
  );
}
