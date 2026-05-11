import { useCallback } from "react";

function formatRetryTime(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`;
}

export interface UseChargeFetchOptions {
  /** Called when an out_of_charge 429 is detected. Receives the parsed body and a formatted retry string. */
  onOutOfCharge?: (body: { retryAfterMs: number; poolId: string }, retryStr: string) => void;
}

/**
 * Wraps fetch() with automatic 429 / out_of_charge detection.
 * Provide an `onOutOfCharge` callback to handle the depleted state
 * (e.g. show a toast, redirect, etc.).
 *
 * Returns the original Response so callers handle other errors normally.
 */
export function useChargeFetch(options: UseChargeFetchOptions = {}) {
  const { onOutOfCharge } = options;

  const chargeFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const response = await fetch(input, init);

      if (response.status === 429) {
        try {
          const cloned = response.clone();
          const body = await cloned.json();
          if (body.error === "out_of_charge" && onOutOfCharge) {
            const retryStr = formatRetryTime(body.retryAfterMs ?? 0);
            onOutOfCharge(body, retryStr);
          }
        } catch {
          // Non-JSON 429 — not from charge system
        }
      }

      return response;
    },
    [onOutOfCharge],
  );

  return chargeFetch;
}

export { formatRetryTime };
