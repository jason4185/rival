import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { formatGen, parseGen } from "../src/lib/rival/format";
import { normalizeError } from "../src/lib/rival/errors";
import { RIVAL_ADDRESS } from "../src/lib/rival/config";
import {
  clearRivalReadCache,
  getMarket,
  getMarketCount,
  getMarkets,
  getMyPosition,
  getRivalConfig,
  getUserPositions,
  rivalRpcMetrics,
} from "../src/lib/rival/read";
import {
  hasSuccessfulExecution,
  requiresFinalization,
  runPostWriteRefresh,
  settlementBusinessMessage,
  writePhase,
} from "../src/lib/rival/write";
import { ExecutionResult } from "genlayer-js/types";

const deployedAddress = RIVAL_ADDRESS;

describe("RIVAL frontend contract integration helpers", () => {
  test("preserves exact GEN units", () => {
    expect(parseGen("1")).toBe(1_000_000_000_000_000_000n);
    expect(formatGen(1_000_000_000_000_000_000n)).toBe("1 GEN");
  });

  test("maps contract and transaction failures to friendly copy", () => {
    expect(normalizeError(new Error("market start must be next UTC hour"), "write").message).toBe(
      "This market can only be created for the next UTC hour.",
    );
    expect(normalizeError(new Error("rollback: execution ERROR"), "execution").message).toBe(
      "This transaction couldn't be completed. Please try again.",
    );
  });

  test("requires an accepted or finalized successful execution result", () => {
    expect(
      hasSuccessfulExecution({
        phase: "decided",
        statusName: "ACCEPTED",
        executionResultName: ExecutionResult.FINISHED_WITH_RETURN,
        successful: true,
      }),
    ).toBe(true);
    expect(
      hasSuccessfulExecution({
        phase: "finalized",
        statusName: "FINALIZED",
        executionResultName: ExecutionResult.FINISHED_WITH_RETURN,
        successful: true,
      }),
    ).toBe(true);
    expect(
      hasSuccessfulExecution({
        phase: "decided",
        statusName: "ACCEPTED",
        executionResultName: ExecutionResult.FINISHED_WITH_ERROR,
        successful: false,
      }),
    ).toBe(false);
    expect(
      writePhase({
        phase: "finalized",
        statusName: "FINALIZED",
        executionResultName: ExecutionResult.FINISHED_WITH_ERROR,
        successful: false,
      }),
    ).toBe("failed");
  });

  test("uses accepted tracking for normal writes and finalization for payouts", () => {
    expect(requiresFinalization("create_market")).toBe(false);
    expect(requiresFinalization("place_bet")).toBe(false);
    expect(requiresFinalization("settle_market")).toBe(false);
    expect(requiresFinalization("claim")).toBe(true);
    expect(requiresFinalization("claim_refund")).toBe(true);
  });

  test("keeps settlement business results separate from transaction failure", () => {
    expect(settlementBusinessMessage("SETTLED")).toBe("Market settled.");
    expect(settlementBusinessMessage("SETTLEMENT_PENDING")).toBe(
      "Settlement didn't reach agreement yet. It can be retried before the deadline.",
    );
    expect(settlementBusinessMessage("INCONCLUSIVE")).toBe(
      "The market is inconclusive. Eligible bettors can claim their refunds.",
    );
  });

  test("does not convert a post-write refresh failure into a transaction failure", async () => {
    let refreshError: unknown;
    const refreshed = await runPostWriteRefresh(
      async () => {
        throw new Error("temporary RPC failure");
      },
      (error) => {
        refreshError = error;
      },
    );
    expect(refreshed).toBeUndefined();
    expect(refreshError).toBeInstanceOf(Error);
  });

  test("keeps the market action panel beside the compact chart on desktop", () => {
    const marketRoute = readFileSync(
      new URL("../src/routes/market.$id.tsx", import.meta.url),
      "utf8",
    );
    const chart = marketRoute.indexOf("<BinanceMarketChart");
    const desktopGrid = marketRoute.indexOf("lg:grid-cols-[minmax(0,1fr)_340px]");
    const stickyPanel = marketRoute.indexOf("lg:sticky lg:top-20");
    expect(desktopGrid).toBeGreaterThan(-1);
    expect(chart).toBeGreaterThan(desktopGrid);
    expect(stickyPanel).toBeGreaterThan(chart);

    const chartSource = readFileSync(
      new URL("../src/components/rival/BinanceMarketChart.tsx", import.meta.url),
      "utf8",
    );
    expect(chartSource).toContain("h-[250px] w-full md:h-[270px]");
  });

  test("mobile action layout remains stackable", () => {
    const marketRoute = readFileSync(
      new URL("../src/routes/market.$id.tsx", import.meta.url),
      "utf8",
    );
    expect(marketRoute).toContain(
      'className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start"',
    );
    expect(marketRoute).toContain('className="space-y-4 lg:sticky lg:top-20 lg:self-start"');
  });

  test("keeps a successful execution result available for the confirmed UI", () => {
    expect(
      writePhase({
        phase: "decided",
        statusName: "ACCEPTED",
        executionResultName: ExecutionResult.FINISHED_WITH_RETURN,
        successful: true,
      }),
    ).toBe("confirmed");
  });

  test("reads the deployed contract and bounded pages", async () => {
    clearRivalReadCache();
    const config = await getRivalConfig();
    const marketCount = await getMarketCount();
    const markets = await getMarkets(0n, 50);
    const market = await getMarket(1n);
    const positions = await getUserPositions(deployedAddress, 0n, 50);
    expect(config.protocol).toBe("RIVAL V1");
    expect(marketCount).toBeGreaterThanOrEqual(1n);
    expect(markets.items.length).toBeLessThanOrEqual(50);
    expect(market.market_id).toBe(1n);
    expect(positions.items.length).toBeLessThanOrEqual(50);
  }, 20_000);

  test("deduplicates concurrent reads", async () => {
    clearRivalReadCache();
    rivalRpcMetrics.reset();
    await Promise.all([getMarkets(0n, 50), getMarkets(0n, 50), getMarkets(0n, 50)]);
    const metrics = rivalRpcMetrics.snapshot();
    expect(metrics.requests).toBeLessThanOrEqual(3);
    expect(metrics.duplicates).toBeGreaterThanOrEqual(2);
    expect(metrics.maxReadsPerSecond).toBeLessThanOrEqual(10);
  });

  test("rejects invalid page sizes instead of widening the read", async () => {
    await expect(getMarkets(0n, 51)).rejects.toThrow("page size");
    await expect(getUserPositions(deployedAddress, 0n, 0)).rejects.toThrow("page size");
  });

  test("market detail uses exact position lookup instead of a portfolio scan", async () => {
    clearRivalReadCache();
    rivalRpcMetrics.reset();
    const position = await getMyPosition(1n, deployedAddress);
    const metrics = rivalRpcMetrics.snapshot();
    expect(position.market_id).toBe(1n);
    expect(metrics.methods.get_my_position).toBeGreaterThan(0);
    expect(metrics.methods.get_user_positions ?? 0).toBe(0);
  }, 20_000);

  test("position cache is isolated by account and supports histories beyond one page", async () => {
    const accountA = deployedAddress;
    const accountB = "0x0000000000000000000000000000000000000001" as `0x${string}`;
    clearRivalReadCache();
    rivalRpcMetrics.reset();
    await Promise.all([
      getMyPosition(1n, accountA),
      getMyPosition(1n, accountA),
      getMyPosition(1n, accountB),
      getMyPosition(1n, accountB),
    ]);
    const metrics = rivalRpcMetrics.snapshot();
    expect(metrics.methods.get_my_position).toBeGreaterThanOrEqual(2);
    expect(metrics.duplicates).toBeGreaterThanOrEqual(2);
    expect(metrics.methods.get_user_positions ?? 0).toBe(0);
  }, 20_000);

  test("account changes clear exact-position cache data", async () => {
    const accountA = deployedAddress;
    const accountB = "0x0000000000000000000000000000000000000001" as `0x${string}`;
    clearRivalReadCache();
    rivalRpcMetrics.reset();
    await getMyPosition(1n, accountA);
    clearRivalReadCache();
    await getMyPosition(1n, accountB);
    const metrics = rivalRpcMetrics.snapshot();
    expect(metrics.methods.get_my_position).toBeGreaterThanOrEqual(2);
  }, 20_000);
});
