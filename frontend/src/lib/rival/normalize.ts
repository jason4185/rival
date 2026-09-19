import type {
  Market,
  MarketState,
  Outcome,
  Page,
  Position,
  RivalConfig,
  SourceEvidence,
} from "./types";

export function asBigInt(value: unknown, fallback = 0n): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return fallback;
}

function asOutcome(value: unknown): Outcome | "" {
  return value === "CRYPTO" || value === "COMMODITIES" ? value : "";
}

function asState(value: unknown): MarketState {
  if (value === "SETTLEMENT_PENDING" || value === "SETTLED" || value === "INCONCLUSIVE")
    return value;
  return "OPEN";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function normalizeMarket(raw: Record<string, unknown>): Market {
  // The SDK's JSON-safe return is intentionally open-ended; fields are validated below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const value = raw as any;
  const id = asBigInt(value.market_id ?? value.id);
  return {
    id,
    market_id: id,
    market_start: asBigInt(value.market_start),
    market_end: asBigInt(value.market_end),
    betting_close: asBigInt(value.betting_close ?? value.market_start),
    settlement_ready: asBigInt(value.settlement_ready),
    settlement_deadline: asBigInt(value.settlement_deadline),
    state: asState(value.state),
    winner: asOutcome(value.winner),
    reason: typeof value.reason === "string" ? value.reason : "",
    market_pool: asBigInt(value.market_pool ?? value.total_pool),
    total_pool: asBigInt(value.total_pool ?? value.market_pool),
    crypto_pool: asBigInt(value.crypto_pool),
    commodities_pool: asBigInt(value.commodities_pool),
    winning_pool: asBigInt(value.winning_pool),
    claimed_pool: asBigInt(value.claimed_pool),
    refunded_pool: asBigInt(value.refunded_pool),
    remaining_pool: asBigInt(value.remaining_pool),
    settlement_available: value.settlement_available === true,
    deadline_expired: value.deadline_expired === true,
    betting_open: value.betting_open === true,
    crypto_basket: asStringArray(value.crypto_basket),
    commodities_basket: asStringArray(value.commodities_basket),
  };
}

export function normalizePosition(raw: Record<string, unknown>): Position {
  // The SDK's JSON-safe return is intentionally open-ended; fields are validated below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const value = raw as any;
  const state = asState(value.state ?? value.market_state);
  return {
    market_id: asBigInt(value.market_id),
    market_start: asBigInt(value.market_start),
    market_end: asBigInt(value.market_end),
    settlement_ready: asBigInt(value.settlement_ready),
    settlement_deadline: asBigInt(value.settlement_deadline),
    has_position: value.has_position === true,
    selected_outcome: asOutcome(value.selected_outcome),
    user_outcome: asOutcome(value.user_outcome ?? value.selected_outcome),
    total_stake: asBigInt(value.total_stake ?? value.user_stake),
    user_stake: asBigInt(value.user_stake ?? value.total_stake),
    market_state: state,
    state,
    winner: asOutcome(value.winner),
    reason: typeof value.reason === "string" ? value.reason : "",
    market_pool: asBigInt(value.market_pool),
    crypto_pool: asBigInt(value.crypto_pool),
    commodities_pool: asBigInt(value.commodities_pool),
    winning_pool: asBigInt(value.winning_pool),
    claimed_pool: asBigInt(value.claimed_pool),
    refunded_pool: asBigInt(value.refunded_pool),
    can_top_up: value.can_top_up === true,
    position_won: value.position_won === true,
    position_lost: value.position_lost === true,
    claim_available: value.claim_available === true,
    refund_available: value.refund_available === true,
    already_claimed: value.already_claimed === true || value.claimed === true,
    claimed: value.claimed === true,
    refunded: value.refunded === true,
    claimable_amount: asBigInt(value.claimable_amount),
    claim_type:
      value.claim_type === "REFUND"
        ? "REFUND"
        : value.claim_type === "WINNINGS"
          ? "WINNINGS"
          : "NONE",
  };
}

export function normalizePage<T>(
  raw: unknown,
  normalize: (item: Record<string, unknown>) => T,
): Page<T> {
  // The SDK's JSON-safe return is intentionally open-ended; fields are validated below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const value = (raw && typeof raw === "object" ? raw : {}) as any;
  const items = Array.isArray(value.items)
    ? value.items
        .filter((item: unknown): item is Record<string, unknown> =>
          Boolean(item && typeof item === "object"),
        )
        .map(normalize)
    : [];
  return {
    items,
    next_cursor: asBigInt(value.next_cursor),
    has_more: value.has_more === true,
  };
}

export function normalizeConfig(raw: unknown): RivalConfig {
  // The SDK's JSON-safe return is intentionally open-ended; fields are validated below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const value = (raw && typeof raw === "object" ? raw : {}) as any;
  return {
    ...value,
    protocol: typeof value.protocol === "string" ? value.protocol : "RIVAL V1",
    outcomes: Array.isArray(value.outcomes)
      ? value.outcomes.filter((x: unknown): x is Outcome => x === "CRYPTO" || x === "COMMODITIES")
      : ["CRYPTO", "COMMODITIES"],
    crypto_basket: asStringArray(value.crypto_basket),
    commodities_basket: asStringArray(value.commodities_basket),
    sources: Array.isArray(value.sources)
      ? value.sources.filter(
          (x: unknown): x is "BINANCE" | "BYBIT" => x === "BINANCE" || x === "BYBIT",
        )
      : ["BINANCE", "BYBIT"],
    duration_seconds: asBigInt(value.duration_seconds),
    minimum_bet: asBigInt(value.minimum_bet),
    maximum_bet_per_wallet_per_market: asBigInt(value.maximum_bet_per_wallet_per_market),
    fee_bps: asBigInt(value.fee_bps),
    consensus_threshold: asBigInt(value.consensus_threshold),
    consensus_sources: asBigInt(value.consensus_sources),
    timezone: typeof value.timezone === "string" ? value.timezone : "UTC",
    settlement_grace_seconds: asBigInt(value.settlement_grace_seconds),
    settlement_retry_window_seconds: asBigInt(value.settlement_retry_window_seconds),
    max_page_size: asBigInt(value.max_page_size),
    max_markets: asBigInt(value.max_markets),
    max_positions: asBigInt(value.max_positions),
  };
}

export function normalizeEvidence(raw: unknown): SourceEvidence {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { ...value } as SourceEvidence;
}
