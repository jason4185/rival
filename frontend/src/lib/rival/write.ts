import {
  createTransactionKit,
  type Eip1193Provider,
  type TrackedStatus,
} from "@genlayer/transaction-kit";
import { ExecutionResult } from "genlayer-js/types";
import { RIVAL_ADDRESS, explorerTransactionUrl, STUDIO_NEXT_CHAIN } from "./config";
import { normalizeError, RivalError, logTechnicalError } from "./errors";
import { invalidateAfterRivalWrite } from "./read";

export type RivalWriteMethod =
  "create_market" | "place_bet" | "settle_market" | "claim" | "claim_refund";
export type WritePhase =
  "preparing" | "wallet" | "submitted" | "consensus" | "finalizing" | "confirmed" | "failed";

export type RivalWriteResult = {
  txId: `0x${string}`;
  explorerUrl: string;
  status: TrackedStatus;
};

export function requiresFinalization(method: RivalWriteMethod): boolean {
  return method === "claim" || method === "claim_refund";
}

export function hasSuccessfulExecution(status?: TrackedStatus): boolean {
  return (
    (status?.statusName === "ACCEPTED" || status?.statusName === "FINALIZED") &&
    status.successful === true &&
    status.executionResultName === ExecutionResult.FINISHED_WITH_RETURN
  );
}

export function settlementBusinessMessage(result: unknown): string | undefined {
  if (result === "SETTLED") return "Market settled.";
  if (result === "SETTLEMENT_PENDING")
    return "Settlement didn't reach agreement yet. It can be retried before the deadline.";
  if (result === "INCONCLUSIVE")
    return "The market is inconclusive. Eligible bettors can claim their refunds.";
  return undefined;
}

export async function runPostWriteRefresh<T>(
  refresh: () => Promise<T>,
  onFailure?: (error: unknown) => void,
): Promise<T | undefined> {
  try {
    return await refresh();
  } catch (error) {
    logTechnicalError(error);
    onFailure?.(error);
    return undefined;
  }
}

export function writePhase(status?: TrackedStatus): WritePhase {
  if (!status) return "preparing";
  if (status.phase === "submitted") return "submitted";
  if (status.phase === "pending") return "consensus";
  if (hasSuccessfulExecution(status)) return "confirmed";
  if (
    (status.statusName === "ACCEPTED" || status.statusName === "FINALIZED") &&
    status.successful === false
  )
    return "failed";
  if (status.phase === "processing" || status.phase === "decided") return "finalizing";
  return status.successful ? "confirmed" : "failed";
}

export async function submitRivalWrite({
  provider,
  account,
  method,
  args = [],
  userValue,
  onStatus,
  onPhase,
}: {
  provider: Eip1193Provider;
  account: `0x${string}`;
  method: RivalWriteMethod;
  args?: unknown[];
  userValue?: bigint;
  onStatus?: (status: TrackedStatus) => void;
  onPhase?: (phase: WritePhase) => void;
}): Promise<RivalWriteResult> {
  const tx = { kind: "write" as const, address: RIVAL_ADDRESS, method, args };
  try {
    const kit = createTransactionKit({ chain: STUDIO_NEXT_CHAIN, provider, account });
    const quote = await kit.estimate(
      { preset: "standard", ...(userValue === undefined ? {} : { userValue }) },
      tx,
    );
    if (quote.verification.status === "mismatch")
      throw new RivalError(
        "Unable to prepare the transaction fee quote right now. Please try again.",
        "write",
        "fee verification mismatch",
      );
    onPhase?.("wallet");
    const submitted = await kit.submit(quote, tx);
    onStatus?.(
      submitted.evmTxHash
        ? {
            phase: "submitted",
            genlayerTxId: submitted.genlayerTxId,
            evmTxHash: submitted.evmTxHash,
          }
        : { phase: "submitted", genlayerTxId: submitted.genlayerTxId },
    );
    const status = await kit.track(submitted.genlayerTxId, (next) => onStatus?.(next), {
      until: requiresFinalization(method) ? "finalized" : "decided",
    });
    if (!hasSuccessfulExecution(status)) {
      throw new RivalError(
        "This transaction couldn't be completed. Please try again.",
        "execution",
        `${status.statusName ?? "unknown"}/${status.executionResultName ?? "unknown"}`,
      );
    }
    const marketId = args[0] as bigint | undefined;
    try {
      invalidateAfterRivalWrite(method, typeof marketId === "bigint" ? marketId : undefined);
    } catch (error) {
      // Cache invalidation is a read concern. Never turn a successful economic
      // transaction into a failed transaction because local refresh plumbing broke.
      logTechnicalError(error);
    }
    return {
      txId: submitted.genlayerTxId,
      explorerUrl: explorerTransactionUrl(submitted.genlayerTxId),
      status,
    };
  } catch (error) {
    logTechnicalError(error);
    throw normalizeError(error, "write");
  }
}
