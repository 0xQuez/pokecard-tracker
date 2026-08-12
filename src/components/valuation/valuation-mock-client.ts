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
}

export interface MockClientConfig {
  request: ValuationRequestRow | null;
  result: ValuationResultRow | null;
  /** Initial DB state that realtime UPDATEs should write. */
  setRequest?: (r: ValuationRequestRow | null) => void;
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
  };
}
