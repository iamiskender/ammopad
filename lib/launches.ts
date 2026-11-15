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

const POOL_FIELDS = ["status", "quoteReserve", "migrationQuoteThreshold", "canonicalPool", "currentFeeBps"] as const;
const TOKEN_FIELDS = ["name", "symbol", "decimals"] as const;

let cache: { at: number; rows: LaunchRow[] } | null = null;
const CACHE_MS = 15_000;
/** Last good state per curve, used when a public RPC read fails. */
const lastGood = new Map<string, LaunchRow>();

/** Reads every launch in a few Multicall3 calls instead of hundreds of separate RPC requests. */
const readLaunchStates = async (events: CreatedEvent[]): Promise<LaunchRow[]> => {
  const client = publicClient();
  const contracts = events.flatMap((event) => [
    ...POOL_FIELDS.map((functionName) => ({ address: event.curve, abi: ammoraLaunchPoolV4Abi, functionName })),
    ...TOKEN_FIELDS.map((functionName) => ({ address: event.token, abi: erc20Abi, functionName })),
  ]);
  const results = await client.multicall({ contracts: contracts as never[], allowFailure: true, batchSize: 4_096 });
  const per = POOL_FIELDS.length + TOKEN_FIELDS.length;
  const rows: LaunchRow[] = [];
  events.forEach((event, index) => {
    const slice = results.slice(index * per, index * per + per) as { status: "success" | "failure"; result?: unknown }[];
    const value = <T,>(i: number, fallback: T): T => (slice[i]?.status === "success" ? (slice[i]!.result as T) : fallback);
    if (slice[0]?.status !== "success" || slice[1]?.status !== "success" || slice[2]?.status !== "success") {
      const previous = lastGood.get(event.curve.toLowerCase());
      if (previous) rows.push(previous);
      return;
    }
    const status = Number(value<number | bigint>(0, 0));
    const quoteReserve = value<bigint>(1, 0n);
    const threshold = value<bigint>(2, 0n);
    const canonicalPool = value<Address>(3, zeroAddress);
    const ratio = threshold > 0n ? (quoteReserve * 10_000n) / threshold : 0n;
    const row: LaunchRow = {
      token: event.token,
      curve: event.curve,
      creator: event.creator,
      configId: event.configId.toString(),
      metadataURI: event.metadataURI,
      metadata: parseMetadataUri(event.metadataURI),
      name: value<string>(5, "Unknown"),
      symbol: value<string>(6, "???"),
      decimals: Number(value<number>(7, 9)),
      createdBlock: event.block.toString(),
      createdAt: event.time,
      txHash: event.txHash,
      status,
      quoteReserve: quoteReserve.toString(),
      migrationQuoteThreshold: threshold.toString(),
      progressBps: status >= 2 ? 10_000 : Number(ratio > 10_000n ? 10_000n : ratio),
      canonicalPool: canonicalPool !== zeroAddress ? canonicalPool : null,
      feeBps: Number(value<number>(4, 0)),
    };
    lastGood.set(event.curve.toLowerCase(), row);
    rows.push(row);
  });
  return rows;
};

export const getLaunches = async (): Promise<LaunchRow[]> => {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  const events = await loadCreatedEvents();
  const unique = new Map<string, CreatedEvent>();
  for (const event of events) unique.set(event.curve.toLowerCase(), event);
  const sorted = [...unique.values()].sort((a, b) => (a.block > b.block ? -1 : a.block < b.block ? 1 : 0));
  let rows: LaunchRow[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      rows = await readLaunchStates(sorted);
      break;
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
    }
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
