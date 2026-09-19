# RIVAL

RIVAL is a one-hour GenLayer prediction market for the relative performance of a Crypto basket and a Commodities basket.

## What is RIVAL?

Each market compares two three-asset baskets. Users choose the basket they expect to perform better, and winning bettors share the market pool proportionally to their winning stake.

## The Two Baskets

**Crypto**

- BTC
- ETH
- SOL

**Commodities**

- GOLD
- SILVER
- WTI_CRUDE

## How a Market Works

1. Anyone may create only the next upcoming exact UTC-hour market.
2. Users choose CRYPTO or COMMODITIES before the market starts.
3. The market runs for exactly one hour.
4. Binance and Bybit independently calculate both basket returns.
5. Both sources must agree on the same winner.
6. Winning bettors share the pool pro rata.

## Winner Calculation

For each asset, the return is calculated as:

```text
(close - open) / open
```

Each basket is the equal-weight arithmetic average of its three asset returns. Binance calculates its own result and Bybit calculates its own result. Their prices are not averaged together. A winner is recorded only when both sources reach the same directional result.

## Settlement

Settlement is permissionless and opens 60 seconds after the market ends, allowing the exact one-hour candle to finalize. A disagreement, invalid source result, or validator disagreement leaves the market pending so settlement can be retried before the deadline.

The settlement deadline is 12 hours after market end. A settlement call at or after the deadline makes the market inconclusive, after which original stakes can be refunded. If a consensus winner has no stake while the market has funds, the market also becomes inconclusive with refunds.

## Betting

- Minimum stake: 1 GEN.
- Maximum cumulative stake: 15 GEN per wallet per market.
- A wallet may choose one side per market.
- Same-side top-ups are allowed.
- Side switching is not allowed.
- Betting closes exactly at `market_start`.
- The protocol fee is zero.

## Payouts

RIVAL uses pari-mutuel payouts. Winning bettors receive a share of the total pool proportional to their winning stake. Integer division is rounded down, and the final winning claimant receives the remaining pool so the winning pool is fully distributed. Inconclusive markets refund each bettor's original stake.

## Data Sources

Settlement uses Binance and Bybit. Each source independently evaluates BTC, ETH, SOL, GOLD, SILVER, and WTI_CRUDE over the market's exact one-hour window. Source evidence is stored with the settlement result.

The frontend also provides a live Binance basket visualization. It is indicative only and does not determine the winner, payouts, refunds, or settlement state. Final settlement remains the contract's Binance and Bybit consensus.

## Frontend

The frontend includes:

- Markets
- Market detail
- Portfolio
- Create Market
- How It Works
- Live Binance basket visualization
- Wallet connection and Transaction Kit contract writes

The contract is the source of truth for markets, positions, pools, settlement, claims, and refunds.

## GenLayer

GenLayer allows validators to independently fetch and verify the offchain market data used for settlement. RIVAL accepts a result only when the required source evidence and strict two-source consensus agree.

## Deployed Contract

- Network: GenLayer Studio Dev / Studio Next
- Chain ID: `61997`
- Contract: `0x24b89F05FDa1b10BF60Cc526f65Da74C8EB5d38d`
- Explorer: <https://explorer-studio-dev.genlayer.com/>

## Running Locally

```bash
cd frontend
bun install
bun run dev
```

The frontend also provides `bun run build` for a production build and `bun run lint` for linting.

## Repository Structure

```text
contracts/
  Rival.py
frontend/
README.md
```
