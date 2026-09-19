import { createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { CalldataAddress } from "genlayer-js/types";
import { RIVAL_ADDRESS, MAX_PAGE_SIZE } from "./config";
import {
  normalizeConfig,
  normalizeEvidence,
  normalizeMarket,
  normalizePage,
  normalizePosition,
} from "./normalize";
import { normalizeError, RivalError, logTechnicalError } from "./errors";
import type { Market, Page, Position, RivalConfig, SourceEvidence, SourceName } from "./types";

const client = createClient({ chain: studioDevnet as never });
const cache = new Map<string, { value: unknown; expires: number }>();
const inflight = new Map<string, Promise<unknown>>();
type ViewAccount = { address: `0x${string}`; type: "json-rpc" };
const instrumentation = {
  requests: 0,
  duplicates: 0,
  retries: 0,
  rateLimits: 0,
  maxReadsPerSecond: 0,
  window: 0,
  windowRequests: 0,
  methods: {} as Record<string, number>,
};

function recordRequest(method: string, retried: boolean) {
  const now = Math.floor(Date.now() / 1000);
  if (instrumentation.window !== now) {
    instrumentation.window = now;
    instrumentation.windowRequests = 0;
  }
  instrumentation.requests += 1;
  instrumentation.windowRequests += 1;
  instrumentation.maxReadsPerSecond = Math.max(
    instrumentation.maxReadsPerSecond,
    instrumentation.windowRequests,
  );
  if (retried) instrumentation.retries += 1;
  instrumentation.methods[method] = (instrumentation.methods[method] ?? 0) + 1;
}

export const rivalRpcMetrics = {
  snapshot: () => ({ ...instrumentation }),
  reset: () => {
    instrumentation.requests = 0;
    instrumentation.duplicates = 0;
    instrumentation.retries = 0;
    instrumentation.rateLimits = 0;
    instrumentation.maxReadsPerSecond = 0;
    instrumentation.window = 0;
    instrumentation.windowRequests = 0;
    instrumentation.methods = {};
  },
};

function key(method: string, args: unknown[], account?: ViewAccount) {
  const serialized = account ? { account: account.address.toLowerCase(), args } : args;
  return `${method}:${JSON.stringify(serialized, (_, value) => (typeof value === "bigint" ? `${value}n` : value))}`;
}

function isRetryable(error: unknown) {
  const text = String(error instanceof Error ? error.message : error).toLowerCase();
  return (
    text.includes("429") ||
    text.includes("too many") ||
    text.includes("timeout") ||
    text.includes("network") ||
    text.includes("fetch") ||
    text.includes("5xx") ||
    text.includes("503") ||
    text.includes("server busy") ||
    text.includes("protocol is not supported")
  );
}

async function rawRead(method: string, args: unknown[], account?: ViewAccount) {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if (attempt > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250)),
        );
      }
      recordRequest(method, attempt > 0);
      const result = await client.readContract({
        ...(account ? { account } : {}),
        address: RIVAL_ADDRESS,
        functionName: method,
        args: args as never[],
      });
      return result;
    } catch (error) {
      last = error;
      if (!isRetryable(error) || attempt === 2) {
        if (String(error).includes("429")) instrumentation.rateLimits += 1;
        throw error;
      }
      if (String(error).includes("429")) instrumentation.rateLimits += 1;
    }
  }
  throw last;
}

async function readCached<T>(
  method: string,
  args: unknown[],
  staleMs: number,
  transform: (value: unknown) => T,
  account?: ViewAccount,
) {
  const cacheKey = key(method, args, account);
  const current = cache.get(cacheKey);
  if (current && current.expires > Date.now()) return current.value as T;
  const existing = inflight.get(cacheKey);
  if (existing) {
    instrumentation.duplicates += 1;
    return (await existing) as T;
  }
  const request = rawRead(method, args, account)
    .then((value) => {
      const normalized = transform(value);
      cache.set(cacheKey, { value: normalized, expires: Date.now() + staleMs });
      return normalized;
    })
    .catch((error) => {
      const normalized = normalizeError(error, "read");
      logTechnicalError(error);
      throw normalized;
    })
    .finally(() => inflight.delete(cacheKey));
  inflight.set(cacheKey, request);
  return request;
}

export function clearRivalReadCache() {
  cache.clear();
}

export function invalidateRivalReads(predicate?: (cacheKey: string) => boolean) {
  if (!predicate) return cache.clear();
  for (const cacheKey of cache.keys()) if (predicate(cacheKey)) cache.delete(cacheKey);
}

export function invalidateAfterRivalWrite(method: string, marketId?: bigint) {
  const marketNeedle = marketId === undefined ? undefined : `"${marketId}n"`;
  invalidateRivalReads((cacheKey) => {
    if (method === "create_market") return cacheKey.startsWith("get_markets:");
    if (method === "place_bet")
      return (
        cacheKey.startsWith("get_markets:") ||
        cacheKey.startsWith("get_market:") ||
        cacheKey.startsWith("get_user_positions:") ||
        (marketNeedle !== undefined &&
          cacheKey.startsWith("get_my_position:") &&
          cacheKey.includes(marketNeedle))
      );
    if (method === "settle_market")
      return (
        cacheKey.startsWith("get_markets:") ||
        cacheKey.startsWith("get_market:") ||
        cacheKey.startsWith("get_user_positions:") ||
        (marketNeedle !== undefined &&
          cacheKey.startsWith("get_my_position:") &&
          cacheKey.includes(marketNeedle)) ||
        (marketNeedle !== undefined &&
          cacheKey.startsWith("get_source_evidence:") &&
          cacheKey.includes(marketNeedle))
      );
    if (method === "claim" || method === "claim_refund")
      return (
        cacheKey.startsWith("get_markets:") ||
        cacheKey.startsWith("get_market:") ||
        cacheKey.startsWith("get_user_positions:") ||
        (marketNeedle !== undefined &&
          cacheKey.startsWith("get_my_position:") &&
          cacheKey.includes(marketNeedle))
      );
    return false;
  });
}

export function getRivalConfig() {
  return readCached("get_config", [], 30 * 60_000, normalizeConfig);
}

export function getMarketCount() {
  return readCached("get_market_count", [], 5_000, (raw) => {
    if (typeof raw === "bigint") return raw;
    if (typeof raw === "number" || typeof raw === "string") return BigInt(raw);
    throw new RivalError("Invalid market count returned by RIVAL.");
  });
}

export function getMarkets(cursor = 0n, limit = MAX_PAGE_SIZE): Promise<Page<Market>> {
  if (limit <= 0 || limit > MAX_PAGE_SIZE)
    return Promise.reject(new RivalError("That page size is not available."));
  return readCached("get_markets", [cursor, BigInt(limit)], 5_000, (raw) =>
    normalizePage(raw, normalizeMarket),
  );
}

export function getMarket(marketId: bigint) {
  return readCached("get_market", [marketId], 5_000, (raw) =>
    normalizeMarket(raw as Record<string, unknown>),
  );
}

export function refreshMarket(marketId: bigint) {
  const target = `get_market:["${marketId}n"]`;
  invalidateRivalReads((cacheKey) => cacheKey === target);
  return getMarket(marketId);
}

export function getUserPositions(
  user: `0x${string}`,
  cursor = 0n,
  limit = MAX_PAGE_SIZE,
): Promise<Page<Position>> {
  if (limit <= 0 || limit > MAX_PAGE_SIZE)
    return Promise.reject(new RivalError("That page size is not available."));
  const bytes = Uint8Array.from(
    user
      .slice(2)
      .match(/../g)
      ?.map((pair) => Number.parseInt(pair, 16)) ?? [],
  );
  const calldataUser = new CalldataAddress(bytes);
  return readCached("get_user_positions", [calldataUser, cursor, BigInt(limit)], 5_000, (raw) =>
    normalizePage(raw, normalizePosition),
  );
}

function viewAccount(user: `0x${string}`): ViewAccount {
  return { address: user.toLowerCase() as `0x${string}`, type: "json-rpc" };
}

export function getMyPosition(marketId: bigint, user: `0x${string}`) {
  const account = viewAccount(user);
  return readCached(
    "get_my_position",
    [marketId],
    5_000,
    (raw) => normalizePosition(raw as Record<string, unknown>),
    account,
  );
}

export function refreshMyPosition(marketId: bigint, user: `0x${string}`) {
  const account = viewAccount(user);
  const target = key("get_my_position", [marketId], account);
  invalidateRivalReads((cacheKey) => cacheKey === target);
  return getMyPosition(marketId, user);
}

export function refreshUserPositions(user: `0x${string}`, cursor = 0n, limit = MAX_PAGE_SIZE) {
  invalidateRivalReads((cacheKey) => cacheKey.startsWith("get_user_positions:"));
  return getUserPositions(user, cursor, limit);
}

export function getSourceEvidence(marketId: bigint, source: SourceName) {
  return readCached("get_source_evidence", [marketId, source], 30 * 60_000, normalizeEvidence);
}
