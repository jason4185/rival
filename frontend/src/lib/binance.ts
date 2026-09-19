import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export const BINANCE_REST_ENDPOINT = "https://fapi.binance.com/fapi/v1/klines";
export const BINANCE_WEBSOCKET_ENDPOINT = "wss://fstream.binance.com/market/stream";
export const BINANCE_INTERVAL = "1m" as const;

export const BINANCE_SYMBOLS = {
  BTC: "BTCUSDT",
  ETH: "ETHUSDT",
  SOL: "SOLUSDT",
  GOLD: "XAUUSDT",
  SILVER: "XAGUSDT",
  WTI_CRUDE: "CLUSDT",
} as const;

export type BinanceAsset = keyof typeof BINANCE_SYMBOLS;
export type BinanceKline = {
  openTime: number;
  closeTime: number;
  open: number;
  close: number;
};
export type BinanceKlineMap = Record<BinanceAsset, BinanceKline[]>;
export type MarketRacePoint = {
  timeMs: number;
  prices: Record<BinanceAsset, number>;
  returns: Record<BinanceAsset, number>;
  cryptoReturn: number;
  commoditiesReturn: number;
};
export type BinanceMarketPhase = "upcoming" | "live" | "completed";
export type BinanceFeedStatus = BinanceMarketPhase | "loading" | "error";
export type BinanceChartView = "BASKET" | BinanceAsset;

export const CRYPTO_ASSETS = ["BTC", "ETH", "SOL"] as const;
export const COMMODITY_ASSETS = ["GOLD", "SILVER", "WTI_CRUDE"] as const;
export const BINANCE_ASSET_LABELS: Record<BinanceAsset, string> = {
  BTC: "BTC",
  ETH: "ETH",
  SOL: "SOL",
  GOLD: "GOLD",
  SILVER: "SILVER",
  WTI_CRUDE: "WTI",
};

const ALL_ASSETS = Object.keys(BINANCE_SYMBOLS) as BinanceAsset[];
const HISTORY_CACHE = new Map<string, Promise<BinanceKline[]>>();

function asFiniteNumber(value: unknown, positive = false) {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(number) && (!positive || number > 0) ? number : undefined;
}

function asInteger(value: unknown) {
  const number = asFiniteNumber(value);
  return number !== undefined && Number.isSafeInteger(number) ? number : undefined;
}

function asTimestampMs(value: bigint) {
  const seconds = Number(value);
  const milliseconds = seconds * 1000;
  return Number.isSafeInteger(seconds) && Number.isSafeInteger(milliseconds)
    ? milliseconds
    : undefined;
}

export function marketPhase(startMs: number, endMs: number, nowMs: number): BinanceMarketPhase {
  if (nowMs < startMs) return "upcoming";
  if (nowMs < endMs) return "live";
  return "completed";
}

export function shouldConnectBinanceSocket(
  phase: BinanceMarketPhase,
  visible: boolean,
  socketExists: boolean,
) {
  return phase === "live" && visible && !socketExists;
}

export function createEmptyKlineMap(): BinanceKlineMap {
  return {
    BTC: [],
    ETH: [],
    SOL: [],
    GOLD: [],
    SILVER: [],
    WTI_CRUDE: [],
  };
}

export function parseBinanceRestKline(
  row: unknown,
  startMs: number,
  endMs: number,
): BinanceKline | undefined {
  if (!Array.isArray(row) || row.length < 7) return undefined;
  const openTime = asInteger(row[0]);
  const closeTime = asInteger(row[6]);
  const open = asFiniteNumber(row[1], true);
  const close = asFiniteNumber(row[4], true);
  if (
    openTime === undefined ||
    closeTime === undefined ||
    open === undefined ||
    close === undefined ||
    openTime < startMs ||
    openTime >= endMs ||
    openTime % 60_000 !== 0 ||
    closeTime < openTime ||
    closeTime - openTime > 60_000
  )
    return undefined;
  return { openTime, closeTime, open, close };
}

export function parseBinanceKlineEvent(
  payload: unknown,
  startMs: number,
  endMs: number,
): { asset: BinanceAsset; kline: BinanceKline } | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const wrapped = "data" in payload ? (payload as { data?: unknown }).data : payload;
  if (!wrapped || typeof wrapped !== "object") return undefined;
  const event = wrapped as Record<string, unknown>;
  if (event["e"] !== "kline" || !event["k"] || typeof event["k"] !== "object") return undefined;
  const kline = event["k"] as Record<string, unknown>;
  const eventSymbol = typeof event["s"] === "string" ? event["s"].toUpperCase() : undefined;
  const klineSymbol = typeof kline["s"] === "string" ? kline["s"].toUpperCase() : undefined;
  if (eventSymbol && klineSymbol && eventSymbol !== klineSymbol) return undefined;
  const symbol = klineSymbol ?? eventSymbol;
  const asset = ALL_ASSETS.find((candidate) => BINANCE_SYMBOLS[candidate] === symbol);
  if (!asset || kline["i"] !== BINANCE_INTERVAL) return undefined;
  const openTime = asInteger(kline["t"]);
  const closeTime = asInteger(kline["T"]);
  const open = asFiniteNumber(kline["o"], true);
  const close = asFiniteNumber(kline["c"], true);
  if (
    openTime === undefined ||
    closeTime === undefined ||
    open === undefined ||
    close === undefined ||
    openTime < startMs ||
    openTime >= endMs ||
    openTime % 60_000 !== 0 ||
    closeTime < openTime ||
    closeTime - openTime > 60_000
  )
    return undefined;
  return { asset, kline: { openTime, closeTime, open, close } };
}

export function calculateBasketReturns(returns: Record<BinanceAsset, number>) {
  const average = (assets: readonly BinanceAsset[]) =>
    assets.reduce((total, asset) => total + returns[asset], 0) / assets.length;
  return {
    cryptoReturn: average(CRYPTO_ASSETS),
    commoditiesReturn: average(COMMODITY_ASSETS),
  };
}

export function buildMarketRaceSeries(
  klines: BinanceKlineMap,
  startMs: number,
  endMs: number,
): MarketRacePoint[] {
  if (ALL_ASSETS.some((asset) => klines[asset].length === 0)) return [];
  const sorted = Object.fromEntries(
    ALL_ASSETS.map((asset) => [
      asset,
      [...klines[asset]].sort((left, right) => left.openTime - right.openTime),
    ]),
  ) as BinanceKlineMap;
  if (ALL_ASSETS.some((asset) => sorted[asset][0] === undefined)) return [];
  const baseline = Object.fromEntries(
    ALL_ASSETS.map((asset) => [asset, sorted[asset][0]!.open]),
  ) as Record<BinanceAsset, number>;
  const times = new Set<number>([startMs]);
  for (const asset of ALL_ASSETS) {
    for (const kline of sorted[asset]) {
      if (kline.openTime >= startMs && kline.openTime < endMs) times.add(kline.openTime);
    }
  }
  const indexes = Object.fromEntries(ALL_ASSETS.map((asset) => [asset, 0])) as Record<
    BinanceAsset,
    number
  >;
  const latest = {} as Record<BinanceAsset, BinanceKline | undefined>;
  return [...times]
    .sort((left, right) => left - right)
    .map((timeMs) => {
      for (const asset of ALL_ASSETS) {
        const rows = sorted[asset];
        while (indexes[asset] < rows.length) {
          const candidate = rows[indexes[asset]];
          if (!candidate || candidate.openTime > timeMs) break;
          latest[asset] = candidate;
          indexes[asset] += 1;
        }
      }
      if (ALL_ASSETS.some((asset) => latest[asset] === undefined)) return undefined;
      const prices = Object.fromEntries(
        ALL_ASSETS.map((asset) => [asset, latest[asset]!.close]),
      ) as Record<BinanceAsset, number>;
      const returns = Object.fromEntries(
        ALL_ASSETS.map((asset) => [asset, (prices[asset] - baseline[asset]) / baseline[asset]]),
      ) as Record<BinanceAsset, number>;
      const baskets = calculateBasketReturns(returns);
      return { timeMs, prices, returns, ...baskets };
    })
    .filter((point): point is MarketRacePoint => point !== undefined);
}

export function formatBinancePercent(value: number | undefined, digits = 2) {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

export function formatBinancePrice(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const digits = value >= 1000 ? 2 : value >= 1 ? 4 : 6;
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function formatBinanceUtc(ms: number) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

export function binanceStreamUrl() {
  const streams = ALL_ASSETS.map(
    (asset) => `${BINANCE_SYMBOLS[asset].toLowerCase()}@kline_${BINANCE_INTERVAL}`,
  );
  return `${BINANCE_WEBSOCKET_ENDPOINT}?streams=${streams.join("/")}`;
}

async function fetchAssetKlines(asset: BinanceAsset, startMs: number, endMs: number) {
  const key = `${asset}:${startMs}:${endMs}`;
  const cached = HISTORY_CACHE.get(key);
  if (cached) return cached;
  const request = fetch(
    `${BINANCE_REST_ENDPOINT}?symbol=${BINANCE_SYMBOLS[asset]}&interval=${BINANCE_INTERVAL}&startTime=${startMs}&endTime=${endMs}&limit=100`,
  )
    .then(async (response) => {
      if (!response.ok) throw new Error(`Binance returned HTTP ${response.status}.`);
      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) throw new Error("Binance returned an invalid kline payload.");
      const rows = payload
        .map((row) => parseBinanceRestKline(row, startMs, endMs))
        .filter((row): row is BinanceKline => row !== undefined)
        .sort((left, right) => left.openTime - right.openTime);
      if (rows.length === 0 || rows[0]?.openTime !== startMs)
        throw new Error(`Binance returned no valid ${asset} market-start kline.`);
      return rows;
    })
    .catch((error) => {
      HISTORY_CACHE.delete(key);
      throw error;
    });
  HISTORY_CACHE.set(key, request);
  return request;
}

async function fetchMarketHistory(startMs: number, endMs: number) {
  if (endMs <= startMs) throw new Error("The Binance market window is invalid.");
  const entries = await Promise.all(
    ALL_ASSETS.map(
      async (asset) => [asset, await fetchAssetKlines(asset, startMs, endMs)] as const,
    ),
  );
  return Object.fromEntries(entries) as BinanceKlineMap;
}

function clearMarketHistory(startMs: number) {
  for (const key of HISTORY_CACHE.keys()) {
    if (key.split(":")[1] === String(startMs)) HISTORY_CACHE.delete(key);
  }
}

export function useBinanceMarketFeed(marketStart: bigint, marketEnd: bigint) {
  const startMs = asTimestampMs(marketStart);
  const endMs = asTimestampMs(marketEnd);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [retryToken, setRetryToken] = useState(0);
  const [klines, setKlines] = useState<BinanceKlineMap>(() => createEmptyKlineMap());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [socketError, setSocketError] = useState<string>();
  const [socketConnected, setSocketConnected] = useState(false);
  const previousWindow = useRef<string | undefined>(undefined);
  const phase =
    startMs === undefined || endMs === undefined ? "completed" : marketPhase(startMs, endMs, nowMs);

  useEffect(() => {
    if (startMs === undefined || endMs === undefined || phase === "completed") return;
    const boundary = phase === "upcoming" ? startMs : endMs;
    const timer = window.setTimeout(() => setNowMs(Date.now()), Math.max(0, boundary - Date.now()));
    return () => window.clearTimeout(timer);
  }, [endMs, phase, startMs]);

  useEffect(() => {
    if (startMs === undefined || endMs === undefined || phase === "upcoming") {
      if (phase === "upcoming") setKlines(createEmptyKlineMap());
      setLoading(false);
      return;
    }
    let cancelled = false;
    const windowKey = `${startMs}:${endMs}`;
    if (previousWindow.current !== windowKey) {
      previousWindow.current = windowKey;
      setKlines(createEmptyKlineMap());
    }
    const requestEnd = Math.min(Date.now(), endMs);
    setLoading(true);
    setLoadError(undefined);
    setSocketError(undefined);
    void fetchMarketHistory(startMs, requestEnd)
      .then((next) => {
        if (!cancelled) setKlines(next);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Live Binance data is temporarily unavailable.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [endMs, phase, retryToken, startMs]);

  const hasHistory = ALL_ASSETS.every((asset) => klines[asset].length > 0);
  useEffect(() => {
    if (
      phase !== "live" ||
      !hasHistory ||
      typeof window === "undefined" ||
      typeof WebSocket === "undefined" ||
      startMs === undefined ||
      endMs === undefined
    )
      return;
    let cancelled = false;
    let socket: WebSocket | undefined;
    let reconnectTimer: number | undefined;
    let attempts = 0;
    const connect = () => {
      if (cancelled || document.hidden || !shouldConnectBinanceSocket(phase, true, Boolean(socket)))
        return;
      try {
        socket = new WebSocket(binanceStreamUrl());
        socket.onopen = () => {
          attempts = 0;
          setSocketConnected(true);
          setSocketError(undefined);
        };
        socket.onmessage = (event) => {
          try {
            const parsed = parseBinanceKlineEvent(JSON.parse(event.data), startMs, endMs);
            if (!parsed) return;
            setKlines((current) => ({
              ...current,
              [parsed.asset]: [
                ...current[parsed.asset].filter((row) => row.openTime !== parsed.kline.openTime),
                parsed.kline,
              ].sort((left, right) => left.openTime - right.openTime),
            }));
          } catch {
            // Malformed external updates are ignored by design.
          }
        };
        socket.onerror = () => {
          setSocketError("Live Binance data is temporarily unavailable.");
        };
        socket.onclose = () => {
          socket = undefined;
          setSocketConnected(false);
          if (cancelled || document.hidden) return;
          const delay =
            Math.min(30_000, 1000 * 2 ** Math.min(attempts, 5)) + Math.floor(Math.random() * 250);
          attempts += 1;
          reconnectTimer = window.setTimeout(connect, delay);
        };
      } catch {
        setSocketError("Live Binance data is temporarily unavailable.");
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempts, 5));
        attempts += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
        socket?.close();
        socket = undefined;
        setSocketConnected(false);
      } else {
        connect();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    connect();
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      socket?.close();
      setSocketConnected(false);
    };
  }, [endMs, hasHistory, phase, startMs]);

  const series = useMemo(
    () =>
      startMs === undefined || endMs === undefined
        ? []
        : buildMarketRaceSeries(klines, startMs, endMs),
    [endMs, klines, startMs],
  );
  const retry = useCallback(() => {
    if (startMs !== undefined) clearMarketHistory(startMs);
    setRetryToken((value) => value + 1);
  }, [startMs]);
  const status: BinanceFeedStatus = loadError
    ? "error"
    : loading && series.length === 0
      ? "loading"
      : phase;
  return {
    status,
    phase,
    series,
    loading,
    error: loadError ?? socketError,
    socketConnected,
    retry,
  };
}
