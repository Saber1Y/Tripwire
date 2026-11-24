// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {ISystemContract} from "@reactive/src/interfaces/ISystemContract.sol";
import {AbstractReactive} from "@reactive/src/base/AbstractReactive.sol";
import {ITripwireVault} from "./interfaces/ITripwireVault.sol";
import {OrderHeap} from "./libraries/OrderHeap.sol";

/// @title TripwireReactive
/// @notice Lives on the Reactive Network. Mirrors the vault's open orders from its events, watches the supported
///         Uniswap V4 pools' Swap events, and requests an `execute` callback for every order whose trigger the new
///         price has crossed. Outcomes reported back by the vault (or a failed callback) close or re-arm the order.
/// @dev The reactive contract cannot read origin-chain state, so everything it knows comes from logs. The vault
///      remains the source of truth and re-checks the price itself, so a mistake here can only cost a wasted
///      callback, never a wrong execution.
contract TripwireReactive is AbstractReactive {
    using OrderHeap for OrderHeap.Heap;

    enum State {
        None,
        Armed,
        Pending,
        Done
    }

    enum RetireReason {
        Executed,
        Cancelled,
        NotOpen,
        AttemptsExhausted,
        UnwatchedPool
    }

    struct TrackedOrder {
        bytes32 poolId;
        uint160 trigger;
        bool firesBelow;
        State state;
        uint8 attempts;
        uint8 maxAttempts;
        uint64 pendingSince;
    }

    /// @dev keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)")
    uint256 public constant V4_SWAP_TOPIC0 = 0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f;
    /// @dev keccak256("CallbackFailure(address,bytes)"), emitted by the callback proxy with the target as topic1.
    uint256 public constant CALLBACK_FAILURE_TOPIC0 =
        0xc8313f695443128e273f1edfcec40b94b7deea8dfbeafd0043290d6601d999db;

    /// @dev Bounds per Swap event keep one reaction well under the 900k gas cap. Orders left crossed are picked up by
    ///      the next Swap.
    uint256 public constant MAX_TRIGGERS_PER_EVENT = 5;
    uint256 public constant MAX_POPS_PER_EVENT = 20;
    /// @dev Lasna blocks are about 1s; a callback with no outcome after this long is presumed lost.
    uint256 public constant STALE_AFTER_BLOCKS = 600;
    uint64 public constant CALLBACK_GAS_LIMIT = 600_000;

    uint256 public immutable ORIGIN_CHAIN_ID;
    address public immutable VAULT;
    address public immutable POOL_MANAGER;
    address public immutable CALLBACK_PROXY;

    mapping(bytes32 poolId => bool) public isWatchedPool;
    mapping(uint256 orderId => TrackedOrder) internal _orders;
    /// @dev Orders firing on a fall, as a max-heap on trigger (keys inverted): the highest trigger fires first.
    mapping(bytes32 poolId => OrderHeap.Heap) internal _below;
    /// @dev Orders firing on a rise, as a min-heap on trigger: the lowest trigger fires first.
    mapping(bytes32 poolId => OrderHeap.Heap) internal _above;

    event OrderArmed(uint256 indexed orderId, bytes32 indexed poolId, uint160 trigger, bool firesBelow);
    event OrderTriggered(
        uint256 indexed orderId,
        uint256 indexed originTxHash,
        uint160 observedSqrtPriceX96,
        uint256 originBlock,
        uint8 attempt
    );
    event OrderRearmed(uint256 indexed orderId, uint8 attempts);
    event OrderRetired(uint256 indexed orderId, RetireReason reason);

    error ZeroAddress();
    error NoPools();

    constructor(
        uint256 originChainId_,
        address vault_,
        address poolManager_,
        address callbackProxy_,
        bytes32[] memory poolIds_
    ) payable {
        if (vault_ == address(0) || poolManager_ == address(0) || callbackProxy_ == address(0)) {
            revert ZeroAddress();
        }
        if (poolIds_.length == 0) revert NoPools();
        ORIGIN_CHAIN_ID = originChainId_;
        VAULT = vault_;
        POOL_MANAGER = poolManager_;
        CALLBACK_PROXY = callbackProxy_;

        _subscribe(vault_, uint256(ITripwireVault.OrderCreated.selector), REACTIVE_IGNORE);
        _subscribe(vault_, uint256(ITripwireVault.OrderCancelled.selector), REACTIVE_IGNORE);
        _subscribe(vault_, uint256(ITripwireVault.OrderExecuted.selector), REACTIVE_IGNORE);
        _subscribe(vault_, uint256(ITripwireVault.OrderRejected.selector), REACTIVE_IGNORE);
        _subscribe(callbackProxy_, CALLBACK_FAILURE_TOPIC0, uint256(uint160(vault_)));
        for (uint256 i; i < poolIds_.length; ++i) {
            isWatchedPool[poolIds_[i]] = true;
            _subscribe(poolManager_, V4_SWAP_TOPIC0, uint256(poolIds_[i]));
        }
    }

    // ------------------------------------------------------------------------------------------------------------
    // Reactive entry point
    // ------------------------------------------------------------------------------------------------------------

    function react(LogRecord calldata log_) external onlySystem {
        if (log_.chainId != ORIGIN_CHAIN_ID) return;

        if (log_.contractAddress == POOL_MANAGER) {
            if (log_.topic0 == V4_SWAP_TOPIC0) _onSwap(log_);
        } else if (log_.contractAddress == VAULT) {
            if (log_.topic0 == uint256(ITripwireVault.OrderCreated.selector)) _onCreated(log_);
            else if (log_.topic0 == uint256(ITripwireVault.OrderCancelled.selector)) _onCancelled(log_);
            else if (log_.topic0 == uint256(ITripwireVault.OrderExecuted.selector)) _onExecuted(log_);
            else if (log_.topic0 == uint256(ITripwireVault.OrderRejected.selector)) _onRejected(log_);
        } else if (log_.contractAddress == CALLBACK_PROXY) {
            if (log_.topic0 == CALLBACK_FAILURE_TOPIC0 && log_.topic1 == uint256(uint160(VAULT))) {
                _onCallbackFailure(log_);
            }
        }
    }

    /// @notice Re-arms orders whose callback produced no outcome for STALE_AFTER_BLOCKS. Anyone may call it.
    /// @dev If the lost callback does arrive later, the vault sees the order closed (or the price re-checked) and
    ///      the duplicate is harmless.
    function rearmStale(uint256[] calldata orderIds_) external {
        for (uint256 i; i < orderIds_.length; ++i) {
            TrackedOrder storage o = _orders[orderIds_[i]];
            if (o.state == State.Pending && block.number >= o.pendingSince + STALE_AFTER_BLOCKS) {
                _rearmOrRetire(orderIds_[i], o);
            }
        }
    }

    // ------------------------------------------------------------------------------------------------------------
    // Event handlers
    // ------------------------------------------------------------------------------------------------------------

    function _onCreated(LogRecord calldata log_) internal {
        uint256 orderId = log_.topic1;
        if (orderId > type(uint96).max || _orders[orderId].state != State.None) return;
        bytes32 poolId = bytes32(log_.topic3);
        (bool zeroForOne, bool isStopLoss, uint160 trigger,,, uint8 maxAttempts) =
            abi.decode(log_.data, (bool, bool, uint160, uint128, uint128, uint8));

        bool firesBelow = zeroForOne == isStopLoss;
        TrackedOrder storage o = _orders[orderId];
        o.poolId = poolId;
        o.trigger = trigger;
        o.firesBelow = firesBelow;
        o.maxAttempts = maxAttempts;

        if (!isWatchedPool[poolId]) {
            o.state = State.Done;
            emit OrderRetired(orderId, RetireReason.UnwatchedPool);
            return;
        }
        o.state = State.Armed;
        _push(orderId, o);
        emit OrderArmed(orderId, poolId, trigger, firesBelow);
    }

    function _onCancelled(LogRecord calldata log_) internal {
        _retire(log_.topic1, RetireReason.Cancelled);
    }

    function _onExecuted(LogRecord calldata log_) internal {
        _retire(log_.topic1, RetireReason.Executed);
    }

    function _onRejected(LogRecord calldata log_) internal {
        uint256 orderId = log_.topic1;
        TrackedOrder storage o = _orders[orderId];
        if (o.state != State.Pending) return;
        (ITripwireVault.RejectReason reason,) = abi.decode(log_.data, (ITripwireVault.RejectReason, uint160));
        if (reason == ITripwireVault.RejectReason.NotOpen) _retire(orderId, RetireReason.NotOpen);
        else _rearmOrRetire(orderId, o);
    }

    /// @dev The proxy reports the payload it tried to deliver: selector | rvm | orderId | ... .
    function _onCallbackFailure(LogRecord calldata log_) internal {
        bytes memory payload = abi.decode(log_.data, (bytes));
        // forge-lint: disable-next-line(unsafe-typecast)
        if (payload.length < 68 || bytes4(payload) != ITripwireVault.execute.selector) return;
        uint256 orderId;
        assembly ("memory-safe") {
            orderId := mload(add(payload, 68))
        }
        TrackedOrder storage o = _orders[orderId];
        if (o.state == State.Pending) _rearmOrRetire(orderId, o);
    }

    function _onSwap(LogRecord calldata log_) internal {
        bytes32 poolId = bytes32(log_.topic1);
        if (!isWatchedPool[poolId]) return;
        (,, uint160 price,,,) = abi.decode(log_.data, (int128, int128, uint160, uint128, int24, uint24));

        uint256 triggered;
        uint256 pops;
        OrderHeap.Heap storage below = _below[poolId];
        while (triggered < MAX_TRIGGERS_PER_EVENT && pops < MAX_POPS_PER_EVENT && !below.isEmpty()) {
            OrderHeap.Entry memory top = below.peek();
            if (price > type(uint160).max - top.key) break;
            below.pop();
            ++pops;
            if (_orders[top.id].state == State.Armed) {
                _trigger(top.id, price, log_);
                ++triggered;
            }
        }

        OrderHeap.Heap storage above = _above[poolId];
        while (triggered < MAX_TRIGGERS_PER_EVENT && pops < MAX_POPS_PER_EVENT && !above.isEmpty()) {
            OrderHeap.Entry memory top = above.peek();
            if (price < top.key) break;
            above.pop();
            ++pops;
            if (_orders[top.id].state == State.Armed) {
                _trigger(top.id, price, log_);
                ++triggered;
            }
        }
    }

    // ------------------------------------------------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------------------------------------------------

    function _trigger(uint256 orderId_, uint160 price_, LogRecord calldata log_) internal {
        TrackedOrder storage o = _orders[orderId_];
        o.state = State.Pending;
        o.pendingSince = uint64(block.number);
        unchecked {
            ++o.attempts;
        }

        // The callback proxy overwrites the first argument with this contract's address.
        bytes memory payload = abi.encodeCall(
            ITripwireVault.execute, (address(0), orderId_, price_, log_.blockNumber, log_.txHash, log_.logIndex)
        );
        SYSTEM.requestCallbackV_1_0(
            ISystemContract.CallbackConfiguration_V_1_0({
                chainId: ORIGIN_CHAIN_ID, recipient: VAULT, gasLimit: CALLBACK_GAS_LIMIT, payload: payload
            })
        );
        emit OrderTriggered(orderId_, log_.txHash, price_, log_.blockNumber, o.attempts);
    }

    function _rearmOrRetire(uint256 orderId_, TrackedOrder storage o_) internal {
        if (o_.attempts >= o_.maxAttempts) {
            o_.state = State.Done;
            emit OrderRetired(orderId_, RetireReason.AttemptsExhausted);
            return;
        }
        o_.state = State.Armed;
        _push(orderId_, o_);
        emit OrderRearmed(orderId_, o_.attempts);
    }

    /// @dev Heap entries of closed orders are left in place and skipped when they surface (lazy deletion).
    function _retire(uint256 orderId_, RetireReason reason_) internal {
        TrackedOrder storage o = _orders[orderId_];
        if (o.state != State.Armed && o.state != State.Pending) return;
        o.state = State.Done;
        emit OrderRetired(orderId_, reason_);
    }

    function _push(uint256 orderId_, TrackedOrder storage o_) internal {
        // forge-lint: disable-next-line(unsafe-typecast)
        uint96 id = uint96(orderId_); // bounded in _onCreated
        if (o_.firesBelow) _below[o_.poolId].push(type(uint160).max - o_.trigger, id);
        else _above[o_.poolId].push(o_.trigger, id);
    }

    function _subscribe(address contract_, uint256 topic0_, uint256 topic1_) internal {
        SYSTEM.subscribe(ORIGIN_CHAIN_ID, contract_, topic0_, topic1_, REACTIVE_IGNORE, REACTIVE_IGNORE);
    }

    // ------------------------------------------------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------------------------------------------------

    function getOrder(uint256 orderId_) external view returns (TrackedOrder memory) {
        return _orders[orderId_];
    }

    function heapSizes(bytes32 poolId_) external view returns (uint256 below, uint256 above) {
        return (_below[poolId_].size(), _above[poolId_].size());
    }
}
