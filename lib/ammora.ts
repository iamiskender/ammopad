"use client";

import {
  AmmoraSwapClient,
  AmmoraV4LaunchCurveClient,
  buildCreateAmmoraV4Launch,
  classifyAmmoraV4ExactInputFill,
  getAmmoraV4ConfigAtBlock,
  giwaSepoliaAutoRoutePoolProfiles,
  parseAmmoraV4ConfigCreatedReceipt,
  parseAmmoraV4LaunchCreatedReceipt,
  planCreateAmmoraV4Config,
  type AmmoraV4ConfigSnapshot,
} from "@ammora-protocol/sdk";
import { encodeFunctionData, erc20Abi, maxUint256, type Address, type Hex, type WalletClient } from "viem";
import { deriveLaunchpadConfig } from "./derive";
import { WETH, core, deployment, giwaSepolia, launchContracts, publicClient } from "./chain";

export type Tx = { to: Address; data: Hex; value?: bigint };
export type Status = (message: string) => void;

const wethAbi = [
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "wad", type: "uint256" }], outputs: [] },
] as const;

/** Simulates against current state, sends from the connected wallet and waits for a successful receipt. */
export const sendTx = async (wallet: WalletClient, tx: Tx, label: string, onStatus?: Status) => {
  const client = publicClient();
  const account = wallet.account;
  if (!account) throw new Error("Connect your wallet first.");
  onStatus?.(`Simulating: ${label}`);
  await client.call({ account: account.address, to: tx.to, data: tx.data, value: tx.value ?? 0n });
  onStatus?.(`Confirm in your wallet: ${label}`);
  const hash = await wallet.sendTransaction({ account, chain: giwaSepolia, to: tx.to, data: tx.data, value: tx.value ?? 0n });
  onStatus?.(`Waiting for confirmation: ${label}`);
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`${label} reverted (${hash})`);
  return { hash, receipt };
};

export const readBalances = async (owner: Address, token?: Address) => {
  const client = publicClient();
  const [eth, weth, tokenBalance] = await Promise.all([
    client.getBalance({ address: owner }),
    client.readContract({ address: WETH, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
    token ? client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] }) : Promise.resolve(0n),
  ]);
  return { eth, weth, token: tokenBalance };
};

export const wrapEth = (wallet: WalletClient, amount: bigint, onStatus?: Status) =>
  sendTx(wallet, { to: WETH, data: encodeWeth("deposit"), value: amount }, "Wrap ETH to WETH", onStatus);

export const unwrapWeth = (wallet: WalletClient, amount: bigint, onStatus?: Status) =>
  sendTx(wallet, { to: WETH, data: encodeWeth("withdraw", amount) }, "Unwrap WETH to ETH", onStatus);

function encodeWeth(fn: "deposit"): Hex;
function encodeWeth(fn: "withdraw", amount: bigint): Hex;
function encodeWeth(fn: "deposit" | "withdraw", amount?: bigint): Hex {
  return fn === "deposit"
    ? encodeFunctionData({ abi: wethAbi, functionName: "deposit" })
    : encodeFunctionData({ abi: wethAbi, functionName: "withdraw", args: [amount ?? 0n] });
}

/** Exact allowance only: never an unlimited approval. */
export const ensureAllowance = async (wallet: WalletClient, token: Address, spender: Address, amount: bigint, onStatus?: Status) => {
  const owner = wallet.account?.address;
  if (!owner) throw new Error("Connect your wallet first.");
  const current = await publicClient().readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] });
  if (current >= amount) return null;
  if (amount === maxUint256) throw new Error("Unlimited approvals are not used by this app.");
  return sendTx(wallet, {
    to: token,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }),
  }, "Approve exact amount", onStatus);
};

/* ----------------------------- Launch curve (ALC) ---------------------------- */

export const curveClient = (curve: Address) => new AmmoraV4LaunchCurveClient(publicClient(), curve, core);

export const quoteCurve = async (curve: Address, amountIn: bigint, sell: boolean) => {
  const client = publicClient();
  const block = await client.getBlockNumber();
  const quote = await curveClient(curve).quoteExactInputAtBlock(amountIn, sell, block);
  const fill = classifyAmmoraV4ExactInputFill(quote, sell);
  return { quote, fill };
};

/**
 * Buy (WETH -> token) or sell (token -> WETH) on the pre-graduation curve.
 * A buy that reaches the graduation boundary is filled partially and the remainder is returned.
 */
export const swapOnCurve = async (
  wallet: WalletClient,
  curve: Address,
  amountIn: bigint,
  sell: boolean,
  slippageBps: number,
  onStatus?: Status,
) => {
  const recipient = wallet.account?.address;
  if (!recipient) throw new Error("Connect your wallet first.");
  const sdk = curveClient(curve);
  const { fill } = await quoteCurve(curve, amountIn, sell);
  if (fill.kind === "terminal-dust") throw new Error("The curve is at its graduation boundary. Graduate it first, then trade on the pool.");
  if (sell && fill.kind !== "full") throw new Error("This sell cannot be filled in full. Try a smaller amount.");
  const block = await publicClient().getBlock();
  const plan = await sdk.planSwapExactInput({
    includedAmountIn: amountIn,
    baseForQuote: sell,
    allowPartialFill: fill.allowPartialFill,
    slippageBps,
    recipient,
    deadline: block.timestamp + 20n * 60n,
  });
  for (const requirement of plan.approvalRequirements) {
    await ensureAllowance(wallet, requirement.token, requirement.spender, requirement.amount, onStatus);
  }
  const result = await sendTx(wallet, plan.transaction as Tx, sell ? "Sell on curve" : "Buy on curve", onStatus);
  return { ...result, quote: plan.quote, graduationFill: fill.kind === "graduation-boundary" };
};

/** Permissionless graduation: moves a ReadyToMigrate curve into its concentrated ARL pool. */
export const graduate = async (wallet: WalletClient, curve: Address, onStatus?: Status) => {
  const plan = await curveClient(curve).planMigrate();
  return sendTx(wallet, plan.transaction as Tx, "Graduate to ARL pool", onStatus);
};

/* --------------------------- Graduated pool (ARL) --------------------------- */

let swapClient: Promise<AmmoraSwapClient> | null = null;
const getSwapClient = () => {
  swapClient ??= AmmoraSwapClient.create(publicClient(), {
    deploymentCatalog: { [deployment.chain.id]: deployment },
    factoryProfiles: giwaSepoliaAutoRoutePoolProfiles,
  });
  return swapClient;
};

export const preparePoolSwap = async (pool: Address, tokenIn: Address, amountIn: bigint, payer: Address, slippageBps: number) => {
  const swaps = await getSwapClient();
  return swaps.prepareExactIn({
    model: "concentrated",
    pool,
    tokenIn,
    inputAsset: "erc20",
    amountIn,
    payer,
    recipient: payer,
    slippageBps,
    executionMode: "direct-wallet",
  });
};

/* ------------------------------ Token creation ------------------------------ */

export const readConfig = async (configId: bigint): Promise<AmmoraV4ConfigSnapshot> => {
  const client = publicClient();
  const block = await client.getBlockNumber();
  return getAmmoraV4ConfigAtBlock(client, core.configRegistry, configId, block);
};

export const createLaunch = async (
  wallet: WalletClient,
  configId: bigint,
  input: { name: string; symbol: string; metadataURI: string },
  onStatus?: Status,
) => {
  onStatus?.("Reading launchpad Config");
  const selected = await readConfig(configId);
  if (!selected.enabled) throw new Error(`Config #${configId} is disabled.`);
  const tx = buildCreateAmmoraV4Launch({
    name: input.name,
    symbol: input.symbol,
    metadataURI: input.metadataURI,
    creatorMetadataURI: input.metadataURI,
    tokenDecimals: selected.config.tokenDecimals,
  }, configId, selected.config.poolCreationFee);
  const { hash, receipt } = await sendTx(wallet, { to: launchContracts.factory as Address, data: tx.data, value: tx.value }, "Create token", onStatus);
  const created = parseAmmoraV4LaunchCreatedReceipt(receipt, launchContracts.factory as Address);
  return { hash, token: created.token, curve: created.curve };
};

/* --------------------------- Launchpad Config (/admin) ---------------------- */

export const createLaunchpadConfig = async (
  wallet: WalletClient,
  templateId: bigint,
  saleSupply: bigint,
  migrationQuoteThreshold: bigint,
  onStatus?: Status,
) => {
  const owner = wallet.account?.address;
  if (!owner) throw new Error("Connect your wallet first.");
  onStatus?.("Reading template Config");
  const template = await readConfig(templateId);
  if (!template.enabled) throw new Error(`Template Config #${templateId} is disabled.`);
  const { config, curve } = deriveLaunchpadConfig(template, saleSupply, migrationQuoteThreshold, owner);
  onStatus?.("Simulating Config creation");
  const plan = await planCreateAmmoraV4Config(publicClient(), core.configRegistry, config, curve, owner, owner);
  const { hash, receipt } = await sendTx(wallet, plan.transaction as Tx, "Create launchpad Config", onStatus);
  const created = parseAmmoraV4ConfigCreatedReceipt(receipt, core.configRegistry);
  return { hash, configId: created.configId };
};
