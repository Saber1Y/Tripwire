import { parseUnits } from "viem";

/**
 * Price maths for the demo pool. Both test tokens have 18 decimals, so a V4 sqrtPriceX96 maps directly to
 * "token1 per token0" with no decimal adjustment.
 */

export const Q96 = 2n ** 96n;
const Q192 = Q96 * Q96;
const PRICE_DECIMALS = 18;

/** Integer square root (floor), Newton's method. */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError("isqrt of a negative number");
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) >> 1n;
  while (y < x) {
    x = y;
    y = (x + n / x) >> 1n;
  }
  return x;
}

/** "0.9940" (token1 per token0) to sqrtPriceX96, exact to 18 decimals of price. */
export function priceToSqrtX96(price: string): bigint {
  const scaled = parseUnits(price.trim(), PRICE_DECIMALS);
  if (scaled <= 0n) throw new RangeError("price must be positive");
  return isqrt((scaled * Q192) / 10n ** BigInt(PRICE_DECIMALS));
}

/** sqrtPriceX96 to a float price, for display and charting only. */
export function sqrtX96ToPrice(sqrtPriceX96: bigint | string): number {
  const ratio = Number(BigInt(sqrtPriceX96)) / Number(Q96);
  return ratio * ratio;
}

export function formatPrice(price: number): string {
  if (!Number.isFinite(price)) return "–";
  return price.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 6 });
}

/** True when an order fires on the price falling to its trigger. Mirrors TripwireVault.triggerFiresBelow. */
export function firesBelow(zeroForOne: boolean, isStopLoss: boolean): boolean {
  return zeroForOne === isStopLoss;
}

/** Null when the trigger is valid; otherwise why the vault would reject it as already crossed. */
export function triggerProblem(fireBelow: boolean, trigger: bigint, current: bigint): string | null {
  if (fireBelow && current <= trigger) return "This trigger is already at or above the current price, so it would fire now.";
  if (!fireBelow && current >= trigger) return "This trigger is already at or below the current price, so it would fire now.";
  return null;
}

/**
 * Output if the whole order filled exactly at the trigger price, after the pool fee. Ignores price impact, which on
 * the demo pool's liquidity is small for demo-sized orders; slippage tolerance covers the rest.
 */
export function outAtTrigger(amountIn: bigint, triggerSqrtX96: bigint, zeroForOne: boolean, feePips: number): bigint {
  const gross = zeroForOne
    ? (amountIn * triggerSqrtX96 * triggerSqrtX96) / Q192
    : (amountIn * Q192) / (triggerSqrtX96 * triggerSqrtX96);
  return (gross * BigInt(1_000_000 - feePips)) / 1_000_000n;
}

export function applySlippage(amount: bigint, slippageBps: number): bigint {
  return (amount * BigInt(10_000 - slippageBps)) / 10_000n;
}
