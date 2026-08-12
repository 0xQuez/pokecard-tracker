"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import {
  fetchSharedValuation,
  type CardIdentityJson,
  type ConditionCurveJson,
  type PricePointJson,
  type SupabaseClientLike,
  type ValuationResultRow,
} from "@/lib/valuation-ui";
import { VendorValuationView } from "./ValuationParts";

export interface ValuationSharePageProps {
  /** The unguessable share token from the URL path. */
  token: string;
  /** Injectable for tests; defaults to the shared supabase client. */
  client?: SupabaseClientLike;
}

/**
 * Public, read-only share page shown to a vendor. Fetches exactly ONE valuation
 * via the token-gated RPC (get_valuation_by_share_token) and renders a minimal,
 * chrome-free layout. No other user data is reachable — an invalid/revoked token
 * renders a plain "link no longer valid" state.
 */
export default function ValuationSharePage({ token, client = supabase }: ValuationSharePageProps) {
  const [result, setResult] = useState<ValuationResultRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSharedValuation(client, token).then(({ result, error }) => {
      if (cancelled) return;
      setResult(result);
      setError(error);
    });
    return () => {
      cancelled = true;
    };
  }, [client, token]);

  if (error) {
    return (
      <div
        data-testid="share-invalid"
        style={{
          maxWidth: 480,
          margin: "0 auto",
          padding: "72px 24px",
          textAlign: "center",
          background: "var(--bg-0)",
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)", marginBottom: 8 }}>
          This valuation link is no longer valid
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-mid)", lineHeight: 1.5 }}>
          {error} Ask the owner to re-share it.
        </p>
      </div>
    );
  }

  if (!result) {
    return (
      <div
        data-testid="share-loading"
        style={{ maxWidth: 480, margin: "0 auto", padding: "72px 24px", textAlign: "center", color: "var(--text-mid)", fontSize: 14, background: "var(--bg-0)" }}
      >
        Loading valuation…
      </div>
    );
  }

  return (
    <VendorValuationView
      identity={result.card_identity as CardIdentityJson | null}
      curve={result.condition_curve as ConditionCurveJson | null}
      points={result.price_points as PricePointJson[] | null}
      lastUpdated={result.created_at}
    />
  );
}
