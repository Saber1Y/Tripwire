# Tripwire testnet deployment

Deployed on 2026-11-24 with `contracts/script/DeployTripwire.s.sol`, in one run across both chains.
The machine-readable copy is `contracts/deployments/tripwire.json`.

## Contracts

| Contract | Chain | Address |
|---|---|---|
| TripwireVault | Unichain Sepolia (1301) | `0x4F7248ca7Ed3A24E5cD12A2D5fb2C3C360Cd5892` |
| TripwireReactive | Reactive Lasna (5318007) | `0xd316a363B1AD478341Ba454Ef909703732aE31AE` |
| Demo pool (V4, 0.05% fee, tick spacing 10, no hooks) | Unichain Sepolia | poolId `0x878beda621992383afc41903f08cb47c959a48a908d5913222fa0748975f23e5` |
| Test tokens token0 / token1 | Unichain Sepolia | `0xde609E52D9164C227D4F174D6260289bc3E62eC2` / `0xf23147Df55089eA6bA87BF24bb4eEE6f7Cea182b` |

Checked on-chain after the deployment:

- The vault accepts callbacks only from Reactive's callback contract (`0x775c…66C1`), on behalf of the reactive contract above.
- The reactive contract watches the vault and the demo pool.
- Prepaid balances: 0.003 ETH for callbacks and 1 lREACT for reactions, with zero debt.

## First live order (stop-loss, full loop)

Order #1 sells 1 token0 if the price falls to tick -60, with a minimum output of 0.95 token1.
It was placed with `script/demo/TripwireDemo.s.sol`, which then crashed the price by selling 5 token0.

| Step | Chain | Transaction | Block time |
|---|---|---|---|
| Order created | Unichain Sepolia | `0x5d20bd4650e108a7f7d1fec1edddaffae2163cf55041381ab5da83b4c7535f60` | |
| Order armed by the reactive contract | Lasna | `0x0d32d07be6deb9555c1db3e848fd9cd60dee265be3bf3cb8875e7e88385eacfe` | |
| Price crash (origin event) | Unichain Sepolia | `0x9e49b52493a059c778bb1fa48b20d1425ebb53b56c5416e6387f44f9225500eb` (block 68682011) | t |
| Order triggered, callback requested | Lasna | `0xb18faba052da36789929a0e8357e0ab5711cbe6b883754788661189ca639fb64` (block 9147384) | t - 1 s (clock offset, see Phase 0) |
| Order executed (price re-checked, swapped) | Unichain Sepolia | `0x73454fac4cb153d025ab768b615c6aa31d64fdf667ecfbba114ae207e5ba0611` (block 68682013) | t + 2 s |

- Result: 0.988601 token1 was received for 1 token0, above the 0.95 minimum.
- The `OrderExecuted` event carries the crash transaction's hash, so the loop can be verified on-chain.
- **Latency from crash to execution: 2 blocks, 2 seconds.**
- Afterwards, the reactive contract shows the order as Done after 1 attempt.

## Re-running the demo

From `contracts/`:

```bash
DEMO_ACTION=recover forge script script/demo/TripwireDemo.s.sol --rpc-url https://sepolia.unichain.org --account tripwire-deployer --sender <deployer> --slow --broadcast
```

```bash
forge script script/demo/TripwireDemo.s.sol --rpc-url https://sepolia.unichain.org --account tripwire-deployer --sender <deployer> --slow --broadcast
```

The first command moves the price back up.
The second places a new stop-loss and crashes the price again.
