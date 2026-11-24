import { parseAbi } from "viem";

/** Events emitted by TripwireVault (Unichain Sepolia). Must match contracts/src/interfaces/ITripwireVault.sol. */
export const vaultEvents = parseAbi([
  "event OrderCreated(uint256 indexed orderId, address indexed owner, bytes32 indexed poolId, bool zeroForOne, bool isStopLoss, uint160 triggerSqrtPriceX96, uint128 amountIn, uint128 minAmountOut, uint8 maxAttempts)",
  "event OrderCancelled(uint256 indexed orderId)",
  "event OrderExecuted(uint256 indexed orderId, uint256 amountOut, uint160 observedSqrtPriceX96, uint160 executionSqrtPriceX96, uint256 originBlock, uint256 originTxHash, uint256 originLogIndex)",
  "event OrderRejected(uint256 indexed orderId, uint8 reason, uint160 currentSqrtPriceX96)",
]);

/** Uniswap V4 PoolManager swap event; topic1 is the pool id. */
export const swapEvent = parseAbi([
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
]);

/** Emitted by the Reactive callback proxy when a delivered callback reverts; topic1 is the target contract. */
export const callbackFailureEvent = parseAbi(["event CallbackFailure(address indexed target, bytes payload)"]);

/** Events emitted by TripwireReactive (Lasna). Must match contracts/src/TripwireReactive.sol. */
export const reactiveEvents = parseAbi([
  "event OrderArmed(uint256 indexed orderId, bytes32 indexed poolId, uint160 trigger, bool firesBelow)",
  "event OrderTriggered(uint256 indexed orderId, uint256 indexed originTxHash, uint160 observedSqrtPriceX96, uint256 originBlock, uint8 attempt)",
  "event OrderRearmed(uint256 indexed orderId, uint8 attempts)",
  "event OrderRetired(uint256 indexed orderId, uint8 reason)",
]);

export const unichainEvents = [...vaultEvents, ...swapEvent, ...callbackFailureEvent] as const;

/** Reads used by the API for live balances and pool state. */
export const readAbi = parseAbi([
  "function reserves(address) view returns (uint256)",
  "function debt(address) view returns (uint256)",
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
]);

/** Order of ITripwireVault.RejectReason. */
export const rejectReasons = ["NotOpen", "PriceNotCrossed", "SwapFailed"] as const;

/** Order of TripwireReactive.RetireReason. */
export const retireReasons = ["Executed", "Cancelled", "NotOpen", "AttemptsExhausted", "UnwatchedPool"] as const;
