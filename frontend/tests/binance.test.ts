import { describe, expect, test } from "bun:test";
import {
  BINANCE_SYMBOLS,
  buildMarketRaceSeries,
  calculateBasketReturns,
  createEmptyKlineMap,
  formatBinancePercent,
  marketPhase,
  parseBinanceKlineEvent,
  parseBinanceRestKline,
  shouldConnectBinanceSocket,
} from "../src/lib/binance";

const start = 1_800_000_000_000;
const end = start + 120_000;

function kline(open: number, close: number, offset = 0) {
  return {
    openTime: start + offset * 60_000,
    closeTime: start + offset * 60_000 + 59_999,
    open,
    close,
  };
}

function sampleKlines() {
  const map = createEmptyKlineMap();
  map.BTC = [kline(100, 100), kline(100, 103, 1)];
  map.ETH = [kline(200, 200), kline(200, 206, 1)];
  map.SOL = [kline(50, 50), kline(50, 50, 1)];
  map.GOLD = [kline(10, 10), kline(10, 10.2, 1)];
  map.SILVER = [kline(20, 20), kline(20, 20.8, 1)];
  map.WTI_CRUDE = [kline(40, 40), kline(40, 40, 1)];
  return map;
}

describe("RIVAL Binance live chart", () => {
  test("uses the exact six USDⓈ-M symbols", () => {
    expect(BINANCE_SYMBOLS).toEqual({
      BTC: "BTCUSDT",
      ETH: "ETHUSDT",
      SOL: "SOLUSDT",
      GOLD: "XAUUSDT",
      SILVER: "XAGUSDT",
      WTI_CRUDE: "CLUSDT",
    });
  });

  test("normalizes asset return from market-start price", () => {
    const parsed = parseBinanceRestKline(
      [start, "100", "101", "99", "103", "1", start + 59_999],
      start,
      end,
    );
    expect(parsed?.open).toBe(100);
    expect(parsed?.close).toBe(103);
  });

  test("calculates equal-weight crypto and commodities baskets", () => {
    const result = calculateBasketReturns({
      BTC: 0.03,
      ETH: 0.06,
      SOL: 0,
      GOLD: 0.01,
      SILVER: 0.04,
      WTI_CRUDE: 0.01,
    });
    expect(result.cryptoReturn).toBeCloseTo(0.03, 12);
    expect(result.commoditiesReturn).toBeCloseTo(0.02, 12);
  });

  test("starts both baskets at zero and keeps the less-negative return visible", () => {
    const series = buildMarketRaceSeries(sampleKlines(), start, end);
    expect(series[0]?.cryptoReturn).toBe(0);
    expect(series[0]?.commoditiesReturn).toBe(0);
    expect(formatBinancePercent(-0.001)).toBe("-0.10%");
    expect(formatBinancePercent(-0.003)).toBe("-0.30%");
  });

  test("rejects malformed or wrong-symbol websocket updates", () => {
    const valid = {
      stream: "btcusdt@kline_1m",
      data: {
        e: "kline",
        s: "BTCUSDT",
        k: {
          t: start,
          T: start + 59_999,
          s: "BTCUSDT",
          i: "1m",
          o: "100",
          c: "101",
        },
      },
    };
    expect(parseBinanceKlineEvent(valid, start, end)?.asset).toBe("BTC");
    expect(
      parseBinanceKlineEvent({ ...valid, data: { ...valid.data, s: "ETHUSDT" } }, start, end),
    ).toBeUndefined();
    expect(parseBinanceKlineEvent({ data: { e: "kline" } }, start, end)).toBeUndefined();
  });

  test("only opens one live feed during the active window", () => {
    expect(marketPhase(start, end, start - 1)).toBe("upcoming");
    expect(marketPhase(start, end, start)).toBe("live");
    expect(marketPhase(start, end, end)).toBe("completed");
    expect(shouldConnectBinanceSocket("upcoming", true, false)).toBe(false);
    expect(shouldConnectBinanceSocket("completed", true, false)).toBe(false);
    expect(shouldConnectBinanceSocket("live", false, false)).toBe(false);
    expect(shouldConnectBinanceSocket("live", true, false)).toBe(true);
    expect(shouldConnectBinanceSocket("live", true, true)).toBe(false);
  });

  test("chart points carry no official winner state", () => {
    const point = buildMarketRaceSeries(sampleKlines(), start, end)[1];
    expect(point && "winner" in point).toBe(false);
  });
});
