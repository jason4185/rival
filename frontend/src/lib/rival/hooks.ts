import { useCallback, useEffect, useState } from "react";
import {
  getMarket,
  getMarkets,
  getMyPosition,
  getRivalConfig,
  getSourceEvidence,
  getUserPositions,
} from "./read";
import type { Market, Page, Position, RivalConfig, SourceEvidence, SourceName } from "./types";
import { RivalError, normalizeError } from "./errors";

export type AsyncState<T> = {
  data: T | undefined;
  error: RivalError | undefined;
  loading: boolean;
  initialLoading: boolean;
  refreshing: boolean;
};

export function beginAsyncRequest<T>(
  state: AsyncState<T>,
  clearDataOnLoad: boolean,
): AsyncState<T> {
  const hasData = state.data !== undefined && !clearDataOnLoad;
  return {
    data: clearDataOnLoad ? undefined : state.data,
    loading: true,
    initialLoading: !hasData,
    refreshing: hasData,
    error: undefined,
  };
}

export function completeAsyncRequest<T>(state: AsyncState<T>, data: T): AsyncState<T> {
  return { data, error: undefined, loading: false, initialLoading: false, refreshing: false };
}

export function failAsyncRequest<T>(
  state: AsyncState<T>,
  error: unknown,
  clearDataOnLoad: boolean,
): AsyncState<T> {
  return {
    data: clearDataOnLoad ? undefined : state.data,
    loading: false,
    initialLoading: false,
    refreshing: false,
    error: normalizeError(error),
  };
}

function useAsync<T>(loader: () => Promise<T>, enabled = true, clearDataOnLoad = false) {
  const [state, setState] = useState<AsyncState<T>>({
    data: undefined,
    error: undefined,
    loading: enabled,
    initialLoading: enabled,
    refreshing: false,
  });
  const reload = useCallback(() => {
    if (!enabled) return Promise.resolve();
    setState((current) => beginAsyncRequest(current, clearDataOnLoad));
    return loader()
      .then((data) => setState((current) => completeAsyncRequest(current, data)))
      .catch((error) => setState((current) => failAsyncRequest(current, error, clearDataOnLoad)));
  }, [clearDataOnLoad, enabled, loader]);
  useEffect(() => {
    let active = true;
    if (!enabled) {
      setState({
        data: undefined,
        error: undefined,
        loading: false,
        initialLoading: false,
        refreshing: false,
      });
      return () => {
        active = false;
      };
    }
    setState((current) => beginAsyncRequest(current, clearDataOnLoad));
    loader()
      .then((data) => {
        if (active) setState((current) => completeAsyncRequest(current, data));
      })
      .catch((error) => {
        if (active) setState((current) => failAsyncRequest(current, error, clearDataOnLoad));
      });
    return () => {
      active = false;
    };
  }, [clearDataOnLoad, enabled, loader]);
  return { ...state, reload };
}

export function useRivalConfig() {
  return useAsync<RivalConfig>(useCallback(() => getRivalConfig(), []));
}
export function useMarkets(cursor = 0n, limit = 50) {
  return useAsync<Page<Market>>(useCallback(() => getMarkets(cursor, limit), [cursor, limit]));
}
export function useMarket(marketId: bigint | undefined) {
  return useAsync<Market>(
    useCallback(() => getMarket(marketId ?? 0n), [marketId]),
    marketId !== undefined,
  );
}
export function useUserPositions(address: `0x${string}` | undefined, cursor = 0n, limit = 50) {
  return useAsync<Page<Position>>(
    useCallback(() => getUserPositions(address!, cursor, limit), [address, cursor, limit]),
    Boolean(address),
  );
}
export function useMyPosition(address: `0x${string}` | undefined, marketId: bigint | undefined) {
  return useAsync<Position>(
    useCallback(() => getMyPosition(marketId!, address!), [address, marketId]),
    Boolean(address && marketId !== undefined),
    true,
  );
}
export function useSourceEvidence(
  marketId: bigint | undefined,
  source: SourceName | undefined,
  enabled: boolean,
) {
  return useAsync<SourceEvidence>(
    useCallback(() => getSourceEvidence(marketId!, source!), [marketId, source]),
    enabled && marketId !== undefined && source !== undefined,
  );
}
