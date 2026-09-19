import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Eip1193Provider } from "@genlayer/transaction-kit";
import { STUDIO_DEV_CHAIN_ID, STUDIO_DEV_RPC_URL, clearRivalReadCache } from "./walletSupport";

type WalletContextValue = {
  provider: Eip1193Provider | undefined;
  address: `0x${string}` | undefined;
  chainId: number | undefined;
  connected: boolean;
  available: boolean;
  wrongNetwork: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchNetwork: () => Promise<void>;
};

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

function getProvider() {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { ethereum?: Eip1193Provider }).ethereum;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [provider, setProvider] = useState<Eip1193Provider | undefined>(getProvider);
  const [address, setAddress] = useState<`0x${string}` | undefined>();
  const [chainId, setChainId] = useState<number | undefined>();

  const sync = useCallback(
    async (source = provider ?? getProvider()) => {
      if (!source) return;
      setProvider(source);
      const [accounts, chain] = await Promise.all([
        source.request({ method: "eth_accounts" }),
        source.request({ method: "eth_chainId" }),
      ]);
      const nextAddress =
        Array.isArray(accounts) && typeof accounts[0] === "string"
          ? (accounts[0].toLowerCase() as `0x${string}`)
          : undefined;
      const nextChain = typeof chain === "string" ? Number.parseInt(chain, 16) : undefined;
      setAddress(nextAddress);
      setChainId(nextChain);
    },
    [provider],
  );

  useEffect(() => {
    const source = getProvider();
    if (!source) return;
    setProvider(source);
    void sync(source);
    const onAccounts = () => {
      clearRivalReadCache();
      void sync(source);
    };
    const onChain = () => {
      clearRivalReadCache();
      void sync(source);
    };
    const emitter = source as Eip1193Provider & {
      on?: (event: string, callback: (value: unknown) => void) => void;
      removeListener?: (event: string, callback: (value: unknown) => void) => void;
    };
    emitter.on?.("accountsChanged", onAccounts);
    emitter.on?.("chainChanged", onChain);
    return () => {
      emitter.removeListener?.("accountsChanged", onAccounts);
      emitter.removeListener?.("chainChanged", onChain);
    };
  }, [sync]);

  const connect = useCallback(async () => {
    const source = provider ?? getProvider();
    if (!source) throw new Error("Connect a compatible wallet to continue.");
    await source.request({ method: "eth_requestAccounts" });
    await sync(source);
  }, [provider, sync]);

  const disconnect = useCallback(() => {
    clearRivalReadCache();
    setAddress(undefined);
  }, []);

  const switchNetwork = useCallback(async () => {
    const source = provider ?? getProvider();
    if (!source) throw new Error("Connect a compatible wallet to continue.");
    const chainIdHex = `0x${STUDIO_DEV_CHAIN_ID.toString(16)}`;
    try {
      await source.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainIdHex }],
      });
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? (error as { code?: number }).code
          : undefined;
      if (code !== 4902) throw error;
      await source.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: chainIdHex,
            chainName: "GenLayer Studio Next",
            nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
            rpcUrls: [STUDIO_DEV_RPC_URL],
            blockExplorerUrls: ["https://explorer-studio-dev.genlayer.com"],
          },
        ],
      });
      await source.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainIdHex }],
      });
    }
    await sync(source);
  }, [provider, sync]);

  const value = useMemo<WalletContextValue>(
    () => ({
      provider,
      address,
      chainId,
      connected: Boolean(address),
      available: Boolean(provider),
      wrongNetwork: Boolean(address && chainId !== STUDIO_DEV_CHAIN_ID),
      connect,
      disconnect,
      switchNetwork,
    }),
    [address, chainId, connect, disconnect, provider, switchNetwork],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useWallet must be used within WalletProvider");
  return value;
}
