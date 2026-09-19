import { Link } from "@tanstack/react-router";
import { Search, Wallet } from "lucide-react";
import { useWallet } from "@/lib/rival/wallet";
import { normalizeError } from "@/lib/rival/errors";
import { shortAddress } from "@/lib/rival/format";
import { useState } from "react";

const nav = [
  { to: "/markets", label: "Markets" },
  { to: "/portfolio", label: "Portfolio" },
  { to: "/create", label: "Create Market" },
  { to: "/how-it-works", label: "How it works" },
] as const;

export function Header() {
  const wallet = useWallet();
  const [error, setError] = useState<string>();
  const onWallet = async () => {
    setError(undefined);
    try {
      if (!wallet.connected) await wallet.connect();
      else if (wallet.wrongNetwork) await wallet.switchNetwork();
      else wallet.disconnect();
    } catch (raw) {
      setError(normalizeError(raw, "wallet").message);
    }
  };
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-4 md:px-6">
        <Link to="/markets" className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-gold text-gold-foreground">
            <svg
              viewBox="0 0 24 24"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 18 10 6l4 8 2-4 4 8" />
            </svg>
          </span>
          <span className="text-[15px] font-semibold tracking-[0.18em]">RIVAL</span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="rounded-md px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              activeProps={{ className: "bg-accent text-foreground" }}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <label className="hidden h-8 items-center gap-2 rounded-md border border-border bg-card px-2.5 text-muted-foreground md:flex">
            <Search className="size-3.5" />
            <input
              placeholder="Search markets"
              className="w-36 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            <kbd className="rounded border border-border px-1 text-[10px]">/</kbd>
          </label>

          <span className="flex h-8 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-[12px] font-medium">
            <span className="size-1.5 rounded-full bg-live pulse-dot" />
            Studio Next
          </span>

          <button
            onClick={() => void onWallet()}
            className="flex h-8 items-center gap-2 rounded-md bg-gold px-3 text-[13px] font-semibold text-gold-foreground transition-opacity hover:opacity-90"
          >
            <Wallet className="size-3.5" />
            <span className="hidden sm:inline">
              {wallet.wrongNetwork
                ? "Switch Network"
                : wallet.connected
                  ? shortAddress(wallet.address)
                  : "Connect Wallet"}
            </span>
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-auto max-w-[1400px] px-4 pb-2 text-right text-xs text-down md:px-6">
          {error}
        </div>
      )}

      <nav className="flex gap-1 overflow-x-auto border-t border-border px-3 py-1.5 lg:hidden">
        {nav.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            className="whitespace-nowrap rounded-md px-2.5 py-1 text-[12px] font-medium text-muted-foreground"
            activeProps={{ className: "bg-accent text-foreground" }}
          >
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
