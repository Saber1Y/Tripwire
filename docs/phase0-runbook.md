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

_Not run yet._
