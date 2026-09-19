import { describe, expect, test } from "bun:test";
import { beginAsyncRequest, completeAsyncRequest, failAsyncRequest } from "../src/lib/rival/hooks";
import { shouldConnectBinanceSocket } from "../src/lib/binance";

const emptyState = {
  data: undefined,
  error: undefined,
  loading: false,
  initialLoading: false,
  refreshing: false,
};

const loadedState = {
  data: { market_id: 1n, crypto_pool: 1n },
  error: undefined,
  loading: false,
  initialLoading: false,
  refreshing: false,
};

describe("RIVAL market background refresh", () => {
  test("initial request uses the full-page loading phase", () => {
    const next = beginAsyncRequest(emptyState, false);
    expect(next.initialLoading).toBe(true);
    expect(next.refreshing).toBe(false);
    expect(next.loading).toBe(true);
  });

  test("background refresh preserves the rendered market while pending", () => {
    const next = beginAsyncRequest(loadedState, false);
    expect(next.data).toBe(loadedState.data);
    expect(next.initialLoading).toBe(false);
    expect(next.refreshing).toBe(true);
    expect(next.loading).toBe(true);
  });

  test("successful refresh replaces only the cached result", () => {
    const next = completeAsyncRequest(beginAsyncRequest(loadedState, false), {
      market_id: 1n,
      crypto_pool: 2n,
    });
    expect(next.data).toEqual({ market_id: 1n, crypto_pool: 2n });
    expect(next.initialLoading).toBe(false);
    expect(next.refreshing).toBe(false);
  });

  test("failed background refresh keeps the last successful market", () => {
    const next = failAsyncRequest(
      beginAsyncRequest(loadedState, false),
      new Error("offline"),
      false,
    );
    expect(next.data).toBe(loadedState.data);
    expect(next.error).toBeDefined();
    expect(next.initialLoading).toBe(false);
    expect(next.refreshing).toBe(false);
  });

  test("failed initial request has no cached market and exposes an error", () => {
    const next = failAsyncRequest(
      beginAsyncRequest(emptyState, false),
      new Error("offline"),
      false,
    );
    expect(next.data).toBeUndefined();
    expect(next.error).toBeDefined();
    expect(next.initialLoading).toBe(false);
  });

  test("market detail gates the page only on initialLoading", async () => {
    const source = await Bun.file(new URL("../src/routes/market.$id.tsx", import.meta.url)).text();
    expect(source).toContain("if (market.initialLoading)");
    expect(source).not.toContain("if (market.loading)");
    expect(source).toContain("if (!market.data)");
    expect(source).not.toContain("if (market.error || !market.data)");
  });

  test("polling does not add a key or position refresh to the chart tree", async () => {
    const source = await Bun.file(new URL("../src/routes/market.$id.tsx", import.meta.url)).text();
    expect(source.match(/<BinanceMarketChart\b/g)?.length).toBe(1);
    expect(source).not.toMatch(/key=.*BinanceMarketChart/);
    const start = source.indexOf("window.setInterval");
    const end = source.indexOf("}, 10_000);", start);
    const polling = source.slice(start, end);
    expect(polling).toContain("market.reload()");
    expect(polling).not.toContain("position.reload");
    expect(polling).not.toContain("refreshMyPosition");
  });

  test("repeated active polling cannot open a duplicate Binance socket", () => {
    expect([0, 1, 2].map(() => shouldConnectBinanceSocket("live", true, true))).toEqual([
      false,
      false,
      false,
    ]);
  });
});
