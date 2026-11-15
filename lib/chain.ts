import { createPublicClient, defineChain, http, type Address, type PublicClient } from "viem";
import { giwaSepoliaAutoRouteDeployment } from "@ammora-protocol/sdk";

/** One complete reviewed Ammora generation. Never mix Registry/Factory values across generations. */
export const deployment = giwaSepoliaAutoRouteDeployment;
export const launchContracts = deployment.contracts.launch;

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || deployment.chain.rpcUrls[0]!;
export const EXPLORER = deployment.chain.blockExplorerUrl ?? "https://sepolia-explorer.giwa.io";
export const WETH = deployment.contracts.tokens.wrappedNative as Address;

/** Launchpad Config used by the Create page. Set NEXT_PUBLIC_LAUNCHPAD_CONFIG_ID after creating your own on /admin. */
export const LAUNCHPAD_CONFIG_ID = BigInt(process.env.NEXT_PUBLIC_LAUNCHPAD_CONFIG_ID || "6");
/** Reviewed template used by /admin to derive a new launchpad Config. */
export const TEMPLATE_CONFIG_ID = 6n;

export const giwaSepolia = defineChain({
  id: deployment.chain.id,
  name: deployment.chain.name,
  nativeCurrency: deployment.chain.nativeCurrency,
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "GIWA Explorer", url: EXPLORER } },
  testnet: true,
});

export const core = {
  configRegistry: launchContracts.configRegistry as Address,
  launchFactory: launchContracts.factory as Address,
  graduationAdapter: launchContracts.graduationAdapter as Address,
  feePolicy: launchContracts.feePolicy as Address,
};

let cached: PublicClient | undefined;
export const publicClient = (): PublicClient => {
  if (!cached) {
    cached = createPublicClient({
      chain: giwaSepolia,
      transport: http(RPC_URL, { batch: { batchSize: 8, wait: 16 }, retryCount: 3, retryDelay: 400 }),
    }) as PublicClient;
  }
  return cached;
};

export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addrUrl = (address: string) => `${EXPLORER}/address/${address}`;
