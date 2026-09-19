import { studioDevnet } from "genlayer-js/chains";
import type { Address } from "viem";

export const RIVAL_ADDRESS = "0x24b89F05FDa1b10BF60Cc526f65Da74C8EB5d38d" as Address;
export const STUDIO_DEV_CHAIN_ID = 61997;
export const STUDIO_DEV_RPC_URL = "https://studio-dev.genlayer.com/api";
export const STUDIO_DEV_EXPLORER_URL = "https://explorer-studio-dev.genlayer.com";
export const MAX_PAGE_SIZE = 50;
export const GEN_DECIMALS = 18;
export const GEN_SCALE = 1_000_000_000_000_000_000n;

if (
  studioDevnet.id !== STUDIO_DEV_CHAIN_ID ||
  studioDevnet.rpcUrls.default.http[0] !== STUDIO_DEV_RPC_URL
) {
  throw new Error("The installed GenLayer RC does not match Studio development preview.");
}

export function explorerTransactionUrl(txId: string) {
  return `${STUDIO_DEV_EXPLORER_URL}/tx/${txId}`;
}
