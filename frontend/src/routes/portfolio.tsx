import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Card,
  Page,
  PageTitle,
  SideTag,
  Stat,
  StatusBadge,
  Tabs,
  type MarketStatus,
} from "@/components/rival/ui";
import { useUserPositions } from "@/lib/rival/hooks";
import { formatGen, formatHourWindow, outcomeLabel } from "@/lib/rival/format";
import { useWallet } from "@/lib/rival/wallet";
import { useRivalWrite } from "@/lib/rival/useWrite";
import { normalizeError } from "@/lib/rival/errors";
import type { Position } from "@/lib/rival/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/portfolio")({
  head: () => ({
    meta: [
      { title: "Portfolio — RIVAL" },
      { name: "description", content: "Your positions from the deployed RIVAL contract." },
    ],
  }),
  component: PortfolioPage,
});

type Tab = "active" | "claimable" | "history";

function PortfolioPage() {
  const wallet = useWallet();
  const [tab, setTab] = useState<Tab>("active");
  const [cursor, setCursor] = useState(0n);
  const positions = useUserPositions(wallet.address, cursor, 50);
  const items = positions.data?.items ?? [];
  const active = items.filter(
    (item) => item.state === "OPEN" || item.state === "SETTLEMENT_PENDING",
  );
  const claimable = items.filter((item) => item.claim_available || item.refund_available);
  const history = items.filter((item) => item.state === "SETTLED" || item.state === "INCONCLUSIVE");
  const list = tab === "active" ? active : tab === "claimable" ? claimable : history;
  const staked = active.reduce((sum, item) => sum + item.user_stake, 0n);
  const claim = claimable.reduce((sum, item) => sum + item.claimable_amount, 0n);

  if (!wallet.connected)
    return (
      <Page>
        <PageTitle
          title="Portfolio"
          subtitle="Connect a wallet to read your positions from RIVAL."
        />
        <Card className="p-10 text-center">
          <p className="text-sm text-muted-foreground">Connect your wallet to continue.</p>
        </Card>
      </Page>
    );
  if (wallet.wrongNetwork)
    return (
      <Page>
        <PageTitle title="Portfolio" subtitle="Your wallet is connected to another network." />
        <Card className="p-10 text-center">
          <p className="text-sm text-down">
            Switch your wallet to GenLayer Studio Next to continue.
          </p>
          <button
            onClick={() => void wallet.switchNetwork()}
            className="mt-4 h-9 rounded-md bg-gold px-4 text-sm font-semibold"
          >
            Switch Network
          </button>
        </Card>
      </Page>
    );

  return (
    <Page>
      <PageTitle
        title="Portfolio"
        subtitle={`Positions held by ${wallet.address?.slice(0, 6)}…${wallet.address?.slice(-4)}`}
      />
      {positions.error && (
        <Card className="mb-4 p-6 text-center">
          <p className="text-sm text-down">{positions.error.message}</p>
          <button
            onClick={() => void positions.reload()}
            className="mt-3 h-9 rounded-md border border-border-strong px-4 text-sm"
          >
            Retry
          </button>
        </Card>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Total staked" value={formatGen(staked)} hint="On this page" />
        <Stat
          label="Claimable"
          value={formatGen(claim)}
          hint={`${claimable.length} positions ready`}
          accent
        />
        <Stat label="Active positions" value={active.length} hint="On this page" />
        <Stat label="Settled positions" value={history.length} hint="On this page" />
      </div>
      <div className="mt-6">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "active", label: "Active", count: active.length },
            { value: "claimable", label: "Claimable", count: claimable.length },
            { value: "history", label: "History", count: history.length },
          ]}
        />
      </div>
      {positions.loading && (
        <div className="card-surface mt-4 p-8 text-center text-sm text-muted-foreground">
          Loading positions…
        </div>
      )}
      {!positions.loading && !positions.error && list.length === 0 && (
        <div className="card-surface mt-4 p-8 text-center text-sm text-muted-foreground">
          No positions in this view.
        </div>
      )}
      {!positions.error && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {list.map((position) => (
            <PositionCard
              key={position.market_id.toString()}
              position={position}
              onDone={() => void positions.reload()}
            />
          ))}
        </div>
      )}
      {!positions.error && positions.data?.has_more && (
        <div className="mt-5 flex justify-center">
          <button
            onClick={() => setCursor(positions.data?.next_cursor ?? 0n)}
            className="h-9 rounded-md border border-border-strong px-4 text-sm"
          >
            Load more
          </button>
        </div>
      )}
    </Page>
  );
}

function PositionCard({ position: p, onDone }: { position: Position; onDone: () => void }) {
  const write = useRivalWrite();
  const [error, setError] = useState<string>();
  const status: MarketStatus =
    p.state === "SETTLED" || p.state === "INCONCLUSIVE"
      ? "resolved"
      : p.state === "SETTLEMENT_PENDING"
        ? "pending"
        : "live";
  const action = async (method: "claim" | "claim_refund") => {
    setError(undefined);
    try {
      await write.submit(method, [p.market_id]);
      onDone();
    } catch (raw) {
      setError(normalizeError(raw, "write").message);
    }
  };
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="label-caps">MARKET {p.market_id.toString()}</div>
          <div className="mt-1 text-sm font-semibold">Crypto vs Commodities</div>
          <div className="num mt-0.5 text-xs text-muted-foreground">
            {formatHourWindow(p.market_start, p.market_end)}
          </div>
        </div>
        <StatusBadge status={status} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-3">
        <div>
          <div className="label-caps">Side</div>
          <div className="mt-1">
            <SideTag side={p.user_outcome || "CRYPTO"} />
          </div>
        </div>
        <div>
          <div className="label-caps">Stake</div>
          <div className="num mt-1 text-sm font-semibold">{formatGen(p.user_stake)}</div>
        </div>
        <div>
          <div className="label-caps">Position</div>
          <div
            className={cn(
              "mt-1 text-sm font-semibold",
              p.position_won && "text-up",
              p.position_lost && "text-down",
            )}
          >
            {p.position_won
              ? "Won"
              : p.position_lost
                ? "Lost"
                : p.state === "INCONCLUSIVE"
                  ? "Refundable"
                  : "Active"}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
        <span
          className={cn(
            "text-xs font-medium",
            p.claim_available || p.refund_available ? "text-gold" : "text-muted-foreground",
          )}
        >
          {p.claim_available
            ? `Claim ${formatGen(p.claimable_amount)}`
            : p.refund_available
              ? `Refund ${formatGen(p.claimable_amount)}`
              : p.claimed
                ? "Claimed"
                : p.refunded
                  ? "Refunded"
                  : `Winner: ${outcomeLabel(p.winner)}`}
        </span>
        {p.claim_available ? (
          <button
            disabled={write.busy}
            onClick={() => void action("claim")}
            className="h-8 rounded-md bg-gold px-3 text-[12px] font-semibold text-gold-foreground disabled:opacity-40"
          >
            {write.busy ? "Processing…" : "Claim"}
          </button>
        ) : p.refund_available ? (
          <button
            disabled={write.busy}
            onClick={() => void action("claim_refund")}
            className="h-8 rounded-md bg-gold px-3 text-[12px] font-semibold text-gold-foreground disabled:opacity-40"
          >
            {write.busy ? "Processing…" : "Refund"}
          </button>
        ) : (
          <Link
            to="/market/$id"
            params={{ id: p.market_id.toString() }}
            className="h-8 rounded-md border border-border-strong px-3 text-[12px] font-medium leading-8 hover:bg-accent"
          >
            View
          </Link>
        )}
      </div>
      {error && <p className="mt-3 text-xs text-down">{error}</p>}
    </Card>
  );
}
