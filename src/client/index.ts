import { useCallback } from "react";
import { createChargeFetch, formatRetryTime } from "../fetch";
import type { ChargeFetchOptions, ChargeFetchFn } from "../fetch";

export type UseChargeFetchOptions = ChargeFetchOptions;

/**
 * React hook wrapping createChargeFetch with stable identity via useCallback.
 * For non-React usage, import createChargeFetch from "next-charge/fetch" directly.
 */
export function useChargeFetch(options: UseChargeFetchOptions = {}): ChargeFetchFn {
  const { onOutOfCharge } = options;

  const chargeFetch = useCallback(
    createChargeFetch({ onOutOfCharge }),
    [onOutOfCharge],
  );

  return chargeFetch;
}

export { formatRetryTime };
export type { ChargeFetchOptions, ChargeFetchFn } from "../fetch";
