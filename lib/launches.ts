import "server-only";
import { decodeEventLog, erc20Abi, getAddress, zeroAddress, type Address, type Hex } from "viem";
import { ammoraLaunchFactoryV4Abi, ammoraLaunchPoolV4Abi } from "@ammora-protocol/sdk";
import { EXPLORER, launchContracts, publicClient } from "./chain";
import { parseMetadataUri, type TokenMetadata } from "./metadata";

export type LaunchRow = {
  token: Address;
  curve: Address;
  creator: Address;
  configId: string;
  metadataURI: string;
  metadata: TokenMetadata | null;
  name: string;
  symbol: string;
  decimals: number;
  createdBlock: string;
  createdAt: string | null;
  txHash: Hex;
  status: number;
  quoteReserve: string;
  migrationQuoteThreshold: string;
  progressBps: number;
  canonicalPool: Address | null;
  feeBps: number;
};

export type TradeRow = {
  txHash: Hex;
  block: string;
  time: string | null;
  trader: Address;
  side: "buy" | "sell";
  amountIn: string;
  amountOut: string;
  fee: string;
};

type BlockscoutLog = {
  block_number: number;
  block_timestamp?: string;
  data: Hex;
  topics: (Hex | null)[];
  transaction_hash: Hex;
};

const FACTORY_START_BLOCK = 36_220_000n;
const RPC_LOG_RANGE = 10_000n;

const fetchJson = async (url: string, timeoutMs = 12_000): Promise<unknown> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" }, cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

/** Pages through the explorer's log index for one address (bounded). */
const explorerLogs = async (address: Address, maxPages = 20): Promise<BlockscoutLog[]> => {
  const base = `${EXPLORER}/api/v2/addresses/${address}/logs`;
  const logs: BlockscoutLog[] = [];
  let url: string | null = base;
  for (let page = 0; url && page < maxPages; page += 1) {
    const body = (await fetchJson(url)) as { items?: BlockscoutLog[]; next_page_params?: Record<string, string | number> | null };
    logs.push(...(body.items ?? []));
    url = body.next_page_params
      ? `${base}?${new URLSearchParams(Object.entries(body.next_page_params).map(([key, value]) => [key, String(value)]))}`
      : null;
  }
  return logs;
};

type CreatedEvent = { token: Address; curve: Address; creator: Address; configId: bigint; metadataURI: string; block: bigint; time: string | null; txHash: Hex };

const decodeCreated = (log: { data: Hex; topics: (Hex | null)[]; block: bigint; time: string | null; txHash: Hex }): CreatedEvent | null => {
  try {
    const topics = log.topics.filter((topic): topic is Hex => Boolean(topic));
    if (topics.length === 0) return null;
    const decoded = decodeEventLog({ abi: ammoraLaunchFactoryV4Abi, data: log.data, topics: topics as [Hex, ...Hex[]] });
    if (decoded.eventName !== "LaunchCreated") return null;
    const args = decoded.args as { token: Address; curve: Address; creator: Address; configId: bigint; metadataURI: string };
    return { ...args, block: log.block, time: log.time, txHash: log.txHash };
  } catch {
    return null;
  }
};

/** Primary source: explorer index. Fallback: bounded RPC scan of the most recent blocks. */
const loadCreatedEvents = async (): Promise<CreatedEvent[]> => {
  const factory = getAddress(launchContracts.factory);
  try {
    const logs = await explorerLogs(factory);
    const events = logs
      .map((log) => decodeCreated({ data: log.data, topics: log.topics, block: BigInt(log.block_number), time: log.block_timestamp ?? null, txHash: log.transaction_hash }))
      .filter((event): event is CreatedEvent => event !== null);
    if (events.length > 0) return events;
  } catch (error) {
    console.warn("explorer log index unavailable, falling back to RPC scan", error);
  }
  const client = publicClient();
  const latest = await client.getBlockNumber();
  const events: CreatedEvent[] = [];
  const launchCreated = ammoraLaunchFactoryV4Abi.find((item) => item.type === "event" && item.name === "LaunchCreated");
  if (!launchCreated || launchCreated.type !== "event") return events;
  // 30 windows of 10k blocks (~8h on a 1s chain). The explorer path covers full history.
  for (let to = latest, windows = 0; to > FACTORY_START_BLOCK && windows < 30; windows += 1) {
    const from = to - RPC_LOG_RANGE + 1n > FACTORY_START_BLOCK ? to - RPC_LOG_RANGE + 1n : FACTORY_START_BLOCK;
    const logs = await client.getLogs({ address: factory, event: launchCreated, fromBlock: from, toBlock: to });
    for (const log of logs) {
      const args = log.args as { token: Address; curve: Address; creator: Address; configId: bigint; metadataURI: string };
      events.push({ ...args, block: log.blockNumber, time: null, txHash: log.transactionHash });
    }
    to = from - 1n;
  }
  return events;
};

const readLaunchState = async (event: CreatedEvent): Promise<LaunchRow> => {
  const client = publicClient();
  const pool = { address: event.curve, abi: ammoraLaunchPoolV4Abi } as const;
  const token = { address: event.token, abi: erc20Abi } as const;
  const [status, quoteReserve, threshold, canonicalPool, feeBps, name, symbol, decimals] = await Promise.all([
    client.readContract({ ...pool, functionName: "status" }),
    client.readContract({ ...pool, functionName: "quoteReserve" }),
    client.readContract({ ...pool, functionName: "migrationQuoteThreshold" }),
    client.readContract({ ...pool, functionName: "canonicalPool" }),
    client.readContract({ ...pool, functionName: "currentFeeBps" }).catch(() => 0),
    client.readContract({ ...token, functionName: "name" }).catch(() => "Unknown"),
    client.readContract({ ...token, functionName: "symbol" }).catch(() => "???"),
    client.readContract({ ...token, functionName: "decimals" }).catch(() => 9),
  ]);
  const statusNumber = Number(status);
  const progressBps = statusNumber >= 2
    ? 10_000
    : threshold > 0n ? Number((quoteReserve * 10_000n) / threshold > 10_000n ? 10_000n : (quoteReserve * 10_000n) / threshold) : 0;
  return {
    token: event.token,
    curve: event.curve,
    creator: event.creator,
    configId: event.configId.toString(),
    metadataURI: event.metadataURI,
    metadata: parseMetadataUri(event.metadataURI),
    name,
    symbol,
    decimals: Number(decimals),
    createdBlock: event.block.toString(),
    createdAt: event.time,
    txHash: event.txHash,
    status: statusNumber,
    quoteReserve: quoteReserve.toString(),
    migrationQuoteThreshold: threshold.toString(),
    progressBps,
    canonicalPool: canonicalPool && canonicalPool !== zeroAddress ? canonicalPool : null,
    feeBps: Number(feeBps),
  };
};

let cache: { at: number; rows: LaunchRow[] } | null = null;
const CACHE_MS = 15_000;
/** Last good state per curve, used when a public RPC read is rate limited. */
const lastGood = new Map<string, LaunchRow>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const readWithRetry = async (event: CreatedEvent): Promise<LaunchRow | null> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const row = await readLaunchState(event);
      lastGood.set(event.curve.toLowerCase(), row);
      return row;
    } catch {
      await sleep(400 * (attempt + 1));
    }
  }
  return lastGood.get(event.curve.toLowerCase()) ?? null;
};

export const getLaunches = async (): Promise<LaunchRow[]> => {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  const events = await loadCreatedEvents();
  const unique = new Map<string, CreatedEvent>();
  for (const event of events) unique.set(event.curve.toLowerCase(), event);
  const sorted = [...unique.values()].sort((a, b) => (a.block > b.block ? -1 : a.block < b.block ? 1 : 0));
  const rows: LaunchRow[] = [];
  // Small sequential batches keep the public RPC within its rate limit.
  for (let index = 0; index < sorted.length; index += 3) {
    const batch = await Promise.all(sorted.slice(index, index + 3).map(readWithRetry));
    rows.push(...batch.filter((row): row is LaunchRow => row !== null));
  }
  cache = { at: Date.now(), rows };
  return rows;
};

export const getLaunch = async (tokenOrCurve: string): Promise<LaunchRow | null> => {
  const needle = tokenOrCurve.toLowerCase();
  const rows = await getLaunches();
  return rows.find((row) => row.token.toLowerCase() === needle || row.curve.toLowerCase() === needle) ?? null;
};

export const getCurveTrades = async (curve: Address): Promise<TradeRow[]> => {
  const logs = await explorerLogs(curve, 2);
  const trades: TradeRow[] = [];
  for (const log of logs) {
    try {
      const topics = log.topics.filter((topic): topic is Hex => Boolean(topic));
      const decoded = decodeEventLog({ abi: ammoraLaunchPoolV4Abi, data: log.data, topics: topics as [Hex, ...Hex[]] });
      if (decoded.eventName !== "Swap") continue;
      const args = decoded.args as { trader: Address; baseForQuote: boolean; amountIn: bigint; amountOut: bigint; fee: bigint };
      trades.push({
        txHash: log.transaction_hash,
        block: String(log.block_number),
        time: log.block_timestamp ?? null,
        trader: args.trader,
        side: args.baseForQuote ? "sell" : "buy",
        amountIn: args.amountIn.toString(),
        amountOut: args.amountOut.toString(),
        fee: args.fee.toString(),
      });
    } catch {
      // Not a Swap event.
    }
  }
  return trades.slice(0, 30);
};
