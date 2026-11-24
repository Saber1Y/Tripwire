import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Store } from "../src/db.ts";
import { isHeadRace, normaliseArgs, orderIdFromExecutePayload } from "../src/watcher.ts";
import { created, ev } from "./fixtures.ts";

describe("Store", () => {
  it("commits events with the cursor and ignores duplicates", () => {
    const store = new Store(":memory:");
    assert.equal(store.cursor("unichain"), null);

    const e = created({ tx: "0xaa", logIndex: 3 });
    store.commitBatch("unichain", 120n, [e]);
    store.commitBatch("unichain", 121n, [e]);

    assert.equal(store.cursor("unichain"), 121n);
    assert.equal(store.cursor("lasna"), null);
    assert.equal(store.eventsForOrder(1).length, 1);
    assert.deepEqual(store.eventsForOrder(1)[0]?.args, e.args);
    store.close();
  });

  it("finds swaps by tx and orders by owner", () => {
    const store = new Store(":memory:");
    store.commitBatch("unichain", 10n, [
      created({ tx: "0x01", orderId: 1 }),
      created({ tx: "0x02", orderId: 2, args: { ...created().args, orderId: "2", owner: "0xbbb" } }),
      ev({ chain: "unichain", name: "Swap", tx: "0xabc", orderId: null }),
    ]);
    assert.deepEqual(store.orderIds(), [2, 1]);
    assert.deepEqual(store.orderIds("0xBBB"), [2], "owner match is case-insensitive");
    assert.equal(store.swapByTx("0xABC")?.name, "Swap");
    assert.equal(store.swapByTx("0xdead"), null);
    store.close();
  });

  it("rolls back a batch that fails part-way", () => {
    const store = new Store(":memory:");
    const bad = { ...created({ tx: "0x02" }), args: undefined as unknown as Record<string, string> };
    assert.throws(() => store.commitBatch("unichain", 50n, [created({ tx: "0x01" }), bad]));
    assert.equal(store.cursor("unichain"), null, "cursor did not move");
    assert.equal(store.eventsForOrder(1).length, 0, "first event was rolled back too");
    store.close();
  });
});

describe("watcher helpers", () => {
  it("normalises bigints, hex case and primitives", () => {
    assert.deepEqual(normaliseArgs({ a: 10n ** 30n, b: "0xABCD", c: true, d: 7 }), {
      a: "1000000000000000000000000000000",
      b: "0xabcd",
      c: true,
      d: 7,
    });
    assert.throws(() => normaliseArgs({ x: { nested: 1 } }));
  });

  it("extracts the order id from an execute payload", () => {
    const word = (n: bigint) => n.toString(16).padStart(64, "0");
    const payload = `0x24d80dd1${word(0x1234n)}${word(42n)}${word(1n)}` as const;
    assert.equal(orderIdFromExecutePayload(payload), 42n);
    assert.equal(orderIdFromExecutePayload("0x24d80dd1"), null);
  });

  it("recognises load-balancer head races but not real errors", () => {
    const race = Object.assign(new Error("Invalid parameters were provided to the RPC method."), {
      details: "block range extends beyond current head block",
    });
    assert.equal(isHeadRace(race), true);
    assert.equal(isHeadRace(Object.assign(new Error("x"), { name: "BlockNotFoundError" })), true);
    assert.equal(isHeadRace(new Error("429 Too Many Requests")), false);
  });
});
