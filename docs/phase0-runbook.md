# Phase 0 runbook - full-loop latency spike

Goal: prove one complete Reactive loop on testnet and get a first latency number before any product code is written.

```
our V4 pool Swap (Unichain Sepolia) -> SpikeReactive.react (Lasna) -> PingReceiver.ping (Unichain Sepolia)
```

The contracts are in `contracts/src/spike/`, the scripts are in `contracts/script/spike/`, and the report script is `scripts/spike-measure.mjs`.
All commands run from `contracts/` unless noted.

## 1. Wallet and funds (you do this)

Create an encrypted keystore for a fresh testnet-only wallet.
The key is typed into a hidden prompt and is never stored in plain text:

```bash
cast wallet import tripwire-deployer --interactive
```

Fund that wallet with:

- About 0.02 ETH on Unichain Sepolia.
  This covers the deployment gas (about 0.00001 ETH at current prices) plus 0.01 ETH of prepaid callbacks.
- About 3 lREACT on Lasna.
  The deployment simulated at about 0.13 lREACT, and the scripts prepay 2 lREACT of reactive execution.
  To get lREACT, send about 0.03 ETH on Ethereum Sepolia to `0x9b9BB25f1A81078C544C829c5EB7822d747Cf434`, or on Base Sepolia to `0x2afaFD298b23b62760711756088F75B7409f5967`.
  The faucet pays 100 lREACT per 1 ETH.
  Never send more than 5 ETH in one transaction, because the excess is lost.

Then:

```bash
cp ../.env.example ../.env && set -a && source ../.env && set +a
```

## 2. Deploy, in this order

```bash
forge script script/spike/SetupPool.s.sol --rpc-url unichain_sepolia --account $DEPLOYER_ACCOUNT --broadcast
```

```bash
forge script script/spike/DeploySpikeReactive.s.sol --rpc-url lasna --account $DEPLOYER_ACCOUNT --broadcast
```

```bash
forge script script/spike/DeployPingReceiver.s.sol --rpc-url unichain_sepolia --account $DEPLOYER_ACCOUNT --broadcast
```

```bash
forge script script/spike/WireRecipient.s.sol --rpc-url lasna --account $DEPLOYER_ACCOUNT --broadcast
```

Each script writes its addresses to `contracts/deployments/spike.json`.
Simulations without `--broadcast` write to `spike.dry-run.json` instead and never touch the real file.

## 3. Trigger loops

```bash
forge script script/spike/Swap.s.sol --rpc-url unichain_sepolia --account $DEPLOYER_ACCOUNT --broadcast
```

Repeat a few times.
Set `SWAP_ZERO_FOR_ONE=false` to push the price back the other way.

## 4. Measure (from the repo root)

```bash
node scripts/spike-measure.mjs
```

For each loop, it prints the origin, reactive and callback tx hashes, the time for each leg, and the median and p95.

## Gate

Phase 0 passes when at least five loops show all three transactions, and the latency is recorded in this file.

If no `Ping` arrives:

- Check the reactive contract's debt and reserves on Lasna: `cast call 0x8888888888888888888888888888888888888888 "debt(address)(uint256)" <spikeReactive> --rpc-url lasna`.
- Check the receiver's debt on the callback contract: `cast call 0x775c9B990ADe401060B78D0e98684eEf8d2466C1 "debt(address)(uint256)" <pingReceiver> --rpc-url unichain_sepolia`.
- Inspect the reactive transaction on https://lasna.reactscan.net/.

## Results

Run on 2026-11-24.
**The gate passed: 10 of 10 loops completed.**

### Deployed contracts

| Contract | Chain | Address |
|---|---|---|
| token0 / token1 (test tokens) | Unichain Sepolia | `0xde609E52D9164C227D4F174D6260289bc3E62eC2` / `0xf23147Df55089eA6bA87BF24bb4eEE6f7Cea182b` |
| Pool (V4, fee 0.3%, tick spacing 60) | Unichain Sepolia | poolId `0xb26c1aaf4752dd394a0d05f246d7adc888e6adacf381744421927241030a54e6` |
| PoolSwapTest router | Unichain Sepolia | `0xe66dd4f6A29ab1843A39Df47f0D0f9e46F3B858f` |
| SpikeReactive | Lasna | `0xf23147Df55089eA6bA87BF24bb4eEE6f7Cea182b` |
| PingReceiver | Unichain Sepolia | `0xfB88d06289EaDD3aE23ef5C7bEF816baFfbf4000` |

SpikeReactive and token1 have the same address on different chains, because the same deployer nonce was used on both.

### Example full loop

- Origin swap: `0xd7a40d5255407b86819e87ba80795483da7d47f74f0df4111da2a172c51a5455` (Unichain Sepolia)
- Reactive transaction: `0x97e545a778160136488c3d2a072f0ad6bef2f08e9ee540f5e3d6ef97b99734e8` (Lasna)
- Callback: `0x081686f1d82ce8109847a7c548b9d9fe7d876e8d1a113eb0c9049b6c32b5a4d1` (Unichain Sepolia)

### Latency (block timestamps, whole-second resolution)

- Full loop, from the origin swap to the callback landing on Unichain: **median 2 s, p95 3 s, max 3 s**, over 10 loops.
- The full loop is measured on one chain's clock, so this number is reliable.

### Finding: per-leg numbers need a wall-clock watcher

The origin-to-reactive leg showed **-1 s** in 8 of 10 loops.
A Lasna block cannot really come before the Unichain block it reacts to.
So Lasna's block timestamps run about 1 s behind Unichain's, or the two chains round time differently.
Block timestamps from two different chains cannot be compared to better than about ±1 s.
For the leg breakdown on the dashboard, Phase 3's watcher must record the wall-clock time each transaction is first seen, as already planned.
