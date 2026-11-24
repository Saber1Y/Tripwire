import { rejectReasons, retireReasons } from "./abi.ts";
import type { StoredEvent } from "./db.ts";

/** Where and when one step of the loop happened. */
export interface Leg {
  readonly chain: "unichain" | "lasna";
  readonly tx: string;
  readonly block: number;
  /** Block timestamp, seconds. */
  readonly blockTs: number;
  /** Wall-clock ms the watcher first saw it, or null if indexed from history. */
  readonly seenMs: number | null;
}

export type Outcome =
  | { readonly kind: "executed"; readonly leg: Leg; readonly amountOut: string; readonly executionSqrtPriceX96: string }
  | { readonly kind: "rejected"; readonly leg: Leg; readonly reason: string; readonly currentSqrtPriceX96: string }
  | { readonly kind: "callbackFailed"; readonly leg: Leg };

/**
 * Only same-chain measurements are reported. Lasna and Unichain stamp blocks differently (an OP Stack block stamped T
 * is built during the second before T; Lasna's CometBFT stamps lag real time), and the public RPCs report new blocks
 * 1-2.5 s late with about half a second of jitter, so a cross-chain split of the loop would be noise, not data.
 * See docs/latency-methodology.md.
 */
export interface Latency {
  /** Unichain blocks from the origin swap to the outcome. Exact and verifiable on-chain. */
  readonly unichainBlocks: number | null;
  /** Origin swap block to outcome block on Unichain's clock, seconds (whole-second resolution). */
  readonly blockSeconds: number | null;
  /**
   * When the watcher first saw the outcome minus when it first saw the origin swap, ms. Both come through the same
   * Unichain RPC, so its lag cancels out; what remains is approximate, give or take the RPC's jitter.
   */
  readonly wallMsApprox: number | null;
}

export interface Attempt {
  readonly attempt: number;
  readonly observedSqrtPriceX96: string;
  /** The Swap that crossed the trigger. Null if it was not indexed (e.g. before the start block). */
  readonly origin: (Leg & { readonly txHash: string }) | null;
  readonly originTxHash: string;
  readonly reactive: Leg;
  readonly outcome: Outcome | null;
  readonly latency: Latency;
}

export type VaultStatus = "open" | "executed" | "cancelled";
export type ReactiveState = "unseen" | "armed" | "pending" | "done";

export interface OrderView {
  readonly id: number;
  readonly owner: string;
  readonly poolId: string;
  readonly zeroForOne: boolean;
  readonly isStopLoss: boolean;
  /** True when the order fires on the price falling to the trigger. */
  readonly firesBelow: boolean;
  readonly triggerSqrtPriceX96: string;
  readonly amountIn: string;
  readonly minAmountOut: string;
  readonly maxAttempts: number;
  readonly status: VaultStatus;
  readonly reactiveState: ReactiveState;
  readonly retireReason: string | null;
  readonly created: Leg;
  readonly armed: Leg | null;
  readonly closed: Leg | null;
  readonly attempts: readonly Attempt[];
}

const legOf = (e: StoredEvent): Leg => ({
  chain: e.chain,
  tx: e.tx,
  block: e.block,
  blockTs: e.blockTs,
  seenMs: e.seenMs,
});

const str = (e: StoredEvent, key: string): string => {
  const v = e.args[key];
  if (v === undefined) throw new Error(`${e.name} ${e.tx}: missing arg ${key}`);
  return String(v);
};

const bool = (e: StoredEvent, key: string): boolean => e.args[key] === true;

/** Uint256 decimal string to 0x-prefixed 32-byte hex, as transaction hashes are written. */
export const toTxHash = (decimal: string): string => `0x${BigInt(decimal).toString(16).padStart(64, "0")}`;

const byPosition = (a: StoredEvent, b: StoredEvent): number => a.block - b.block || a.logIndex - b.logIndex;

function latencyOf(origin: Leg | null, outcome: Outcome | null): Latency {
  if (outcome === null || origin === null) return { unichainBlocks: null, blockSeconds: null, wallMsApprox: null };
  return {
    unichainBlocks: outcome.leg.block - origin.block,
    blockSeconds: outcome.leg.blockTs - origin.blockTs,
    wallMsApprox:
      origin.seenMs !== null && outcome.leg.seenMs !== null ? outcome.leg.seenMs - origin.seenMs : null,
  };
}

/**
 * Rebuilds one order's full story from its events on both chains.
 *
 * Every trigger on Lasna produces exactly one callback, so outcomes on Unichain pair with triggers in order. An
 * OrderExecuted names its origin swap, so it is matched by that first; rejections and failed callbacks carry no
 * origin and take the earliest trigger still waiting for an outcome.
 */
export function buildOrderView(
  events: readonly StoredEvent[],
  swapByTx: (tx: string) => StoredEvent | null,
): OrderView | null {
  const created = events.find((e) => e.name === "OrderCreated");
  if (created === undefined) return null;

  const unichain = events.filter((e) => e.chain === "unichain").sort(byPosition);
  const lasna = events.filter((e) => e.chain === "lasna").sort(byPosition);

  let status: VaultStatus = "open";
  let closed: Leg | null = null;
  for (const e of unichain) {
    if (e.name === "OrderExecuted") (status = "executed"), (closed = legOf(e));
    else if (e.name === "OrderCancelled") (status = "cancelled"), (closed = legOf(e));
  }

  let reactiveState: ReactiveState = "unseen";
  let retireReason: string | null = null;
  let armed: Leg | null = null;
  for (const e of lasna) {
    if (e.name === "OrderArmed") (reactiveState = "armed"), (armed = legOf(e));
    else if (e.name === "OrderTriggered") reactiveState = "pending";
    else if (e.name === "OrderRearmed") reactiveState = "armed";
    else if (e.name === "OrderRetired") {
      reactiveState = "done";
      retireReason = retireReasons[Number(str(e, "reason"))] ?? str(e, "reason");
    }
  }

  const triggers = lasna.filter((e) => e.name === "OrderTriggered");
  const outcomes = new Map<StoredEvent, Outcome>();
  const outcomeEvents = unichain.filter(
    (e) => e.name === "OrderExecuted" || e.name === "OrderRejected" || e.name === "CallbackFailure",
  );
  const assigned = new Set<StoredEvent>();

  for (const e of outcomeEvents.filter((o) => o.name === "OrderExecuted")) {
    const origin = toTxHash(str(e, "originTxHash"));
    const t = triggers.find((tr) => !outcomes.has(tr) && toTxHash(str(tr, "originTxHash")) === origin);
    if (t === undefined) continue;
    outcomes.set(t, {
      kind: "executed",
      leg: legOf(e),
      amountOut: str(e, "amountOut"),
      executionSqrtPriceX96: str(e, "executionSqrtPriceX96"),
    });
    assigned.add(e);
  }
  for (const e of outcomeEvents) {
    if (assigned.has(e) || e.name === "OrderExecuted") continue;
    const t = triggers.find((tr) => !outcomes.has(tr));
    if (t === undefined) break;
    outcomes.set(
      t,
      e.name === "OrderRejected"
        ? {
            kind: "rejected",
            leg: legOf(e),
            reason: rejectReasons[Number(str(e, "reason"))] ?? str(e, "reason"),
            currentSqrtPriceX96: str(e, "currentSqrtPriceX96"),
          }
        : { kind: "callbackFailed", leg: legOf(e) },
    );
  }

  const attempts: Attempt[] = triggers.map((t) => {
    const originTxHash = toTxHash(str(t, "originTxHash"));
    const swap = swapByTx(originTxHash);
    const origin = swap === null ? null : { ...legOf(swap), txHash: originTxHash };
    const reactive = legOf(t);
    const outcome = outcomes.get(t) ?? null;
    return {
      attempt: Number(str(t, "attempt")),
      observedSqrtPriceX96: str(t, "observedSqrtPriceX96"),
      origin,
      originTxHash,
      reactive,
      outcome,
      latency: latencyOf(origin, outcome),
    };
  });

  const zeroForOne = bool(created, "zeroForOne");
  const isStopLoss = bool(created, "isStopLoss");
  return {
    id: Number(str(created, "orderId")),
    owner: str(created, "owner"),
    poolId: str(created, "poolId"),
    zeroForOne,
    isStopLoss,
    firesBelow: zeroForOne === isStopLoss,
    triggerSqrtPriceX96: str(created, "triggerSqrtPriceX96"),
    amountIn: str(created, "amountIn"),
    minAmountOut: str(created, "minAmountOut"),
    maxAttempts: Number(str(created, "maxAttempts")),
    status,
    reactiveState,
    retireReason,
    created: legOf(created),
    armed,
    closed,
    attempts,
  };
}
