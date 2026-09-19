import { Link } from "@tanstack/react-router";
import { ArrowRight, Clock } from "lucide-react";
import { formatGen, formatHourWindow, formatUtc } from "@/lib/rival/format";
import type { Market } from "@/lib/rival/types";
import { Card, PoolBar, StatusBadge, type MarketStatus } from "./ui";

function statusFor(market: Market): MarketStatus {
  if (market.state === "SETTLED" || market.state === "INCONCLUSIVE") return "resolved";
  if (market.state === "SETTLEMENT_PENDING") return "pending";
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (now < market.market_start) return "open";
  if (now < market.market_end) return "live";
  return "ready";
}

export function marketStatus(market: Market) {
  return statusFor(market);
}

export function MarketCard({ market }: { market: Market }) {
  const status = statusFor(market);
  const total = market.crypto_pool + market.commodities_pool;
  return (
    <Card className="flex flex-col p-4 transition-colors hover:border-border-strong">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="label-caps">1H · MARKET {market.market_id.toString()}</div>
          <div className="mt-1 text-[15px] font-semibold">Crypto vs Commodities</div>
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <SideCell label="CRYPTO" tone="crypto" pool={market.crypto_pool} />
        <span className="text-[11px] font-semibold text-muted-foreground">VS</span>
        <SideCell label="COMMODITIES" tone="commodities" pool={market.commodities_pool} right />
      </div>

      <PoolBar crypto={market.crypto_pool} commodities={market.commodities_pool} className="mt-3" />

      <div className="mt-4 flex flex-col gap-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Clock className="size-3.5" />
          <span className="num">{formatHourWindow(market.market_start, market.market_end)}</span>
        </span>
        <span className="num">Starts {formatUtc(market.market_start)}</span>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
        <div>
          <div className="label-caps">Total pool</div>
          <div className="num text-sm font-semibold">{formatGen(total)}</div>
        </div>
        <Link
          to="/market/$id"
          params={{ id: market.market_id.toString() }}
          className="flex h-8 items-center gap-1.5 rounded-md border border-border-strong px-3 text-[13px] font-medium transition-colors hover:bg-accent"
        >
          View Market <ArrowRight className="size-3.5" />
        </Link>
      </div>
    </Card>
  );
}

function SideCell({
  label,
  tone,
  pool,
  right,
}: {
  label: string;
  tone: "crypto" | "commodities";
  pool: bigint;
  right?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border border-border bg-card-elevated p-3 ${right ? "text-right" : ""}`}
    >
      <div
        className={`text-[10px] font-semibold tracking-[0.12em] ${tone === "crypto" ? "text-crypto" : "text-commodities"}`}
      >
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold">—</div>
      <div className="num mt-0.5 text-[11px] text-muted-foreground">{formatGen(pool)} staked</div>
    </div>
  );
}
