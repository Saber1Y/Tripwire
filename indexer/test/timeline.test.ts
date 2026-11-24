import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StoredEvent } from "../src/db.ts";
import { buildOrderView, toTxHash } from "../src/timeline.ts";
import { created, dec, ev } from "./fixtures.ts";

const swap = (tx: string, over: Partial<StoredEvent> = {}): StoredEvent =>
  ev({ chain: "unichain", name: "Swap", orderId: null, tx, args: { sqrtPriceX96: "1" }, ...over });

const triggered = (originTx: string, attempt: number, over: Partial<StoredEvent> = {}): StoredEvent =>
  ev({
    chain: "lasna",
    name: "OrderTriggered",
    args: { orderId: "1", originTxHash: dec(originTx), observedSqrtPriceX96: "5", originBlock: "1", attempt },
    ...over,
  });

const executed = (originTx: string, over: Partial<StoredEvent> = {}): StoredEvent =>
  ev({
    chain: "unichain",
    name: "OrderExecuted",
    args: {
      orderId: "1",
      amountOut: "988601000000000000",
      observedSqrtPriceX96: "5",
      executionSqrtPriceX96: "4",
      originBlock: "1",
      originTxHash: dec(originTx),
      originLogIndex: "0",
    },
    ...over,
  });

const rejected = (reason: number, over: Partial<StoredEvent> = {}): StoredEvent =>
  ev({ chain: "unichain", name: "OrderRejected", args: { orderId: "1", reason, currentSqrtPriceX96: "9" }, ...over });

function lookup(swaps: StoredEvent[]) {
  return (tx: string) => swaps.find((s) => s.tx === tx) ?? null;
}

describe("buildOrderView", () => {
  it("returns null without an OrderCreated event", () => {
    assert.equal(buildOrderView([], () => null), null);
  });

  it("describes a freshly created, armed order", () => {
    const view = buildOrderView(
      [created(), ev({ chain: "lasna", name: "OrderArmed", args: { orderId: "1" } })],
      () => null,
    );
    assert.ok(view);
    assert.equal(view.status, "open");
    assert.equal(view.reactiveState, "armed");
    assert.equal(view.firesBelow, true);
    assert.equal(view.maxAttempts, 3);
    assert.deepEqual(view.attempts, []);
  });

  it("joins swap, trigger and execution into one attempt with latency", () => {
    const originTx = toTxHash("4242");
    const s = swap(originTx, { block: 500, blockTs: 2_000, seenMs: 10_000 });
    const t = triggered(originTx, 1, { block: 9_000, blockTs: 1_999, seenMs: 10_700 });
    const x = executed(originTx, { block: 502, blockTs: 2_002, seenMs: 12_100 });
    const view = buildOrderView([created(), t, x], lookup([s]));
    assert.ok(view);

    assert.equal(view.status, "executed");
    assert.equal(view.attempts.length, 1);
    const a = view.attempts[0]!;
    assert.equal(a.origin?.tx, originTx);
    assert.equal(a.reactive.tx, t.tx);
    assert.equal(a.outcome?.kind, "executed");
    assert.equal(a.outcome?.kind === "executed" && a.outcome.amountOut, "988601000000000000");
    assert.equal(a.latency.unichainBlocks, 2);
    assert.equal(a.latency.blockSeconds, 2, "measured on Unichain's clock only");
    assert.equal(a.latency.wallMsApprox, 2_100, "same-RPC seen times, Lasna's not involved");
  });

  it("reports no wall-clock latency for history the watcher did not see live", () => {
    const originTx = toTxHash("7");
    const view = buildOrderView(
      [created(), triggered(originTx, 1), executed(originTx, { seenMs: null })],
      lookup([swap(originTx, { seenMs: 1 })]),
    );
    assert.equal(view?.attempts[0]?.latency.wallMsApprox, null);
    assert.notEqual(view?.attempts[0]?.latency.blockSeconds, null);
  });

  it("pairs a rejection then a later execution with the right attempts", () => {
    const first = toTxHash("1001");
    const second = toTxHash("1002");
    const events = [
      created(),
      triggered(first, 1, { block: 10 }),
      ev({ chain: "lasna", name: "OrderRearmed", args: { orderId: "1", attempts: 1 }, block: 11 }),
      triggered(second, 2, { block: 12 }),
      rejected(1, { block: 200 }),
      executed(second, { block: 210 }),
    ];
    const view = buildOrderView(events, lookup([swap(first), swap(second)]));
    assert.ok(view);
    assert.equal(view.attempts.length, 2);
    assert.equal(view.attempts[0]?.outcome?.kind, "rejected");
    assert.equal(view.attempts[0]?.outcome?.kind === "rejected" && view.attempts[0].outcome.reason, "PriceNotCrossed");
    assert.equal(view.attempts[1]?.outcome?.kind, "executed");
    assert.equal(view.attempts[1]?.originTxHash, second);
  });

  it("matches an execution by origin even if a rejection for a later trigger sorts first", () => {
    const first = toTxHash("1");
    const second = toTxHash("2");
    const view = buildOrderView(
      [created(), triggered(first, 1, { block: 1 }), triggered(second, 2, { block: 2 }), executed(first, { block: 50 }), rejected(0, { block: 40 })],
      () => null,
    );
    assert.equal(view?.attempts[0]?.outcome?.kind, "executed");
    assert.equal(view?.attempts[1]?.outcome?.kind, "rejected");
  });

  it("shows an in-flight attempt without an outcome", () => {
    const view = buildOrderView([created(), triggered(toTxHash("3"), 1)], () => null);
    assert.equal(view?.reactiveState, "pending");
    assert.equal(view?.attempts[0]?.outcome, null);
    assert.equal(view?.attempts[0]?.origin, null, "origin swap not indexed");
    assert.deepEqual(view?.attempts[0]?.latency, { unichainBlocks: null, blockSeconds: null, wallMsApprox: null });
  });

  it("records cancellation and retirement reasons", () => {
    const view = buildOrderView(
      [
        created(),
        ev({ chain: "unichain", name: "OrderCancelled", args: { orderId: "1" } }),
        ev({ chain: "lasna", name: "OrderRetired", args: { orderId: "1", reason: 1 } }),
      ],
      () => null,
    );
    assert.equal(view?.status, "cancelled");
    assert.equal(view?.reactiveState, "done");
    assert.equal(view?.retireReason, "Cancelled");
    assert.ok(view?.closed);
  });

  it("treats a failed callback as that attempt's outcome", () => {
    const view = buildOrderView(
      [created(), triggered(toTxHash("9"), 1), ev({ chain: "unichain", name: "CallbackFailure", args: {} })],
      () => null,
    );
    assert.equal(view?.attempts[0]?.outcome?.kind, "callbackFailed");
  });
});

describe("toTxHash", () => {
  it("pads a uint256 to a 32-byte hash", () => {
    assert.equal(toTxHash("255"), `0x${"0".repeat(62)}ff`);
  });
});
