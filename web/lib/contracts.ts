import { getAddress, parseAbi, type Address, type Hex } from "viem";
import spike from "../../contracts/deployments/spike.json" with { type: "json" };
import tripwire from "../../contracts/deployments/tripwire.json" with { type: "json" };

/** Addresses come straight from the deployment files the Foundry scripts write, so they cannot drift. */
export const deployment = {
  vault: getAddress(tripwire.vault),
  reactive: getAddress(tripwire.reactive),
  poolId: tripwire.poolId as Hex,
  fee: tripwire.fee,
  tickSpacing: tripwire.tickSpacing,
  token0: getAddress(spike.token0),
  token1: getAddress(spike.token1),
  swapRouter: getAddress(spike.swapRouter),
} as const;

export const callbackProxy: Address = "0x775c9B990ADe401060B78D0e98684eEf8d2466C1";

export const poolKey = {
  currency0: deployment.token0,
  currency1: deployment.token1,
  fee: deployment.fee,
  tickSpacing: deployment.tickSpacing,
  hooks: "0x0000000000000000000000000000000000000000" as Address,
} as const;

/** The demo tokens have no symbol on-chain; these are display names. */
export const tokenLabel = { 0: "TKN0", 1: "TKN1" } as const;

export const vaultAbi = parseAbi([
  "function createOrder(bytes32 poolId, bool zeroForOne, bool isStopLoss, uint160 triggerSqrtPriceX96, uint128 amountIn, uint128 minAmountOut, uint8 maxAttempts) returns (uint256 orderId)",
  "function cancelOrder(uint256 orderId)",
  "function MAX_ATTEMPTS() view returns (uint8)",
  "error UnsupportedPool()",
  "error ZeroAmount()",
  "error AttemptsOutOfRange()",
  "error ZeroMinAmountOut()",
  "error TriggerOutOfRange()",
  "error TriggerAlreadyCrossed(uint160 currentSqrtPriceX96)",
  "error FeeOnTransferToken()",
  "error NotOrderOwner()",
  "error OrderNotOpen(uint8 status)",
  "error Reentrancy()",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function mint(address to, uint256 amount)",
]);

/** v4-core's PoolSwapTest, used by the sandbox controls to move the demo pool's price. */
export const swapRouterAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct SwapParams { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }",
  "struct TestSettings { bool takeClaims; bool settleUsingBurn; }",
  "function swap(PoolKey key, SwapParams params, TestSettings testSettings, bytes hookData) payable returns (int256)",
]);

export const MIN_SQRT_PRICE_PLUS_1 = 4295128740n;
export const MAX_SQRT_PRICE_MINUS_1 = 1461446703485210103287273052203988822378723970341n;
