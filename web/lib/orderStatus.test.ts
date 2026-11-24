import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { displayStatus } from "./orderStatus.ts";

const base = { status: "open", reactiveState: "armed", retireReason: null, attempts: [], maxAttempts: 3 } as const;

describe("displayStatus", () => {
  it("lets the vault's closed state win", () => {
    assert.equal(displayStatus({ ...base, status: "executed", reactiveState: "pending" }).label, "Executed");
    assert.equal(displayStatus({ ...base, status: "cancelled", reactiveState: "armed" }).label, "Cancelled");
  });

  it("walks the live states", () => {
    assert.equal(displayStatus({ ...base, reactiveState: "unseen" }).label, "Arming");
    assert.equal(displayStatus(base).label, "Armed");
    const firing = displayStatus({ ...base, reactiveState: "pending" });
    assert.equal(firing.label, "Firing");
    assert.equal(firing.live, true);
  });

  it("tells the user how to recover a stopped order", () => {
    const s = displayStatus({ ...base, reactiveState: "done", retireReason: "AttemptsExhausted" });
    assert.equal(s.label, "Stopped");
    assert.equal(s.tone, "bad");
    assert.match(s.detail, /Cancel to get your tokens back/);
  });
});
