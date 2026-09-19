import { formatUnits, parseUnits } from "viem";
import type { MarketState, Outcome } from "./types";
import { asBigInt } from "./normalize";

export function formatGen(value: bigint | string | number, maximumFractionDigits = 4) {
  const amount = asBigInt(value);
  const raw = formatUnits(amount, 18);
  const [whole, fraction = ""] = raw.split(".");
  const trimmed = fraction.slice(0, maximumFractionDigits).replace(/0+$/, "");
  return `${whole}${trimmed ? `.${trimmed}` : ""} GEN`;
}

export function parseGen(value: string) {
  return parseUnits(value.trim() || "0", 18);
}

export function formatUtc(seconds: bigint | string | number) {
  return (
    new Date(Number(asBigInt(seconds)) * 1000).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
      hour12: false,
    }) + " UTC"
  );
}

export function formatHourWindow(start: bigint | string | number, end?: bigint | string | number) {
  const s = new Date(Number(asBigInt(start)) * 1000);
  const e = new Date(Number(asBigInt(end ?? asBigInt(start) + 3600n)) * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(s.getUTCHours())}:00 – ${pad(e.getUTCHours())}:00 UTC`;
}

export function formatRelativeWindow(start: bigint | string | number) {
  return formatHourWindow(start);
}

export function formatReturn(numerator: unknown, denominator: unknown) {
  const n = asBigInt(numerator);
  const d = asBigInt(denominator);
  if (d === 0n) return "—";
  const sign = n < 0n ? "-" : "+";
  const abs = n < 0n ? -n : n;
  const scaled = (abs * 10000n) / d;
  const whole = scaled / 100n;
  const fraction = String(scaled % 100n).padStart(2, "0");
  return `${sign}${whole}.${fraction}%`;
}

export function displayState(
  state: MarketState,
  start: bigint,
  end: bigint,
  ready: bigint,
  now = BigInt(Math.floor(Date.now() / 1000)),
) {
  if (state === "SETTLED" || state === "INCONCLUSIVE") return "RESOLVED";
  if (state === "SETTLEMENT_PENDING") return "SETTLEMENT PENDING";
  if (now < start) return "OPEN";
  if (now < end) return "LIVE";
  if (now < ready) return "FINALIZING";
  return "READY TO SETTLE";
}

export function outcomeLabel(outcome: Outcome | "") {
  return outcome === "CRYPTO" ? "Crypto" : outcome === "COMMODITIES" ? "Commodities" : "None";
}

export function shortAddress(address?: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Not connected";
}
