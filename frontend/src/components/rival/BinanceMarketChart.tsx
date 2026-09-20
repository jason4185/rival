import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useState } from "react";
import { Card } from "./ui";
import {
  BINANCE_ASSET_LABELS,
  type BinanceAsset,
  type BinanceChartView,
  formatBinancePercent,
  formatBinancePrice,
  formatBinanceUtc,
  useBinanceMarketFeed,
} from "@/lib/binance";
import { cn } from "@/lib/utils";

const chartViews: { value: BinanceChartView; label: string }[] = [
  { value: "BASKET", label: "Basket Race" },
  { value: "BTC", label: "BTC" },
  { value: "ETH", label: "ETH" },
  { value: "SOL", label: "SOL" },
  { value: "GOLD", label: "GOLD" },
  { value: "SILVER", label: "SILVER" },
  { value: "WTI_CRUDE", label: "WTI" },
];

const assetColors: Record<BinanceAsset, string> = {
  BTC: "#f4b942",
  ETH: "#a78bfa",
  SOL: "#5eead4",
  GOLD: "#f4b942",
  SILVER: "#cbd5e1",
  WTI_CRUDE: "#fb7185",
};

type ChartPoint = {
  timeMs: number;
  value: number;
  returnValue: number;
  price?: number;
  cryptoReturn: number;
  commoditiesReturn: number;
  cryptoValue: number;
  commoditiesValue: number;
};

export function BinanceMarketChart({
  marketStart,
  marketEnd,
}: {
  marketStart: bigint;
  marketEnd: bigint;
}) {
  const feed = useBinanceMarketFeed(marketStart, marketEnd);
  const [view, setView] = useState<BinanceChartView>("BASKET");
  const latest = feed.series.at(-1);
  const chartData: ChartPoint[] = feed.series.map((point) => {
    if (view === "BASKET") {
      return {
        timeMs: point.timeMs,
        value: point.cryptoReturn * 100,
        returnValue: point.cryptoReturn,
        cryptoReturn: point.cryptoReturn,
        commoditiesReturn: point.commoditiesReturn,
        cryptoValue: point.cryptoReturn * 100,
        commoditiesValue: point.commoditiesReturn * 100,
      };
    }
    return {
      timeMs: point.timeMs,
      value: point.prices[view],
      price: point.prices[view],
      returnValue: point.returns[view],
      cryptoReturn: point.cryptoReturn,
      commoditiesReturn: point.commoditiesReturn,
      cryptoValue: point.cryptoReturn * 100,
      commoditiesValue: point.commoditiesReturn * 100,
    };
  });
  const lineColor = view === "BASKET" ? "#f4b942" : assetColors[view];
  const statusLabel =
    feed.phase === "upcoming" ? "Upcoming" : feed.phase === "completed" ? "Completed" : "Live";

  return (
    <Card className="p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="label-caps">LIVE MARKET</span>
            <span className="text-xs text-muted-foreground">Binance</span>
          </div>
          <h2 className="mt-1 text-base font-semibold">Live basket race</h2>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">
            Indicative only · Final settlement requires Gate + Bitget consensus.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div>
            <span className="text-muted-foreground">Crypto </span>
            <span className="num text-crypto">{formatBinancePercent(latest?.cryptoReturn)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Commodities </span>
            <span className="num text-commodities">
              {formatBinancePercent(latest?.commoditiesReturn)}
            </span>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-1 text-muted-foreground">
            <span
              className={cn(
                "size-1.5 rounded-full",
                feed.phase === "live" && feed.socketConnected
                  ? "bg-live pulse-dot"
                  : "bg-muted-foreground",
              )}
            />
            {statusLabel}
          </span>
        </div>
      </div>

      <div className="mt-4 flex gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1">
        {chartViews.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setView(item.value)}
            className={cn(
              "h-8 shrink-0 whitespace-nowrap rounded-md px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
              view === item.value && "bg-accent text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="mt-4 h-[250px] w-full md:h-[270px]">
        {feed.phase === "upcoming" ? (
          <ChartMessage>Live chart starts when the market opens.</ChartMessage>
        ) : feed.status === "loading" && chartData.length === 0 ? (
          <ChartMessage>Loading Binance 1-minute history…</ChartMessage>
        ) : feed.status === "error" && chartData.length === 0 ? (
          <ChartMessage error onRetry={feed.retry}>
            Live Binance data is temporarily unavailable.
          </ChartMessage>
        ) : chartData.length === 0 ? (
          <ChartMessage>Waiting for valid Binance market data…</ChartMessage>
        ) : (
          <>
            {feed.error && (
              <div className="mb-2 flex items-center justify-between gap-3 rounded-md border border-gold/30 bg-gold-muted px-3 py-2 text-xs text-muted-foreground">
                <span>Live Binance data is temporarily unavailable.</span>
                <button type="button" onClick={feed.retry} className="text-foreground underline">
                  Retry
                </button>
              </div>
            )}
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                <CartesianGrid stroke="hsl(var(--border) / 0.45)" vertical={false} />
                <XAxis
                  dataKey="timeMs"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={formatBinanceUtc}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={32}
                />
                <YAxis
                  domain={["auto", "auto"]}
                  tickFormatter={(value: number) =>
                    view === "BASKET" ? `${value.toFixed(2)}%` : formatBinancePrice(value)
                  }
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={view === "BASKET" ? 48 : 68}
                />
                <Tooltip content={<BinanceTooltip view={view} />} />
                <Line
                  type="monotone"
                  dataKey={view === "BASKET" ? "cryptoValue" : "value"}
                  stroke={view === "BASKET" ? "#38bdf8" : lineColor}
                  strokeWidth={2.25}
                  dot={false}
                  activeDot={{
                    r: 4,
                    strokeWidth: 0,
                    fill: view === "BASKET" ? "#38bdf8" : lineColor,
                  }}
                  isAnimationActive={false}
                />
                {view === "BASKET" && (
                  <Line
                    type="monotone"
                    dataKey="commoditiesValue"
                    stroke="#fb7185"
                    strokeWidth={2.25}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0, fill: "#fb7185" }}
                    isAnimationActive={false}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          {view === "BASKET" ? "Return since market start" : `${BINANCE_ASSET_LABELS[view]} price`}
        </span>
        <span>UTC · 1m klines · Live Binance</span>
      </div>
    </Card>
  );
}

function BinanceTooltip({
  active,
  payload,
  view,
}: {
  active?: boolean;
  payload?: { payload?: ChartPoint }[];
  view: BinanceChartView;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 text-muted-foreground">{formatBinanceUtc(point.timeMs)} UTC</div>
      {view === "BASKET" ? (
        <>
          <div className="flex justify-between gap-5">
            <span className="text-crypto">Crypto</span>
            <span className="num">{formatBinancePercent(point.cryptoReturn)}</span>
          </div>
          <div className="flex justify-between gap-5">
            <span className="text-commodities">Commodities</span>
            <span className="num">{formatBinancePercent(point.commoditiesReturn)}</span>
          </div>
        </>
      ) : (
        <>
          <div className="flex justify-between gap-5">
            <span>{BINANCE_ASSET_LABELS[view]}</span>
            <span className="num">{formatBinancePrice(point.price)}</span>
          </div>
          <div className="flex justify-between gap-5 text-muted-foreground">
            <span>Return</span>
            <span className="num">{formatBinancePercent(point.returnValue)}</span>
          </div>
        </>
      )}
    </div>
  );
}

function ChartMessage({
  children,
  error = false,
  onRetry,
}: {
  children: string;
  error?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center rounded-lg border border-dashed border-border px-4 text-center text-sm text-muted-foreground">
      <span>{children}</span>
      {error && onRetry && (
        <button type="button" onClick={onRetry} className="mt-3 text-xs text-foreground underline">
          Retry
        </button>
      )}
    </div>
  );
}
