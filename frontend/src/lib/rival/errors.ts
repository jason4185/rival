export type RivalErrorKind = "read" | "write" | "wallet" | "network" | "rate_limit" | "execution";

export class RivalError extends Error {
  readonly kind: RivalErrorKind;
  readonly technicalMessage: string;
  readonly retryable: boolean;

  constructor(
    message: string,
    kind: RivalErrorKind = "read",
    technicalMessage = message,
    retryable = false,
  ) {
    super(message);
    this.name = "RivalError";
    this.kind = kind;
    this.technicalMessage = technicalMessage;
    this.retryable = retryable;
  }
}

export function extractErrorMessage(error: unknown): string {
  const seen = new Set<unknown>();
  const visit = (value: unknown): string => {
    if (value === null || value === undefined || seen.has(value)) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "bigint") return String(value);
    if (typeof value !== "object") return "";
    seen.add(value);
    const record = value as Record<string, unknown>;
    for (const key of ["shortMessage", "message", "details", "reason", "error", "data", "cause"]) {
      const result = visit(record[key]);
      if (result) return result;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return "Unknown error";
    }
  };
  return visit(error) || "Unknown error";
}

function friendlyContractMessage(message: string): string | undefined {
  const lower = message.toLowerCase();
  const mappings: Array<[string, string]> = [
    [
      "market start must be next utc hour",
      "This market can only be created for the next UTC hour.",
    ],
    ["market already exists", "This hourly market already exists."],
    ["maximum market count reached", "No more markets can be created in this deployment."],
    ["minimum bet is 1 gen", "Minimum bet is 1 GEN."],
    ["maximum cumulative stake is 15 gen", "You can stake up to 15 GEN on this market."],
    ["wallet outcome already selected", "You already chose the other side for this market."],
    ["betting is closed", "Betting for this market has closed."],
    ["market is not open", "This market is no longer open."],
    ["market has not ended", "This market hasn't ended yet."],
    [
      "settlement is not ready; candle finalization grace is active",
      "Settlement opens 60 seconds after the market ends.",
    ],
    ["market is not settled", "This market hasn't settled yet."],
    ["not a winning bettor", "Only winning positions can claim a payout."],
    ["payout already claimed", "You've already claimed this payout."],
    ["market is not inconclusive", "This market isn't refundable."],
    ["refund already claimed", "You've already claimed this refund."],
    ["position already claimed", "This position has already been claimed."],
    ["position already refunded", "This position has already been refunded."],
    ["no bettor stake", "You don't have a stake in this market."],
    ["source evidence unavailable", "Settlement evidence isn't available yet."],
    ["page limit exceeded", "That page size is not available."],
  ];
  return mappings.find(([needle]) => lower.includes(needle))?.[1];
}

export function normalizeError(error: unknown, kind: RivalErrorKind = "read"): RivalError {
  if (error instanceof RivalError) return error;
  const technical = extractErrorMessage(error);
  const lower = technical.toLowerCase();
  if (
    lower.includes("429") ||
    lower.includes("too many requests") ||
    lower.includes("rate limit")
  ) {
    return new RivalError("The network is busy. Retrying shortly…", "rate_limit", technical, true);
  }
  if (
    lower.includes("user rejected") ||
    lower.includes("user denied") ||
    lower.includes("4001") ||
    lower.includes("cancelled")
  ) {
    return new RivalError("Transaction cancelled in your wallet.", "wallet", technical, false);
  }
  if (
    lower.includes("chain") &&
    (lower.includes("wrong") || lower.includes("unsupported") || lower.includes("mismatch"))
  ) {
    return new RivalError(
      "Switch your wallet to GenLayer Studio Next to continue.",
      "network",
      technical,
      false,
    );
  }
  const mapped = friendlyContractMessage(technical);
  if (mapped) return new RivalError(mapped, kind, technical, false);
  if (kind === "execution" || lower.includes("rollback") || lower.includes("execution result")) {
    return new RivalError(
      "This transaction couldn't be completed. Please try again.",
      "execution",
      technical,
      false,
    );
  }
  if (kind === "write")
    return new RivalError(
      "This transaction couldn't be completed. Please try again.",
      "write",
      technical,
      false,
    );
  return new RivalError(
    "We couldn't load this data right now. Please try again.",
    "read",
    technical,
    true,
  );
}

export function logTechnicalError(error: unknown) {
  if (import.meta.env.DEV) console.error(error);
}
