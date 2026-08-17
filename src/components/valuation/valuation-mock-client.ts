// Test-only mock supabase-js client + realtime harness for the valuation
// component tests. Not matched by the vitest include glob (doesn't end in .test).
/* eslint-disable @typescript-eslint/no-unused-vars */

import type {
  SupabaseClientLike,
  ValuationRequestRow,
  ValuationResultRow,
} from "@/lib/valuation-ui";

export interface RealtimeCapture {
  /** The postgres_changes callback registered by the component. */
  update: ((payload: { new: ValuationRequestRow }) => void) | null;
  channelName: string | null;
  removedChannels: string[];
  /** Count of valuation_requests row reads (mount + each poll tick). */
  requestFetches: number;
}

export interface MockClientConfig {
  request: ValuationRequestRow | null;
  result: ValuationResultRow | null;
  /** Initial DB state that realtime UPDATEs should write. */
  setRequest?: (r: ValuationRequestRow | null) => void;
  /** Value returned by rpc('get_valuation_by_share_token') — the share page read. */
  sharedValuation?: ValuationResultRow | null;
  /** When set, rpc('get_valuation_by_share_token') resolves as an error. */
  rpcError?: string | null;
}

/**
 * Builds a supabase-js-shaped client whose .from().select().eq().maybeSingle()
 * returns the configured request/result, and whose .channel() harness captures
 * the realtime UPDATE callback so a test can drive status transitions.
 */
export function makeRealtimeClient(
  config: MockClientConfig,
  capture: RealtimeCapture = {
    update: null,
    channelName: null,
    removedChannels: [],
    requestFetches: 0,
  }
): SupabaseClientLike {
  return {
    from(table: string) {
      return {
        select() {
          const q = {
            eq() {
              return q;
            },
            maybeSingle() {
              if (table === "valuation_requests") capture.requestFetches += 1;
              const data =
                table === "valuation_requests" ? config.request : config.result;
              return Promise.resolve({ data, error: null });
            },
          };
          return q;
        },
      };
    },
    channel(name: string) {
      capture.channelName = name;
      const ch = {
        on(
          _event: string,
          _opts: unknown,
          cb: (payload: { new: ValuationRequestRow }) => void
        ) {
          capture.update = cb;
          return ch;
        },
        subscribe() {
          return ch;
        },
      };
      return ch;
    },
    removeChannel(_channel: unknown) {
      capture.removedChannels.push(capture.channelName ?? "");
    },
    rpc(fn: string, _args: unknown) {
      if (fn === "get_valuation_by_share_token") {
        if (config.rpcError) {
          return Promise.resolve({ data: null, error: { message: config.rpcError } });
        }
        const data = config.sharedValuation ? [config.sharedValuation] : [];
        return Promise.resolve({ data, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unhandled rpc: ${fn}` } });
    },
  };
}
