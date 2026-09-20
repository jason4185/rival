export type Outcome = "CRYPTO" | "COMMODITIES";
export type MarketState = "OPEN" | "SETTLEMENT_PENDING" | "SETTLED" | "INCONCLUSIVE";
export type SourceName = "GATE" | "BITGET";

export type Page<T> = {
  items: T[];
  next_cursor: bigint;
  has_more: boolean;
};

export type Market = {
  id: bigint;
  market_id: bigint;
  market_start: bigint;
  market_end: bigint;
  betting_close: bigint;
  settlement_ready: bigint;
  settlement_deadline: bigint;
  state: MarketState;
  winner: Outcome | "";
  reason: string;
  market_pool: bigint;
  total_pool: bigint;
  crypto_pool: bigint;
  commodities_pool: bigint;
  winning_pool: bigint;
  claimed_pool: bigint;
  refunded_pool: bigint;
  remaining_pool: bigint;
  settlement_available: boolean;
  deadline_expired: boolean;
  betting_open: boolean;
  crypto_basket: string[];
  commodities_basket: string[];
};

export type Position = {
  market_id: bigint;
  market_start: bigint;
  market_end: bigint;
  settlement_ready: bigint;
  settlement_deadline: bigint;
  has_position: boolean;
  selected_outcome: Outcome | "";
  user_outcome: Outcome | "";
  total_stake: bigint;
  user_stake: bigint;
  market_state: MarketState;
  state: MarketState;
  winner: Outcome | "";
  reason: string;
  market_pool: bigint;
  crypto_pool: bigint;
  commodities_pool: bigint;
  winning_pool: bigint;
  claimed_pool: bigint;
  refunded_pool: bigint;
  can_top_up: boolean;
  position_won: boolean;
  position_lost: boolean;
  claim_available: boolean;
  refund_available: boolean;
  already_claimed: boolean;
  claimed: boolean;
  refunded: boolean;
  claimable_amount: bigint;
  claim_type: "REFUND" | "WINNINGS" | "NONE";
};

export type RivalConfig = {
  protocol: string;
  outcomes: Outcome[];
  crypto_basket: string[];
  commodities_basket: string[];
  sources: SourceName[];
  duration_seconds: bigint;
  minimum_bet: bigint;
  maximum_bet_per_wallet_per_market: bigint;
  fee_bps: bigint;
  consensus_threshold: bigint;
  consensus_sources: bigint;
  timezone: string;
  settlement_grace_seconds: bigint;
  settlement_retry_window_seconds: bigint;
  max_page_size: bigint;
  max_markets: bigint;
  max_positions: bigint;
  [key: string]: unknown;
};

export type SourceAssetEvidence = {
  asset?: string;
  symbol?: string;
  open?: bigint;
  close?: bigint;
  return_numerator?: bigint;
  return_denominator?: bigint;
  [key: string]: unknown;
};

export type SourceEvidence = {
  source?: SourceName;
  source_status?: string;
  source_winner?: Outcome | "";
  status?: string;
  winner?: Outcome | "";
  assets?: SourceAssetEvidence[];
  [key: string]: unknown;
};
