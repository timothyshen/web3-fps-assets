import {
  BaseError,
  ContractFunctionRevertedError,
  HttpRequestError,
  TimeoutError,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Chain,
  type PublicClient,
  type WalletClient,
  type Account,
  type Transport,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { AppConfig } from "../config.js";

export interface ChainContext {
  chain: Chain;
  publicClient: PublicClient;
  walletClient: WalletClient<Transport, Chain, Account>;
  operator: Account;
  /** Serializes outbound transactions (single operator account → no nonce races). */
  withTxLock<T>(work: () => Promise<T>): Promise<T>;
}

export function createChainContext(config: AppConfig): ChainContext {
  const chain = defineChain({
    id: config.chainId,
    name: config.chainName,
    nativeCurrency: {
      name: config.nativeSymbol,
      symbol: config.nativeSymbol,
      decimals: config.nativeDecimals,
    },
    rpcUrls: { default: { http: [config.rpcUrl] } },
    ...(config.multicall3Address
      ? { contracts: { multicall3: { address: config.multicall3Address } } }
      : {}),
  });

  const transport = http(config.rpcUrl, { timeout: 10_000, retryCount: 1 });
  const publicClient = createPublicClient({ chain, transport });
  const operator = privateKeyToAccount(config.operatorPrivateKey);
  const walletClient = createWalletClient({ chain, transport, account: operator });

  let txQueue: Promise<unknown> = Promise.resolve();
  const withTxLock = <T>(work: () => Promise<T>): Promise<T> => {
    const next = txQueue.then(work, work);
    txQueue = next.catch(() => undefined);
    return next;
  };

  return { chain, publicClient, walletClient, operator, withTxLock };
}

/**
 * True when the failure is the RPC/network being unreachable (degrade!),
 * false when the chain answered — e.g. a contract revert (a real answer).
 */
export function isRpcUnavailable(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current instanceof Error; depth++) {
    if (current instanceof HttpRequestError || current instanceof TimeoutError) return true;
    if ("code" in current && typeof (current as { code?: unknown }).code === "string") {
      const code = (current as { code: string }).code;
      if (["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"].includes(code)) {
        return true;
      }
    }
    current = (current as Error).cause;
  }
  return false;
}

/** The decoded custom-error name of a contract revert, if any. */
export function revertErrorName(error: unknown): string | undefined {
  if (error instanceof BaseError) {
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      return revert.data?.errorName ?? revert.signature ?? "revert";
    }
  }
  return undefined;
}
