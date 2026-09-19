import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock } from "lucide-react";
import { Card, Page, PageTitle, SideTag } from "@/components/rival/ui";
import { useRivalConfig } from "@/lib/rival/hooks";
import { getMarkets } from "@/lib/rival/read";
import { formatUtc, formatHourWindow } from "@/lib/rival/format";
import { useRivalWrite } from "@/lib/rival/useWrite";
import { useWallet } from "@/lib/rival/wallet";
import { normalizeError } from "@/lib/rival/errors";
import { runPostWriteRefresh } from "@/lib/rival/write";

export const Route = createFileRoute("/create")({
  head: () => ({
    meta: [
      { title: "Create Market — RIVAL" },
      {
        name: "description",
        content: "Permissionlessly open the next exact UTC-hour RIVAL market.",
      },
    ],
  }),
  component: CreatePage,
});

function nextHour() {
  return BigInt(Math.floor(Date.now() / 3600_000) + 1) * 3600n;
}

function CreatePage() {
  const config = useRivalConfig();
  const wallet = useWallet();
  const write = useRivalWrite();
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string>();
  const [refreshError, setRefreshError] = useState<string>();
  const [createdId, setCreatedId] = useState<bigint>();
  const start = useMemo(() => BigInt(Math.floor(now / 3600_000) + 1) * 3600n, [now]);
  const end = start + 3600n;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const create = async () => {
    setError(undefined);
    setRefreshError(undefined);
    setCreatedId(undefined);
    try {
      const authoritativeStart = nextHour();
      const result = await write.submit("create_market", [authoritativeStart]);
      const page = await runPostWriteRefresh(
        () => getMarkets(0n, 50),
        (raw) =>
          setRefreshError(
            `Market creation completed, but the latest market list could not be refreshed. ${normalizeError(raw, "read").message}`,
          ),
      );
      if (page) {
        const created = page.items.find((market) => market.market_start === authoritativeStart);
        setCreatedId(created?.market_id);
        if (!created)
          setRefreshError(
            `Market creation completed, but the new market is not visible yet. Refresh Markets to see it. Transaction: ${result.txId}`,
          );
      }
    } catch (raw) {
      setError(normalizeError(raw, "write").message);
    }
  };

  return (
    <Page>
      <PageTitle
        title="Create Market"
        subtitle="Permissionless. Every market is Crypto vs Commodities over one exact UTC hour."
      />
      {config.error && (
        <Card className="mb-4 p-6 text-center">
          <p className="text-sm text-down">{config.error.message}</p>
          <button
            onClick={() => void config.reload()}
            className="mt-3 h-9 rounded-md border border-border-strong px-4 text-sm"
          >
            Retry
          </button>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card className="p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <CalendarDays className="size-4 text-gold" /> Next exact UTC hour
            </div>
            <div className="rounded-lg border border-gold/40 bg-gold-muted p-4">
              <div className="label-caps">Market starts</div>
              <div className="num mt-2 text-xl font-semibold">{formatUtc(start)}</div>
              <div className="num mt-1 text-sm text-muted-foreground">
                {formatHourWindow(start, end)}
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              The contract accepts exactly this upcoming UTC-hour start. Any later hour, including
              tomorrow, is rejected.
            </p>
          </Card>
          <Card className="p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Clock className="size-4 text-gold" /> Timing
            </div>
            <div className="space-y-2 text-sm">
              <Row
                k="Market duration"
                v={config.data ? `${config.data.duration_seconds.toString()} seconds` : "—"}
              />
              <Row
                k="Settlement ready"
                v={config.data ? formatUtc(end + config.data.settlement_grace_seconds) : "—"}
              />
              <Row
                k="Settlement deadline"
                v={config.data ? formatUtc(end + config.data.settlement_retry_window_seconds) : "—"}
              />
              <Row k="Creation fee" v={config.data ? "0 GEN" : "—"} />
            </div>
          </Card>
        </div>
        <div className="lg:sticky lg:top-20 lg:self-start">
          <Card className="p-4">
            <div className="label-caps">Preview</div>
            <div className="mt-2 text-base font-semibold">
              Crypto vs Commodities — who wins the hour?
            </div>
            <div className="num mt-1 text-sm text-muted-foreground">
              {formatHourWindow(start, end)}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-border bg-card-elevated p-3">
                <SideTag side="CRYPTO" />
                <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  <div>BTC</div>
                  <div>ETH</div>
                  <div>SOL</div>
                </div>
              </div>
              <div className="rounded-lg border border-border bg-card-elevated p-3">
                <SideTag side="COMMODITIES" />
                <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  <div>GOLD</div>
                  <div>SILVER</div>
                  <div>WTI_CRUDE</div>
                </div>
              </div>
            </div>
            <div className="mt-4 space-y-1.5 border-t border-border pt-3 text-xs">
              <Row k="Oracles" v={config.data ? "Binance + Bybit (2/2)" : "—"} />
              <Row k="Bets close" v={config.data ? formatUtc(start) : "—"} />
              <Row
                k="Finality grace"
                v={config.data ? `${config.data.settlement_grace_seconds.toString()} seconds` : "—"}
              />
            </div>
            {!wallet.connected ? (
              <p className="mt-4 text-center text-xs text-muted-foreground">
                Connect your wallet to create this market.
              </p>
            ) : wallet.wrongNetwork ? (
              <p className="mt-4 text-center text-xs text-down">
                Switch your wallet to GenLayer Studio Next to continue.
              </p>
            ) : (
              <button
                disabled={write.busy || config.loading || Boolean(config.error)}
                onClick={() => void create()}
                className="mt-4 h-11 w-full rounded-md bg-gold text-sm font-semibold text-gold-foreground hover:opacity-90 disabled:opacity-40"
              >
                {write.busy ? "Processing…" : "Create market"}
              </button>
            )}
            {error && (
              <p className="mt-3 rounded-md border border-down/30 bg-down/10 p-2 text-xs text-down">
                {error}
              </p>
            )}
            {refreshError && (
              <p className="mt-3 rounded-md border border-gold/30 bg-gold-muted p-2 text-xs text-muted-foreground">
                {refreshError}
              </p>
            )}
            {createdId !== undefined && (
              <p className="mt-3 text-xs text-up">
                Market created.{" "}
                <Link to="/market/$id" params={{ id: createdId.toString() }} className="underline">
                  Open market
                </Link>
              </p>
            )}
          </Card>
        </div>
      </div>
    </Page>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span className="num font-medium">{v}</span>
    </div>
  );
}
