import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export type Side = "CRYPTO" | "COMMODITIES";
export type MarketStatus = "open" | "live" | "ready" | "resolved" | "pending";

export const STATUS_LABEL: Record<MarketStatus, string> = {
  open: "Open",
  live: "Live",
  ready: "Ready to Settle",
  pending: "Settlement Pending",
  resolved: "Resolved",
};

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <main className={cn("mx-auto w-full max-w-[1400px] px-4 py-6 md:px-6 md:py-8", className)}>
      {children}
    </main>
  );
}

export function PageTitle({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("card-surface", className)}>{children}</div>;
}

export function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="label-caps">{label}</div>
      <div className={cn("num mt-2 text-2xl font-semibold", accent && "text-gold")}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

const statusStyles: Record<MarketStatus, string> = {
  open: "border-border-strong text-foreground",
  live: "border-live/40 bg-live/10 text-live",
  ready: "border-gold/40 bg-gold-muted text-gold",
  pending: "border-gold/40 bg-gold-muted text-gold",
  resolved: "border-border text-muted-foreground",
};

export function StatusBadge({ status, className }: { status: MarketStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium",
        statusStyles[status],
        className,
      )}
    >
      {(status === "live" || status === "pending") && (
        <span className="size-1.5 rounded-full bg-live pulse-dot" />
      )}
      {STATUS_LABEL[status]}
    </span>
  );
}

export function SideTag({ side, className }: { side: Side; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded px-1.5 text-[10px] font-semibold tracking-[0.1em]",
        side === "CRYPTO" ? "bg-crypto/15 text-crypto" : "bg-commodities/15 text-commodities",
        className,
      )}
    >
      {side}
    </span>
  );
}

export function Pct({
  value,
  className,
  digits = 2,
}: {
  value: number;
  className?: string;
  digits?: number;
}) {
  const tone = value > 0 ? "text-up" : value < 0 ? "text-down" : "text-muted-foreground";
  return (
    <span className={cn("num", tone, className)}>
      {value > 0 ? "+" : ""}
      {value.toFixed(digits)}%
    </span>
  );
}

export function PoolBar({
  crypto,
  commodities,
  className,
}: {
  crypto: bigint | number;
  commodities: bigint | number;
  className?: string;
}) {
  const cryptoValue = typeof crypto === "bigint" ? crypto : BigInt(Math.max(0, Math.trunc(crypto)));
  const commoditiesValue =
    typeof commodities === "bigint" ? commodities : BigInt(Math.max(0, Math.trunc(commodities)));
  const total = cryptoValue + commoditiesValue;
  const c = total === 0n ? 50 : Number((cryptoValue * 10000n) / total) / 100;
  return (
    <div className={cn("flex h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div className="bg-crypto" style={{ width: `${c}%` }} />
      <div className="bg-commodities" style={{ width: `${100 - c}%` }} />
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            "flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground",
            value === t.value && "bg-accent text-foreground",
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className="num text-[11px] text-muted-foreground">{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
