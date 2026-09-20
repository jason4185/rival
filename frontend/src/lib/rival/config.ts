import { studioDevnet } from "genlayer-js/chains";
import type { Address } from "viem";

export const RIVAL_ADDRESS = "0xaaA3d790fF2FA38D9e0961F0081ffeCd5dC45391" as Address;
export const STUDIO_NEXT_CHAIN_ID = 61997;
export const STUDIO_NEXT_RPC_URL = "https://studio-next.genlayer.com/api";
export const STUDIO_NEXT_EXPLORER_URL = "https://explorer-studio-dev.genlayer.com";

// The RC exposes the Studio Devnet metadata with its legacy RPC URL. Keep its
// Consensus v0.6 contract configuration, but use the official Studio Next RPC
// for every frontend read, wallet network definition, and write transaction.
export const STUDIO_NEXT_CHAIN = {
  ...studioDevnet,
  id: STUDIO_NEXT_CHAIN_ID,
  name: "GenLayer Studio Next",
  rpcUrls: {
    default: {
      http: [STUDIO_NEXT_RPC_URL],
    },
  },
} satisfies typeof studioDevnet;

export const MAX_PAGE_SIZE = 50;
export const GEN_DECIMALS = 18;
export const GEN_SCALE = 1_000_000_000_000_000_000n;

if (
  STUDIO_NEXT_CHAIN.id !== STUDIO_NEXT_CHAIN_ID ||
  STUDIO_NEXT_CHAIN.rpcUrls.default.http[0] !== STUDIO_NEXT_RPC_URL
) {
  throw new Error("The installed GenLayer RC does not match Studio Next.");
}

export function explorerTransactionUrl(txId: string) {
  return `${STUDIO_NEXT_EXPLORER_URL}/tx/${txId}`;
}
