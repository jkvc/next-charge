export function formatRetryTime(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`;
}

export interface ChargeFetchOptions {
  /** Called when an out_of_charge 429 is detected. Receives the parsed body and a formatted retry string. */
  onOutOfCharge?: (body: { retryAfterMs: number; poolId: string }, retryStr: string) => void;
}

export type ChargeFetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Wraps fetch() with automatic 429 / out_of_charge detection.
 * Framework-agnostic — works in any JS environment with global fetch.
 *
 * Returns the original Response so callers handle other errors normally.
 */
export function createChargeFetch(options: ChargeFetchOptions = {}): ChargeFetchFn {
  const { onOutOfCharge } = options;

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
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
  };
}
