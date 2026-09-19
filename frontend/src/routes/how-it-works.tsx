import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, BarChart3, CheckCircle2, Coins } from "lucide-react";
import { Card, Page, PageTitle, SideTag } from "@/components/rival/ui";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({
    meta: [
      { title: "How it works — RIVAL" },
      {
        name: "description",
        content:
          "Learn how RIVAL compares Crypto and Commodities over the same one-hour UTC window.",
      },
    ],
  }),
  component: HowItWorksPage,
});

const steps = [
  {
    number: "01",
    icon: BarChart3,
    title: "Choose the stronger market",
    body: "Predict which fixed basket will outperform over the hour: CRYPTO or COMMODITIES.",
  },
  {
    number: "02",
    icon: ArrowRight,
    title: "Both baskets compete for the same hour",
    body: "CRYPTO is BTC, ETH, and SOL. COMMODITIES is GOLD, SILVER, and WTI. Each side uses the equal-average percentage return of its three assets.",
  },
  {
    number: "03",
    icon: CheckCircle2,
    title: "Binance and Bybit verify the result",
    body: "Each source independently evaluates both baskets using the exact same one-hour candle. Both must choose the same side for 2/2 consensus.",
  },
  {
    number: "04",
    icon: Coins,
    title: "Winners share the pool",
    body: "When consensus settles a market, winning bettors share the total pool according to their stake.",
  },
] as const;

function HowItWorksPage() {
  return (
    <Page className="max-w-5xl">
      <PageTitle
        title="How RIVAL works"
        subtitle="One exact hour. Two fixed baskets. One directional winner."
      />

      <Card className="overflow-hidden">
        <div className="grid gap-px bg-border md:grid-cols-2">
          {steps.map(({ number, icon: Icon, title, body }) => (
            <div key={number} className="bg-card p-5 md:p-6">
              <div className="flex items-start justify-between gap-4">
                <span className="num text-xs text-gold">{number}</span>
                <Icon className="size-5 text-gold" />
              </div>
              <h2 className="mt-8 text-base font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mt-4 flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <div className="label-caps">The two sides</div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <SideTag side="CRYPTO" />
            <span className="text-sm text-muted-foreground">BTC · ETH · SOL</span>
            <span className="mx-1 text-muted-foreground">vs</span>
            <SideTag side="COMMODITIES" />
            <span className="text-sm text-muted-foreground">GOLD · SILVER · WTI</span>
          </div>
        </div>
        <div className="text-left sm:text-right">
          <div className="label-caps">Settlement rule</div>
          <div className="num mt-2 text-sm font-semibold text-gold">BINANCE + BYBIT · 2/2</div>
        </div>
      </Card>
    </Page>
  );
}
