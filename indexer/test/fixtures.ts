import type { StoredEvent } from "../src/db.ts";

let counter = 0;

/** Builds a stored event with sensible defaults; tests override only what they care about. */
export function ev(
  partial: Partial<StoredEvent> & Pick<StoredEvent, "chain" | "name"> & { args?: StoredEvent["args"] },
): StoredEvent {
  counter += 1;
  return {
    block: 100 + counter,
    tx: `0x${counter.toString(16).padStart(64, "0")}`,
    logIndex: 0,
    address: "0xabc",
    orderId: 1,
    blockTs: 1_000 + counter,
    seenMs: null,
    args: {},
    ...partial,
  };
}

export const created = (over: Partial<StoredEvent> = {}): StoredEvent =>
  ev({
    chain: "unichain",
    name: "OrderCreated",
    args: {
      orderId: "1",
      owner: "0x3f5b96a494061f7338da529e3047809ac6a7fb84",
      poolId: "0xpool",
      zeroForOne: true,
      isStopLoss: true,
      triggerSqrtPriceX96: "78990846045029531151608375686",
      amountIn: "1000000000000000000",
      minAmountOut: "950000000000000000",
      maxAttempts: 3,
    },
    ...over,
  });

/** Decimal form of a 0x tx hash, as the contracts emit `originTxHash`. */
export const dec = (hex: string): string => BigInt(hex).toString();
