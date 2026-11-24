# How Tripwire measures latency

Tripwire reports how long it takes from the swap that crosses an order's trigger to the vault executing (or rejecting) that order.
This page explains what is measured, and why some numbers that look natural are deliberately not reported.

## What is reported

For every attempt, the indexer (`indexer/src/timeline.ts`) joins three transactions:

1. The origin `Swap` on the Uniswap V4 PoolManager (Unichain Sepolia).
2. The `OrderTriggered` reaction on Lasna, which carries the origin transaction hash.
3. The vault's `OrderExecuted`, which also carries the origin transaction hash, or its `OrderRejected` or the proxy's `CallbackFailure`.

From these it reports three numbers, all measured on one chain:

| Metric | Meaning | Precision |
|---|---|---|
| `unichainBlocks` | Outcome block minus origin block | Exact; anyone can verify it from the two transaction hashes |
| `blockSeconds` | Outcome block timestamp minus origin block timestamp | Whole seconds, on Unichain's clock |
| `wallMsApprox` | When the indexer first saw the outcome minus when it first saw the origin swap | Approximate; see below |

`/api/latency` gives the median, p95 and max of each.

## What is not reported, and why

### A cross-chain split (swap to reaction, reaction to callback)

Splitting the loop at the Lasna reaction would need a reliable Lasna time and a reliable Unichain time, and neither chain provides one that can be compared with the other:

- **The chains stamp blocks differently.**
  An OP Stack block stamped `T` is built during the second before `T`.
  The Unichain RPC's `pending` block is always stamped one second ahead of the wall clock.
  Lasna's CometBFT block time trails real time.
  In every loop measured so far, the Lasna reaction carries a timestamp about 1 s *earlier* than the Unichain swap it reacted to (10 of 10 spike loops, and both Tripwire orders).
  That is a clock convention, not time travel.
- **The public RPCs report new blocks late.**
  Measured on 2026-11-24, the indexer first saw blocks about 2.3 to 2.7 s after their timestamp on both chains.
  The `latest` head was 0.7 to 1.8 s old when queried.
  The jitter alone is about half a second.

Joining those two error sources gives numbers such as "-1066 ms from swap to reaction".
That number was observed, and it is clearly noise.
Publishing it would be misleading.

### Why `wallMsApprox` is still useful

Both ends of `wallMsApprox` are Unichain events, seen through the same Unichain RPC by the same poller.
The RPC's lag is roughly constant, so it mostly cancels out.
What remains is the poll interval (250 ms) and the RPC's jitter, so treat it as plus or minus about half a second.
It is only recorded for loops the indexer saw live.
History indexed after the fact has no first-seen time.

## Observed so far

| Run | Loops | Unichain blocks | Seconds (Unichain clock) | Wall clock (approx.) |
|---|---|---|---|---|
| Phase 0 spike (ping only) | 10 | 2 to 3 | median 2, p95 3 | n/a |
| Tripwire orders #1 and #2 (stop-loss executed) | 2 | 2 | 2 | 1.59 s (order #2) |

## Improving precision later

A self-hosted or low-latency RPC on each chain would shrink the observation lag, and so would Unichain's flashblocks feed, which gives about 200 ms granularity.
That would make a sub-second split meaningful.
It is not done yet.
Until then, the block-count numbers above are the honest headline.
