import { createPublicClient, http, type AbiEvent, type Address, type Hex, type Log, type PublicClient } from "viem";
import type { ChainConfig } from "./config.ts";
import type { StoredEvent, Store } from "./db.ts";

/** A log within this many blocks of the head when fetched counts as seen live, so its wall-clock time is kept. */
const LIVE_WINDOW = 3n;
const MAX_BACKOFF_MS = 10_000;
/** Retry delay when a load-balanced RPC reports a head that the node serving the next call has not reached yet. */
const HEAD_RACE_RETRY_MS = 100;

/**
 * Public RPCs sit behind load balancers whose nodes can be a block apart: eth_blockNumber may name a block that the
 * node answering eth_getLogs or eth_getBlockByNumber does not have yet. That is a race to retry, not a failure.
 */
export function isHeadRace(err: unknown): boolean {
  const text = err instanceof Error ? `${err.message} ${(err as { details?: unknown }).details ?? ""}` : String(err);
  const name = (err as { name?: unknown } | null)?.name;
  return name === "BlockNotFoundError" || /beyond current head block|could not be found/i.test(text);
}

export interface WatcherStatus {
  readonly chain: string;
  readonly head: string | null;
  readonly indexedTo: string | null;
  readonly lagBlocks: string | null;
  readonly lastPollAt: number | null;
  readonly lastError: string | null;
}

export interface WatcherSpec {
  readonly chain: ChainConfig;
  readonly addresses: readonly Address[];
  readonly events: readonly AbiEvent[];
  /** Drops logs that are not ours (e.g. swaps on other pools, failures of other contracts' callbacks). */
  readonly keep: (log: DecodedLog) => boolean;
  /** Extracts the Tripwire order id a log refers to, if any. */
  readonly orderIdOf: (log: DecodedLog) => bigint | null;
  readonly pollMs: number;
}

export type DecodedLog = Log<bigint, number, false, AbiEvent, true> & {
  eventName: string;
  args: Record<string, unknown>;
};

/** Normalises decoded arguments for JSON storage: bigints to decimal strings, hex to lowercase. */
export function normaliseArgs(args: Record<string, unknown>): StoredEvent["args"] {
  const out: Record<string, string | boolean | number> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "bigint") out[key] = value.toString();
    else if (typeof value === "string") out[key] = value.toLowerCase();
    else if (typeof value === "boolean" || typeof value === "number") out[key] = value;
    else throw new Error(`unsupported event argument ${key}: ${typeof value}`);
  }
  return out;
}

/** Reads the order id out of an `execute(address,uint256,...)` callback payload: selector | rvm | orderId | ... */
export function orderIdFromExecutePayload(payload: Hex): bigint | null {
  const body = payload.slice(2);
  if (body.length < 8 + 64 * 2) return null;
  return BigInt(`0x${body.slice(8 + 64, 8 + 128)}`);
}

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

/**
 * Polls one chain: follows the head, fetches matching logs in RPC-sized ranges, stamps each with its block time and
 * (when live) the wall-clock time it was first seen, and commits each range together with the cursor.
 */
export class ChainWatcher {
  readonly #spec: WatcherSpec;
  readonly #store: Store;
  readonly #client: PublicClient;
  readonly #blockTimes = new Map<bigint, number>();
  #head: bigint | null = null;
  #cursor: bigint | null = null;
  #lastPollAt: number | null = null;
  #lastError: string | null = null;

  constructor(spec: WatcherSpec, store: Store) {
    this.#spec = spec;
    this.#store = store;
    this.#client = createPublicClient({ transport: http(spec.chain.rpcUrl, { retryCount: 2, timeout: 10_000 }) });
  }

  get client(): PublicClient {
    return this.#client;
  }

  status(): WatcherStatus {
    return {
      chain: this.#spec.chain.name,
      head: this.#head?.toString() ?? null,
      indexedTo: this.#cursor?.toString() ?? null,
      lagBlocks: this.#head !== null && this.#cursor !== null ? (this.#head - this.#cursor).toString() : null,
      lastPollAt: this.#lastPollAt,
      lastError: this.#lastError,
    };
  }

  async run(signal: AbortSignal): Promise<void> {
    const { chain } = this.#spec;
    let cursor: bigint = this.#store.cursor(chain.name) ?? chain.startBlock - 1n;
    this.#cursor = cursor;
    let backoff = 0;

    while (!signal.aborted) {
      let caughtUp = true;
      try {
        const head = await this.#client.getBlockNumber({ cacheTime: 0 });
        this.#head = head;
        this.#lastPollAt = Date.now();
        if (head > cursor) {
          const from: bigint = cursor + 1n;
          const to: bigint = head < from + chain.maxLogRange - 1n ? head : from + chain.maxLogRange - 1n;
          const logs = (await this.#client.getLogs({
            address: [...this.#spec.addresses],
            events: [...this.#spec.events],
            fromBlock: from,
            toBlock: to,
            strict: true,
          })) as unknown as DecodedLog[];
          const seenAt = Date.now();
          const events = await this.#toStored(logs.filter(this.#spec.keep), head, seenAt);
          this.#store.commitBatch(chain.name, to, events);
          cursor = to;
          this.#cursor = to;
          caughtUp = to === head;
        }
        this.#lastError = null;
        backoff = 0;
      } catch (err) {
        if (isHeadRace(err)) {
          await sleep(HEAD_RACE_RETRY_MS, signal);
          continue;
        }
        this.#lastError = err instanceof Error ? err.message.split("\n")[0]! : String(err);
        backoff = Math.min(backoff === 0 ? 500 : backoff * 2, MAX_BACKOFF_MS);
        console.error(`[${chain.name}] ${this.#lastError} (retrying in ${backoff}ms)`);
        await sleep(backoff, signal);
        continue;
      }
      if (caughtUp) await sleep(this.#spec.pollMs, signal);
    }
  }

  async #toStored(logs: DecodedLog[], head: bigint, seenAt: number): Promise<StoredEvent[]> {
    const out: StoredEvent[] = [];
    for (const log of logs) {
      const orderId = this.#spec.orderIdOf(log);
      out.push({
        chain: this.#spec.chain.name,
        block: Number(log.blockNumber),
        tx: log.transactionHash.toLowerCase(),
        logIndex: log.logIndex,
        address: log.address.toLowerCase(),
        name: log.eventName,
        orderId: orderId === null ? null : Number(orderId),
        args: normaliseArgs(log.args),
        blockTs: await this.#blockTime(log.blockNumber),
        seenMs: head - log.blockNumber <= LIVE_WINDOW ? seenAt : null,
      });
    }
    return out;
  }

  async #blockTime(block: bigint): Promise<number> {
    const cached = this.#blockTimes.get(block);
    if (cached !== undefined) return cached;
    const { timestamp } = await this.#client.getBlock({ blockNumber: block });
    if (this.#blockTimes.size > 5_000) this.#blockTimes.clear();
    this.#blockTimes.set(block, Number(timestamp));
    return Number(timestamp);
  }
}
