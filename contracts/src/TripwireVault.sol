// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {AbstractCallback} from "@reactive/src/base/AbstractCallback.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {SafeTransferLib} from "solmate/src/utils/SafeTransferLib.sol";
import {ITripwireVault} from "./interfaces/ITripwireVault.sol";

/// @title TripwireVault
/// @notice Escrows stop-loss and take-profit orders on Uniswap V4 pools and executes them when the Reactive Network
///         calls back. The reactive contract decides *when*; this contract re-checks the live price and decides
///         *whether*, so a stale or spoofed trigger can never execute an order at the wrong side of its trigger.
contract TripwireVault is ITripwireVault, AbstractCallback, IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using BalanceDeltaLibrary for BalanceDelta;
    using SafeTransferLib for ERC20;

    struct Order {
        address owner;
        OrderStatus status;
        bool zeroForOne;
        bool isStopLoss;
        PoolId poolId;
        uint160 triggerSqrtPriceX96;
        uint128 amountIn;
        uint128 minAmountOut;
    }

    /// @dev Every attempt is a callback paid from this vault's prepaid reserve, so users cannot ask for unlimited ones.
    uint8 public constant MAX_ATTEMPTS = 5;

    IPoolManager public immutable POOL_MANAGER;
    address public immutable OWNER;

    mapping(uint256 orderId => Order) internal _orders;
    mapping(PoolId poolId => PoolKey) internal _poolKeys;
    mapping(PoolId poolId => bool) public isPoolSupported;
    uint256 public nextOrderId = 1;

    bool private transient _locked;

    error NotOwner();
    error NotPoolManager();
    error NotSelf();
    error Reentrancy();
    error UnsupportedPool();
    error UnsupportedPoolKey();
    error ZeroAmount();
    error AttemptsOutOfRange();
    error ZeroMinAmountOut();
    error TriggerOutOfRange();
    error TriggerAlreadyCrossed(uint160 currentSqrtPriceX96);
    error FeeOnTransferToken();
    error NotOrderOwner();
    error OrderNotOpen(OrderStatus status);
    error InsufficientOutput(uint256 amountOut, uint256 minAmountOut);

    modifier nonReentrant() {
        _lock();
        _;
        _unlock();
    }

    constructor(IPoolManager poolManager_, IPayable callbackProxy_, address reactive_, address owner_)
        payable
        AbstractCallback(callbackProxy_, reactive_)
    {
        POOL_MANAGER = poolManager_;
        OWNER = owner_;
    }

    // ------------------------------------------------------------------------------------------------------------
    // Admin
    // ------------------------------------------------------------------------------------------------------------

    /// @notice Enables or disables new orders on a pool. The reactive contract must watch the same pools.
    /// @dev Only plain ERC-20 pairs without hooks: hooks can change swap deltas, and native ETH needs a separate path.
    function setPoolSupported(PoolKey calldata key_, bool supported_) external {
        if (msg.sender != OWNER) revert NotOwner();
        if (key_.currency0.isAddressZero() || address(key_.hooks) != address(0)) revert UnsupportedPoolKey();
        PoolId id = key_.toId();
        _poolKeys[id] = key_;
        isPoolSupported[id] = supported_;
        emit PoolSupportUpdated(id, supported_);
    }

    /// @notice Settles any debt owed to the callback proxy from this contract's own balance.
    function coverDebt() external {
        _coverDebt();
    }

    // ------------------------------------------------------------------------------------------------------------
    // Users
    // ------------------------------------------------------------------------------------------------------------

    /// @notice Escrows `amountIn_` of the input token and opens an order.
    /// @dev Stop-loss selling currency0 and take-profit selling currency1 fire when the price falls to the trigger;
    ///      the other two combinations fire when it rises to the trigger. The order is rejected if that has already
    ///      happened, since it would execute immediately.
    function createOrder(
        PoolId poolId_,
        bool zeroForOne_,
        bool isStopLoss_,
        uint160 triggerSqrtPriceX96_,
        uint128 amountIn_,
        uint128 minAmountOut_,
        uint8 maxAttempts_
    ) external nonReentrant returns (uint256 orderId) {
        if (!isPoolSupported[poolId_]) revert UnsupportedPool();
        if (amountIn_ == 0) revert ZeroAmount();
        // A zero minimum would let anyone who can move the price force a sale at any price (stop hunting).
        if (minAmountOut_ == 0) revert ZeroMinAmountOut();
        if (maxAttempts_ == 0 || maxAttempts_ > MAX_ATTEMPTS) revert AttemptsOutOfRange();
        if (triggerSqrtPriceX96_ <= TickMath.MIN_SQRT_PRICE || triggerSqrtPriceX96_ >= TickMath.MAX_SQRT_PRICE) {
            revert TriggerOutOfRange();
        }

        (uint160 current,,,) = POOL_MANAGER.getSlot0(poolId_);
        if (_crossed(triggerFiresBelow(zeroForOne_, isStopLoss_), triggerSqrtPriceX96_, current)) {
            revert TriggerAlreadyCrossed(current);
        }

        PoolKey memory key = _poolKeys[poolId_];
        ERC20 tokenIn = ERC20(Currency.unwrap(zeroForOne_ ? key.currency0 : key.currency1));
        uint256 balanceBefore = tokenIn.balanceOf(address(this));
        tokenIn.safeTransferFrom(msg.sender, address(this), amountIn_);
        if (tokenIn.balanceOf(address(this)) - balanceBefore != amountIn_) revert FeeOnTransferToken();

        orderId = nextOrderId++;
        _orders[orderId] = Order({
            owner: msg.sender,
            status: OrderStatus.Open,
            zeroForOne: zeroForOne_,
            isStopLoss: isStopLoss_,
            poolId: poolId_,
            triggerSqrtPriceX96: triggerSqrtPriceX96_,
            amountIn: amountIn_,
            minAmountOut: minAmountOut_
        });

        emit OrderCreated(
            orderId,
            msg.sender,
            poolId_,
            zeroForOne_,
            isStopLoss_,
            triggerSqrtPriceX96_,
            amountIn_,
            minAmountOut_,
            maxAttempts_
        );
    }

    /// @notice Cancels an open order and refunds the escrowed input. Safe against an in-flight callback, which then
    ///         finds the order closed and does nothing.
    function cancelOrder(uint256 orderId_) external nonReentrant {
        Order storage order = _orders[orderId_];
        if (order.owner != msg.sender) revert NotOrderOwner();
        if (order.status != OrderStatus.Open) revert OrderNotOpen(order.status);

        order.status = OrderStatus.Cancelled;
        PoolKey memory key = _poolKeys[order.poolId];
        ERC20(Currency.unwrap(order.zeroForOne ? key.currency0 : key.currency1))
            .safeTransfer(msg.sender, order.amountIn);
        emit OrderCancelled(orderId_);
    }

    // ------------------------------------------------------------------------------------------------------------
    // Reactive callback
    // ------------------------------------------------------------------------------------------------------------

    /// @inheritdoc ITripwireVault
    /// @dev Never reverts after authentication: the proxy charges for failed callbacks anyway, and an explicit
    ///      OrderRejected event lets the reactive contract re-arm the order instead of waiting for a timeout.
    function execute(
        address rvm_,
        uint256 orderId_,
        uint160 observedSqrtPriceX96_,
        uint256 originBlock_,
        uint256 originTxHash_,
        uint256 originLogIndex_
    ) external onlyServiceProvider onlyCallbackSender(rvm_) nonReentrant {
        Order storage order = _orders[orderId_];
        if (order.status != OrderStatus.Open) {
            emit OrderRejected(orderId_, RejectReason.NotOpen, 0);
            return;
        }

        (uint160 current,,,) = POOL_MANAGER.getSlot0(order.poolId);
        if (!_crossed(triggerFiresBelow(order.zeroForOne, order.isStopLoss), order.triggerSqrtPriceX96, current)) {
            emit OrderRejected(orderId_, RejectReason.PriceNotCrossed, current);
            return;
        }

        try this.performSwap(orderId_) returns (uint256 amountOut, uint160 priceAfter) {
            emit OrderExecuted(
                orderId_, amountOut, observedSqrtPriceX96_, priceAfter, originBlock_, originTxHash_, originLogIndex_
            );
        } catch {
            emit OrderRejected(orderId_, RejectReason.SwapFailed, current);
        }
    }

    /// @notice Executes an order's swap. Only callable by this contract, so a failure can be caught and rolled back
    ///         as a unit (status change included) without reverting the whole callback.
    function performSwap(uint256 orderId_) external returns (uint256 amountOut, uint160 priceAfter) {
        if (msg.sender != address(this)) revert NotSelf();
        Order storage order = _orders[orderId_];
        order.status = OrderStatus.Executed;

        amountOut = abi.decode(POOL_MANAGER.unlock(abi.encode(orderId_)), (uint256));
        (priceAfter,,,) = POOL_MANAGER.getSlot0(order.poolId);
    }

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata data_) external returns (bytes memory) {
        if (msg.sender != address(POOL_MANAGER)) revert NotPoolManager();
        uint256 orderId = abi.decode(data_, (uint256));
        Order memory order = _orders[orderId];
        PoolKey memory key = _poolKeys[order.poolId];

        BalanceDelta delta = POOL_MANAGER.swap(
            key,
            SwapParams({
                zeroForOne: order.zeroForOne,
                // forge-lint: disable-next-line(unsafe-typecast)
                amountSpecified: -int256(uint256(order.amountIn)),
                sqrtPriceLimitX96: order.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );

        (Currency currencyIn, Currency currencyOut) =
            order.zeroForOne ? (key.currency0, key.currency1) : (key.currency1, key.currency0);
        (int128 deltaIn, int128 deltaOut) =
            order.zeroForOne ? (delta.amount0(), delta.amount1()) : (delta.amount1(), delta.amount0());

        // Exact input with an unbounded price limit: deltaIn is minus amountIn, deltaOut is what we receive.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 amountPaid = uint256(uint128(-deltaIn));
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 amountOut = uint256(uint128(deltaOut));
        if (amountOut < order.minAmountOut) revert InsufficientOutput(amountOut, order.minAmountOut);

        POOL_MANAGER.sync(currencyIn);
        ERC20(Currency.unwrap(currencyIn)).safeTransfer(address(POOL_MANAGER), amountPaid);
        POOL_MANAGER.settle();
        POOL_MANAGER.take(currencyOut, order.owner, amountOut);

        return abi.encode(amountOut);
    }

    // ------------------------------------------------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------------------------------------------------

    function getOrder(uint256 orderId_) external view returns (Order memory) {
        return _orders[orderId_];
    }

    function getPoolKey(PoolId poolId_) external view returns (PoolKey memory) {
        return _poolKeys[poolId_];
    }

    /// @notice True when the order fires on the price falling to its trigger, false when it fires on a rise.
    /// @dev Holding currency0, a stop-loss fires on a fall; holding currency1, a stop-loss fires on a rise
    ///      (currency1 losing value against currency0 means the price of currency0 in currency1 goes up).
    function triggerFiresBelow(bool zeroForOne_, bool isStopLoss_) public pure returns (bool) {
        return zeroForOne_ == isStopLoss_;
    }

    function _lock() internal {
        if (_locked) revert Reentrancy();
        _locked = true;
    }

    function _unlock() internal {
        _locked = false;
    }

    function _crossed(bool firesBelow_, uint160 trigger_, uint160 current_) internal pure returns (bool) {
        return firesBelow_ ? current_ <= trigger_ : current_ >= trigger_;
    }
}
