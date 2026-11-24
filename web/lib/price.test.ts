import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applySlippage,
  firesBelow,
  isqrt,
  outAtTrigger,
  priceToSqrtX96,
  Q96,
  sqrtX96ToPrice,
  triggerProblem,
} from "./price.ts";

// TickMath.getSqrtPriceAtTick(-60), the trigger of live order #1.
const TICK_MINUS_60 = 78990846045029531151608375686n;

describe("isqrt", () => {
  it("floors exactly", () => {
    assert.equal(isqrt(0n), 0n);
    assert.equal(isqrt(15n), 3n);
    assert.equal(isqrt(16n), 4n);
    assert.equal(isqrt(10n ** 40n), 10n ** 20n);
  });
});

describe("price conversion", () => {
  it("maps 1.0 to Q96 exactly", () => {
    assert.equal(priceToSqrtX96("1"), Q96);
  });

  it("round-trips the live order's trigger to within a hair", () => {
    const price = sqrtX96ToPrice(TICK_MINUS_60);
    assert.ok(Math.abs(price - 1.0001 ** -60) < 1e-12);
    const back = priceToSqrtX96(price.toFixed(18));
    const diff = back > TICK_MINUS_60 ? back - TICK_MINUS_60 : TICK_MINUS_60 - back;
    // The float display price carries ~1e-16 relative error; anything under 1e-12 is invisible at 6 decimals.
    assert.ok(Number(diff) / Number(TICK_MINUS_60) < 1e-12, `relative drift ${Number(diff) / Number(TICK_MINUS_60)}`);
  });

  it("rejects non-positive prices", () => {
    assert.throws(() => priceToSqrtX96("0"));
  });
});

describe("trigger direction", () => {
  it("matches the vault's four cases", () => {
    assert.equal(firesBelow(true, true), true);
    assert.equal(firesBelow(true, false), false);
    assert.equal(firesBelow(false, true), false);
    assert.equal(firesBelow(false, false), true);
  });

  it("flags a trigger that would fire immediately", () => {
    assert.equal(triggerProblem(true, TICK_MINUS_60, Q96), null);
    assert.match(triggerProblem(true, Q96, TICK_MINUS_60) ?? "", /already/);
    assert.equal(triggerProblem(false, Q96, TICK_MINUS_60), null);
    assert.match(triggerProblem(false, TICK_MINUS_60, Q96) ?? "", /already/);
  });
});

describe("minimum output", () => {
  it("matches order #1: 1 token0 at tick -60, 0.05% fee", () => {
    const out = outAtTrigger(10n ** 18n, TICK_MINUS_60, true, 500);
    // 1.0001^-60 = 0.994018; minus 0.05% fee = 0.993521. Live execution received 0.988601 after price impact.
    assert.ok(out > 993_500_000_000_000_000n && out < 993_530_000_000_000_000n, `${out}`);
    const min = applySlippage(out, 100);
    assert.ok(min < 988_601_195_767_878_388n, "1% slippage would have let the live order through");
  });

  it("inverts the price when selling token1", () => {
    const out = outAtTrigger(10n ** 18n, TICK_MINUS_60, false, 0);
    assert.ok(Math.abs(Number(out) / 1e18 - 1 / 1.0001 ** -60) < 1e-9);
  });
});
