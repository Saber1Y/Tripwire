import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { distribution, percentile } from "../src/stats.ts";

describe("percentile", () => {
  it("uses nearest rank, returning observed values only", () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    assert.equal(percentile(xs, 50), 5);
    assert.equal(percentile(xs, 95), 10);
    assert.equal(percentile(xs, 0), 1);
    assert.equal(percentile(xs, 100), 10);
  });

  it("handles empty and single inputs", () => {
    assert.equal(percentile([], 50), null);
    assert.equal(percentile([7], 95), 7);
  });
});

describe("distribution", () => {
  it("sorts before summarising", () => {
    assert.deepEqual(distribution([3, 1, 2, 2, 3, 3, 2, 2, 2, 2]), { count: 10, min: 1, median: 2, p95: 3, max: 3 });
  });

  it("matches the Phase 0 spike numbers", () => {
    // Ten loops measured on 2026-11-24: nine of 2s and one of 3s.
    const d = distribution([2, 2, 2, 2, 2, 2, 2, 2, 3, 2]);
    assert.equal(d.median, 2);
    assert.equal(d.p95, 3);
    assert.equal(d.max, 3);
  });

  it("is all-null when empty", () => {
    assert.deepEqual(distribution([]), { count: 0, min: null, median: null, p95: null, max: null });
  });
});
