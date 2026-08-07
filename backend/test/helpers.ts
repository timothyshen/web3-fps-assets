import { inject } from "vitest";

declare module "vitest" {
  interface ProvidedContext {
    baseUrl: string;
    rpcUrl: string;
    webOrigin: string;
    internalToken: string;
    contracts: {
      gameAssetRegistry: string;
      weaponSkin: string;
      rewardDistributor: string;
      skinMarket: string;
      matchAttestation: string;
      tournamentEscrow: string;
    };
  }
}

export interface ApiResponse<T = any> {
  status: number;
  body: T;
}

export function testEnv() {
  return {
    baseUrl: inject("baseUrl"),
    rpcUrl: inject("rpcUrl"),
    webOrigin: inject("webOrigin"),
    internalToken: inject("internalToken"),
    contracts: inject("contracts"),
  };
}

export async function api<T = any>(
  baseUrl: string,
  method: "GET" | "POST" | "PUT",
  path: string,
  options: { token?: string; body?: unknown } = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  let bodyInit: string | undefined;
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    bodyInit = JSON.stringify(options.body);
  }
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: bodyInit });
  const text = await res.text();
  let body: unknown = undefined;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body: body as T };
}

export async function pollUntil<T>(
  fetcher: () => Promise<T>,
  predicate: (value: T) => boolean,
  { timeoutMs = 20_000, intervalMs = 250 } = {},
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await fetcher();
    if (predicate(value)) return value;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`pollUntil timed out; last value: ${JSON.stringify(value)}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/**
 * Minimal ABI fragments the TESTS need for direct chain access
 * (hand-copied from contracts/src — createTournament is not part of the
 * backend's own ABI surface because the backend never writes tournaments).
 */
export const testEscrowAbi = [
  {
    type: "function",
    name: "createTournament",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "resultSubmitter", type: "address" },
          { name: "entryFee", type: "uint96" },
          { name: "minParticipants", type: "uint32" },
          { name: "maxParticipants", type: "uint32" },
          { name: "registrationDeadline", type: "uint64" },
          { name: "resultDeadline", type: "uint64" },
          { name: "organizerFeeBps", type: "uint16" },
          { name: "payoutBps", type: "uint16[]" },
        ],
      },
    ],
    outputs: [{ name: "tournamentId", type: "uint256" }],
  },
] as const;
