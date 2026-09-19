import { useCallback, useState } from "react";
import type { TrackedStatus } from "@genlayer/transaction-kit";
import { normalizeError, type RivalError } from "./errors";
import {
  submitRivalWrite,
  writePhase,
  type RivalWriteMethod,
  type RivalWriteResult,
  type WritePhase,
} from "./write";
import { useWallet } from "./wallet";

export function useRivalWrite() {
  const wallet = useWallet();
  const [status, setStatus] = useState<TrackedStatus | undefined>();
  const [error, setError] = useState<RivalError | undefined>();
  const [result, setResult] = useState<RivalWriteResult | undefined>();
  const [busy, setBusy] = useState(false);
  const [localPhase, setLocalPhase] = useState<WritePhase | undefined>();

  const submit = useCallback(
    async (method: RivalWriteMethod, args: unknown[] = [], userValue?: bigint) => {
      if (!wallet.provider || !wallet.address)
        throw normalizeError(new Error("Connect a compatible wallet to continue."), "wallet");
      if (wallet.wrongNetwork) throw normalizeError(new Error("wrong network"), "network");
      setBusy(true);
      setError(undefined);
      setResult(undefined);
      setStatus(undefined);
      setLocalPhase("preparing");
      try {
        const next = await submitRivalWrite({
          provider: wallet.provider,
          account: wallet.address,
          method,
          args,
          ...(userValue === undefined ? {} : { userValue }),
          onPhase: setLocalPhase,
          onStatus: (nextStatus) => {
            setLocalPhase(undefined);
            setStatus(nextStatus);
          },
        });
        setResult(next);
        setStatus(next.status);
        return next;
      } catch (raw) {
        const nextError = normalizeError(raw, "write");
        setError(nextError);
        throw nextError;
      } finally {
        setBusy(false);
        setLocalPhase(undefined);
      }
    },
    [wallet.address, wallet.provider, wallet.wrongNetwork],
  );

  return {
    submit,
    status,
    phase: localPhase ?? (writePhase(status) as WritePhase),
    error,
    result,
    busy,
  };
}
