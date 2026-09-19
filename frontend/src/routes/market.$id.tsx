import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, ExternalLink, ShieldCheck } from "lucide-react";
import {
  Card,
  Page,
  PoolBar,
  SideTag,
  StatusBadge,
  type MarketStatus,
} from "@/components/rival/ui";
import { useMarket, useMyPosition, useSourceEvidence } from "@/lib/rival/hooks";
import { BinanceMarketChart } from "@/components/rival/BinanceMarketChart";
import { refreshMarket, refreshMyPosition } from "@/lib/rival/read";
import {
  formatGen,
  formatHourWindow,
  formatReturn,
  formatUtc,
  parseGen,
  outcomeLabel,
} from "@/lib/rival/format";
import { useWallet } from "@/lib/rival/wallet";
import { useRivalWrite } from "@/lib/rival/useWrite";
import { runPostWriteRefresh, settlementBusinessMessage } from "@/lib/rival/write";
import { normalizeError } from "@/lib/rival/errors";
import type { Market, Outcome, Position, SourceEvidence, SourceName } from "@/lib/rival/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/market/$id")({
  head: () => ({
    meta: [
      { title: "Market · RIVAL" },
      { name: "description", content: "Live RIVAL market state from the deployed contract." },
    ],
  }),
  component: MarketDetail,
});

function MarketDetail() {
  const rawId = Route.useParams().id;
  const marketId = useMemo(() => (/^\d+$/.test(rawId) ? BigInt(rawId) : undefined), [rawId]);
  const market = useMarket(marketId);
  const wallet = useWallet();
  const position = useMyPosition(wallet.address, marketId);
  const [showEvidence, setShowEvidence] = useState(false);

  useEffect(() => {
    if (!market.data || market.data.state === "SETTLED" || market.data.state === "INCONCLUSIVE")
      return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void market.reload();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [market.data?.state, market.reload]);

  if (marketId === undefined)
    return (
      <Page>
        <ErrorState message="This market ID is invalid." />
      </Page>
    );
  if (market.initialLoading)
    return (
      <Page>
        <div className="card-surface p-10 text-center text-sm text-muted-foreground">
          Loading market…
        </div>
      </Page>
    );
  if (!market.data)
    return (
      <Page>
        <ErrorState
          message={
            market.error?.message ?? "We couldn't load this market right now. Please try again."
          }
          onRetry={() => void market.reload()}
        />
      </Page>
    );

  const m = market.data;
  const status = marketStatus(m);
  return (
    <MarketContent
      market={m}
      status={status}
      position={position.data}
      positionLoading={position.loading}
      positionError={position.error?.message}
      showEvidence={showEvidence}
      setShowEvidence={setShowEvidence}
      reloadMarket={market.reload}
      reloadPosition={position.reload}
    />
  );
}

function MarketContent({
  market: m,
  status,
  position,
  positionLoading,
  positionError,
  showEvidence,
  setShowEvidence,
  reloadMarket,
  reloadPosition,
}: {
  market: Market;
  status: MarketStatus;
  position: Position | undefined;
  positionLoading: boolean;
  positionError: string | undefined;
  showEvidence: boolean;
  setShowEvidence: (value: boolean) => void;
  reloadMarket: () => Promise<void>;
  reloadPosition: () => Promise<void>;
}) {
  const wallet = useWallet();
  const write = useRivalWrite();
  const [side, setSide] = useState<Outcome>(position?.user_outcome || "CRYPTO");
  const [amount, setAmount] = useState("1");
  const [actionError, setActionError] = useState<string>();
  const [refreshError, setRefreshError] = useState<string>();
  const [settlementFeedback, setSettlementFeedback] = useState<string>();
  const [evidenceSource, setEvidenceSource] = useState<SourceName>("BINANCE");
  const evidence = useSourceEvidence(
    m.market_id,
    evidenceSource,
    showEvidence &&
      (m.state === "SETTLED" || m.state === "INCONCLUSIVE" || m.state === "SETTLEMENT_PENDING"),
  );
  const totalPool = m.crypto_pool + m.commodities_pool;
  const opposite = Boolean(position?.user_outcome && position.user_outcome !== side);
  const positionUnavailable = wallet.connected && (positionLoading || Boolean(positionError));

  useEffect(() => {
    if (position?.user_outcome) setSide(position.user_outcome);
  }, [position?.user_outcome]);

  const bet = async () => {
    setActionError(undefined);
    setRefreshError(undefined);
    try {
      const value = parseGen(amount);
      if (value < 1_000_000_000_000_000_000n) throw new Error("minimum bet is 1 GEN");
      const freshMarket = await refreshMarket(m.market_id);
      if (!freshMarket.betting_open) throw new Error("betting is closed");
      const freshPosition = wallet.address
        ? await refreshMyPosition(m.market_id, wallet.address)
        : position;
      if (freshPosition?.user_outcome && freshPosition.user_outcome !== side)
        throw new Error("wallet outcome already selected");
      if ((freshPosition?.user_stake ?? 0n) + value > 15_000_000_000_000_000_000n)
        throw new Error("maximum cumulative stake is 15 GEN");
      await write.submit("place_bet", [m.market_id, side], value);
      await runPostWriteRefresh(
        async () => {
          await refreshMarket(m.market_id);
          await Promise.all([reloadMarket(), reloadPosition()]);
        },
        (raw) => setRefreshError(normalizeError(raw, "read").message),
      );
    } catch (raw) {
      setActionError(normalizeError(raw, "write").message);
    }
  };

  const settle = async () => {
    setActionError(undefined);
    setRefreshError(undefined);
    setSettlementFeedback(undefined);
    try {
      const fresh = await refreshMarket(m.market_id);
      if (!fresh.settlement_available)
        throw new Error(
          fresh.state === "OPEN" && fresh.settlement_ready > BigInt(Math.floor(Date.now() / 1000))
            ? "settlement is not ready; candle finalization grace is active"
            : "market has not ended",
        );
      await write.submit("settle_market", [m.market_id]);
      const refreshed = await runPostWriteRefresh(
        async () => {
          const next = await refreshMarket(m.market_id);
          await Promise.all([reloadMarket(), reloadPosition()]);
          return next;
        },
        (raw) => setRefreshError(normalizeError(raw, "read").message),
      );
      if (refreshed) {
        setSettlementFeedback(settlementBusinessMessage(refreshed.state));
      }
    } catch (raw) {
      setActionError(normalizeError(raw, "write").message);
    }
  };

  return (
    <Page>
      <Link
        to="/markets"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> All markets
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="label-caps">MARKET {m.market_id.toString()} · 1H</span>
            <StatusBadge status={status} />
          </div>
          <h1 className="mt-2 text-xl font-semibold tracking-tight md:text-2xl">
            Crypto vs Commodities — who wins the hour?
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Window{" "}
            <span className="num text-foreground">
              {formatHourWindow(m.market_start, m.market_end)}
            </span>{" "}
            · starts {formatUtc(m.market_start)}
          </p>
        </div>
        <div className="text-right">
          <div className="label-caps">Total pool</div>
          <div className="num text-xl font-semibold text-gold">{formatGen(totalPool)}</div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="space-y-4">
          <BinanceMarketChart marketStart={m.market_start} marketEnd={m.market_end} />
          <div className="grid gap-4 md:grid-cols-2">
            <OutcomeCard market={m} side="CRYPTO" />
            <OutcomeCard market={m} side="COMMODITIES" />
          </div>
          <Card className="p-4">
            <div className="mb-3">
              <div className="label-caps">Settlement result</div>
              <div className="text-sm font-medium">Exact 1H candle result from the contract</div>
            </div>
            {m.state === "SETTLED" ? (
              <div className="rounded-lg border border-gold/40 bg-gold-muted p-4 text-sm">
                Winner: <strong>{outcomeLabel(m.winner)}</strong>
              </div>
            ) : m.state === "INCONCLUSIVE" ? (
              <div className="rounded-lg border border-border p-4 text-sm">
                Inconclusive{m.reason ? ` · ${m.reason}` : ""}. Original stakes are refundable.
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                Settlement evidence is not available until the market reaches a terminal settlement
                result.
              </div>
            )}
          </Card>
          <Card className="p-4">
            <div className="label-caps mb-3">Pool composition</div>
            <PoolBar crypto={m.crypto_pool} commodities={m.commodities_pool} className="h-2" />
            <div className="mt-2 flex justify-between text-xs">
              <span className="num text-crypto">{formatGen(m.crypto_pool)}</span>
              <span className="num text-commodities">{formatGen(m.commodities_pool)}</span>
            </div>
            <div className="mt-4 grid gap-2 text-xs">
              <Row k="Market end" v={formatUtc(m.market_end)} />
              <Row k="Settlement ready" v={formatUtc(m.settlement_ready)} />
              <Row k="Settlement deadline" v={formatUtc(m.settlement_deadline)} />
              <Row
                k="Claimed / refunded"
                v={`${formatGen(m.claimed_pool)} / ${formatGen(m.refunded_pool)}`}
              />
            </div>
          </Card>
          {(m.state === "SETTLED" ||
            m.state === "INCONCLUSIVE" ||
            m.state === "SETTLEMENT_PENDING") && (
            <EvidenceSection
              show={showEvidence}
              setShow={setShowEvidence}
              source={evidenceSource}
              setSource={setEvidenceSource}
              evidence={evidence.data}
              loading={evidence.loading}
              error={evidence.error?.message}
            />
          )}
        </div>

        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card className="p-4">
            {m.betting_open ? (
              positionUnavailable ? (
                <div className="rounded-md border border-border p-3 text-sm text-muted-foreground">
                  {positionLoading
                    ? "Loading your position…"
                    : (positionError ?? "Your position is unavailable right now. Please retry.")}
                </div>
              ) : (
                <>
                  <div className="label-caps">Place prediction</div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {(["CRYPTO", "COMMODITIES"] as Outcome[]).map((outcome) => (
                      <button
                        key={outcome}
                        disabled={Boolean(
                          position?.user_outcome && position.user_outcome !== outcome,
                        )}
                        onClick={() => setSide(outcome)}
                        className={cn(
                          "h-10 rounded-md border text-[12px] font-semibold tracking-[0.08em]",
                          side === outcome
                            ? outcome === "CRYPTO"
                              ? "border-crypto/50 bg-crypto/15 text-crypto"
                              : "border-commodities/50 bg-commodities/15 text-commodities"
                            : "border-border text-muted-foreground hover:border-border-strong",
                          Boolean(position?.user_outcome && position.user_outcome !== outcome) &&
                            "cursor-not-allowed opacity-40",
                        )}
                      >
                        {outcome}
                      </button>
                    ))}
                  </div>
                  <div className="mt-4">
                    <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                      <span>Amount</span>
                      <span className="num">GEN · minimum 1 · maximum cumulative 15</span>
                    </div>
                    <div className="flex h-11 items-center rounded-md border border-input bg-card-elevated px-3">
                      <input
                        value={amount}
                        onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))}
                        className="num w-full bg-transparent text-lg outline-none"
                        inputMode="decimal"
                      />
                      <span className="text-xs font-medium text-muted-foreground">GEN</span>
                    </div>
                  </div>
                  {position?.user_outcome && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      You selected {outcomeLabel(position.user_outcome)}. Same-side top-ups remain
                      available.
                    </p>
                  )}
                  <button
                    disabled={write.busy || opposite}
                    onClick={() => void bet()}
                    className="mt-4 h-11 w-full rounded-md bg-gold text-sm font-semibold text-gold-foreground hover:opacity-90 disabled:opacity-40"
                  >
                    {write.busy ? phaseLabel(write.phase) : `Predict ${outcomeLabel(side)}`}
                  </button>
                </>
              )
            ) : (
              <SettlementPanel
                market={m}
                onSettle={() => void settle()}
                busy={write.busy}
                phase={write.phase}
              />
            )}
            {actionError && (
              <p className="mt-3 rounded-md border border-down/30 bg-down/10 p-2 text-xs text-down">
                {actionError}
              </p>
            )}
            {refreshError && (
              <p className="mt-3 rounded-md border border-gold/30 bg-gold-muted p-2 text-xs text-muted-foreground">
                Transaction completed, but the latest market state could not be refreshed. Please
                retry the page.
              </p>
            )}
            {settlementFeedback && (
              <p className="mt-3 rounded-md border border-success/30 bg-success/10 p-2 text-xs text-success">
                {settlementFeedback}
              </p>
            )}
            {write.result && (
              <p className="mt-3 text-xs text-up">
                Confirmed.{" "}
                <a
                  href={write.result.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 underline"
                >
                  View transaction <ExternalLink className="size-3" />
                </a>
              </p>
            )}
          </Card>
          <Card className="p-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-2 text-foreground">
              <ShieldCheck className="size-4 text-gold" />
              <span className="font-medium">Settlement rules</span>
            </div>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              <li>Both baskets use the exact same 1H UTC candle.</li>
              <li>Each source calculates both equal-average basket returns.</li>
              <li>Binance and Bybit must agree 2/2.</li>
              <li>Winners share the full pool pro-rata to stake.</li>
            </ul>
          </Card>
        </div>
      </div>
    </Page>
  );
}

function OutcomeCard({ market, side }: { market: Market; side: Outcome }) {
  const pool = side === "CRYPTO" ? market.crypto_pool : market.commodities_pool;
  const assets = side === "CRYPTO" ? market.crypto_basket : market.commodities_basket;
  const winner = market.winner === side;
  return (
    <Card className={cn("p-5", winner && "border-border-strong shadow-gold")}>
      <div className="flex items-center justify-between">
        <SideTag side={side} />
        {winner && (
          <span className="flex items-center gap-1 text-[11px] font-medium text-gold">
            <CheckCircle2 className="size-3.5" /> Winner
          </span>
        )}
      </div>
      <div className="mt-3 text-4xl font-semibold">
        <span className="num text-muted-foreground">—</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        Exact source returns appear in settlement evidence.
      </div>
      <div className="mt-4 space-y-1.5 border-t border-border pt-4">
        {assets.map((asset) => (
          <div key={asset} className="flex items-center justify-between text-sm">
            <span
              className={cn(
                "num text-[13px] font-semibold",
                side === "CRYPTO" ? "text-crypto" : "text-commodities",
              )}
            >
              {asset}
            </span>
            <span className="num text-muted-foreground">—</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs">
        <span className="text-muted-foreground">Side pool</span>
        <span className="num font-semibold">{formatGen(pool)}</span>
      </div>
    </Card>
  );
}

function SettlementPanel({
  market,
  onSettle,
  busy,
  phase,
}: {
  market: Market;
  onSettle: () => void;
  busy: boolean;
  phase: string;
}) {
  if (market.state === "SETTLED")
    return (
      <>
        <div className="label-caps">Settled</div>
        <div className="mt-2 text-sm">
          Winner: <strong>{outcomeLabel(market.winner)}</strong>
        </div>
      </>
    );
  if (market.state === "INCONCLUSIVE")
    return (
      <>
        <div className="label-caps">Refunds available</div>
        <div className="mt-2 text-sm">
          This market is inconclusive. Eligible bettors can claim their original stake.
        </div>
      </>
    );
  if (market.state === "SETTLEMENT_PENDING")
    return (
      <>
        <div className="label-caps">Settlement pending</div>
        <div className="mt-2 text-sm text-muted-foreground">
          Consensus did not agree yet. Settlement can be retried before the deadline.
        </div>
        <button
          disabled={busy}
          onClick={onSettle}
          className="mt-4 h-11 w-full rounded-md bg-gold text-sm font-semibold text-gold-foreground disabled:opacity-40"
        >
          {busy ? phaseLabel(phase) : "Retry settlement"}
        </button>
      </>
    );
  return (
    <>
      <div className="label-caps">Settlement</div>
      <div className="mt-2 text-sm text-muted-foreground">
        {market.settlement_available
          ? "The exact candle is ready to settle."
          : `Settlement opens at ${formatUtc(market.settlement_ready)}.`}
      </div>
      <button
        disabled={!market.settlement_available || busy}
        onClick={onSettle}
        className="mt-4 h-11 w-full rounded-md bg-gold text-sm font-semibold text-gold-foreground disabled:opacity-40"
      >
        {busy ? phaseLabel(phase) : "Settle market"}
      </button>
    </>
  );
}

function EvidenceSection({
  show,
  setShow,
  source,
  setSource,
  evidence,
  loading,
  error,
}: {
  show: boolean;
  setShow: (show: boolean) => void;
  source: SourceName;
  setSource: (source: SourceName) => void;
  evidence: SourceEvidence | undefined;
  loading: boolean;
  error: string | undefined;
}) {
  const assets = evidence?.assets ?? [];
  const winner = evidence?.source_winner ?? evidence?.winner ?? "";
  const status = evidence?.source_status ?? evidence?.status ?? "";
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="label-caps">Source evidence</div>
          <div className="text-sm font-medium">Validator-matched exact source data</div>
        </div>
        <button
          onClick={() => setShow(!show)}
          className="rounded-md border border-border-strong px-3 py-1.5 text-xs"
        >
          {show ? "Hide" : "Show evidence"}
        </button>
      </div>
      {show && (
        <>
          <div className="mt-4 flex gap-2">
            {(["BINANCE", "BYBIT"] as SourceName[]).map((item) => (
              <button
                key={item}
                onClick={() => setSource(item)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-xs",
                  source === item ? "border-gold/50 bg-gold-muted" : "border-border",
                )}
              >
                {item}
              </button>
            ))}
          </div>
          {loading && <div className="mt-4 text-sm text-muted-foreground">Loading evidence…</div>}
          {error && <div className="mt-4 text-sm text-muted-foreground">{error}</div>}
          {evidence && (
            <>
              <div className="mt-4 grid gap-2 text-xs">
                <Row k="Status" v={status || "—"} />
                <Row k="Source winner" v={winner ? outcomeLabel(winner) : "Tie / unavailable"} />
              </div>
              {assets.length > 0 && (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-muted-foreground">
                      <tr>
                        <th className="pb-2">Asset</th>
                        <th className="pb-2">Open</th>
                        <th className="pb-2">Close</th>
                        <th className="pb-2">Return</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assets.map((asset, index) => (
                        <tr
                          key={`${asset.symbol ?? asset.asset ?? "asset"}-${index}`}
                          className="border-t border-border"
                        >
                          <td className="py-2 font-medium">{asset.symbol ?? asset.asset ?? "—"}</td>
                          <td className="num py-2">{String(asset.open ?? "—")}</td>
                          <td className="num py-2">{String(asset.close ?? "—")}</td>
                          <td className="num py-2">
                            {asset.return_numerator !== undefined &&
                            asset.return_denominator !== undefined
                              ? formatReturn(asset.return_numerator, asset.return_denominator)
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <details className="mt-4">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  Show exact evidence
                </summary>
                <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-card-elevated p-3 text-xs leading-5 text-muted-foreground">
                  {JSON.stringify(
                    evidence,
                    (_, value) => (typeof value === "bigint" ? value.toString() : value),
                    2,
                  )}
                </pre>
              </details>
            </>
          )}
        </>
      )}
    </Card>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span className="num font-medium">{v}</span>
    </div>
  );
}
function phaseLabel(phase: string) {
  return phase === "wallet"
    ? "Waiting for wallet…"
    : phase === "submitted"
      ? "Submitted…"
      : phase === "consensus"
        ? "Consensus in progress…"
        : phase === "finalizing"
          ? "Finalizing…"
          : "Preparing…";
}
function marketStatus(market: Market): MarketStatus {
  if (market.state === "SETTLED" || market.state === "INCONCLUSIVE") return "resolved";
  if (market.state === "SETTLEMENT_PENDING") return "pending";
  const now = BigInt(Math.floor(Date.now() / 1000));
  return now < market.market_start ? "open" : now < market.market_end ? "live" : "ready";
}
function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card-surface p-8 text-center">
      <p className="text-sm text-down">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 h-9 rounded-md border border-border-strong px-4 text-sm"
        >
          Retry
        </button>
      )}
    </div>
  );
}
