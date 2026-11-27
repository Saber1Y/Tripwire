# Phase 5 results - live load test and edge cases

Run on 2026-11-26 and 2026-11-27 against the deployed contracts on Unichain Sepolia and Reactive Lasna.
Driven by `scripts/load-test.sh` and `contracts/script/demo/TripwireDemo.s.sol`, and checked against the indexer after every step.

## Totals

| Measure | Value |
| --- | --- |
| Orders placed | 57 |
| Attempts (callbacks) with an on-chain outcome | 60 of 60 |
| Executed | 55 |
| Refused on purpose (edge cases) | 5: 2 PriceNotCrossed, 2 SwapFailed, 1 NotOpen |
| Unichain blocks, crossing swap to outcome | min 1, median 2, p95 2, max 3 |
| Seconds on Unichain's clock | min 1, median 2, p95 2, max 3 |
| Wall clock, same-RPC approximation (58 live loops) | min 0.86 s, median 2.01 s, p95 2.76 s, max 3.20 s |

Distribution in blocks: 1 block once, 2 blocks 56 times, 3 blocks 3 times.

The single 1-block loop is order #49: swap `0x7b462b65fa585d543765944be5792b3737c8e7ad04267e85b49875a7e45495c3`, execution `0x1c2150e399aa3cd1119cf8dee97103bedc2769304bed78460ecc7aee18c805e7`.

See `latency-methodology.md` for why only same-chain figures are reported.

## Live edge cases

Each scenario was staged on testnet and its outcome read back from chain events.

| Scenario | Order | What happened | Key transactions |
| --- | --- | --- | --- |
| Price bounces back before the callback | #5 | Attempt 1 refused `PriceNotCrossed`, Reactive re-armed, attempt 2 executed on the next crossing | refused `0x60f455923e0e9f1479707290f021bb0dc205513bf2fd036eed08f16818b974dc`, executed `0x2a47b58ff78916165c895340ef82b843b59c56daf219e9c963c7ee019f6f2216` |
| Same, second instance | #4 | Attempt 1 refused `PriceNotCrossed`, attempt 2 executed | refused `0x3844e223d72aba4e5208d5600265cf65be2c2256240cda1e3453d8eeea865647`, executed `0xbd66aa890f86732b777aec9cb6bce0cbdf66af3a1f01e30409b312db966a3166` |
| Minimum output cannot be met | #6 | Two `SwapFailed` refusals, Reactive retired it (`AttemptsExhausted`), owner cancelled and was refunded | refused `0x4284d40377e7838ab8d9934c7ead9909b76fc1e0842785f14cfccebdc971faed` and `0xeb83482768e12465321a998fbf392990f3eec922006b962c7c591217c4b5ce10`, cancel `0x9c2a936d71ec92f178f284607459eee786bc90f75828e9422a4fd39be9a3b484` |
| Cancel while the callback is in flight | #7 | Cancel landed first; the callback found the order closed (`NotOpen`) and traded nothing | cancel `0x23100d95fcda85e53d7e11c756e55fbdd96721a06c4dec96f3318b486f3b4d2a`, refused `0x1ff1bcc6e51223bb2c3d540859c086f0256006af72a946e68d5fe07d54cdc20d` |

## Findings

**The loop outruns a receipt-by-receipt script.**
The first bounce attempt (order #3) sent the recovery swap after waiting for the crash's receipt, and the order had already executed by then.
Staging a bounce or a cancel race needs the follow-up transactions submitted back to back, so the runner does that for those two scenarios only.

**The public Unichain RPC is the weakest link, not the protocol.**
Twelve loops of the first 50-loop run failed because `sepolia.unichain.org` stopped answering for about fifteen minutes; none of them broadcast anything.
The runner now retries network failures for about two and a half minutes and never retries after a broadcast, so it cannot duplicate an order.
The rerun of those 12 loops executed all 12.

**Cost per order.**
About 0.07 lREACT of reactions per order on Lasna (order events plus the swaps around it), and about 0.0000003 ETH per callback on Unichain.
The reactive reserve went from 4.37 to 0.28 lREACT over this run and needs a top-up before the next batch.

## Reproduce

```bash
cd Tripwire && node indexer/src/main.ts  # keep running
```

```bash
cd Tripwire && scripts/load-test.sh edge
```

```bash
cd Tripwire && scripts/load-test.sh load 50
```
