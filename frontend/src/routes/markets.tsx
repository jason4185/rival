import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { MarketCard, marketStatus } from "@/components/rival/MarketCard";
import { Page, PageTitle, Tabs, type MarketStatus } from "@/components/rival/ui";
import { useMarkets } from "@/lib/rival/hooks";

export const Route = createFileRoute("/markets")({
  head: () => ({
    meta: [
      { title: "Markets — RIVAL" },
      {
        name: "description",
        content:
          "1-hour Crypto vs Commodities prediction markets. Pick the basket that outperforms over the same UTC hour.",
      },
      { property: "og:title", content: "Markets — RIVAL" },
      { property: "og:description", content: "1-hour Crypto vs Commodities prediction markets." },
    ],
  }),
  component: MarketsPage,
});

type Tab = "all" | MarketStatus;

function MarketsPage() {
  const [tab, setTab] = useState<Tab>("all");
  const [cursor, setCursor] = useState(0n);
  const page = useMarkets(cursor, 50);
  const markets = useMemo(() => page.data?.items ?? [], [page.data?.items]);
  const list = useMemo(
    () => (tab === "all" ? markets : markets.filter((market) => marketStatus(market) === tab)),
    [markets, tab],
  );
  const count = (status: MarketStatus) =>
    markets.filter((market) => marketStatus(market) === status).length;

  return (
    <Page>
      <PageTitle
        title="Markets"
        subtitle="Crypto vs Commodities · 1-hour UTC windows · equal-average basket returns"
        right={
          <Link
            to="/create"
            className="flex h-9 items-center gap-2 rounded-md bg-gold px-3.5 text-[13px] font-semibold text-gold-foreground hover:opacity-90"
          >
            <Plus className="size-4" /> Create Market
          </Link>
        }
      />

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "all", label: "All", count: markets.length },
          { value: "open", label: "Open", count: count("open") },
          { value: "live", label: "Live", count: count("live") },
          { value: "ready", label: "Ready to Settle", count: count("ready") },
          { value: "resolved", label: "Resolved", count: count("resolved") },
        ]}
      />

      {page.loading && (
        <div className="card-surface mt-5 p-10 text-center text-sm text-muted-foreground">
          Loading markets…
        </div>
      )}
      {page.error && <ErrorState message={page.error.message} onRetry={() => void page.reload()} />}
      {!page.loading && !page.error && list.length === 0 && (
        <div className="card-surface mt-5 p-10 text-center text-sm text-muted-foreground">
          No markets in this state.
        </div>
      )}
      {!page.error && list.length > 0 && (
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((market) => (
            <MarketCard key={market.market_id.toString()} market={market} />
          ))}
        </div>
      )}

      {!page.error && page.data?.has_more && (
        <div className="mt-5 flex justify-center">
          <button
            onClick={() => setCursor(page.data?.next_cursor ?? 0n)}
            className="h-9 rounded-md border border-border-strong px-4 text-sm hover:bg-accent"
          >
            Load more
          </button>
        </div>
      )}
    </Page>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="card-surface mt-5 p-8 text-center">
      <p className="text-sm text-down">{message}</p>
      <button
        onClick={onRetry}
        className="mt-4 h-9 rounded-md border border-border-strong px-4 text-sm hover:bg-accent"
      >
        Retry
      </button>
    </div>
  );
}
