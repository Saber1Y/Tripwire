// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {PoolId} from "v4-core/src/types/PoolId.sol";

/// @title ITripwireVault
/// @notice Events and callback entry point shared by the vault (origin chain) and the reactive contract (Lasna).
///         The reactive contract subscribes to these events and decodes them, so their layout is part of the
///         protocol: change them on both sides together.
interface ITripwireVault {
    enum OrderStatus {
        None,
        Open,
        Executed,
        Cancelled
    }

    enum RejectReason {
        NotOpen,
        PriceNotCrossed,
        SwapFailed
    }

    /// @param zeroForOne True when the order sells currency0 for currency1.
    /// @param isStopLoss True for a stop-loss, false for a take-profit.
    /// @param triggerSqrtPriceX96 Pool price (sqrt, Q64.96, currency1 per currency0) at which the order fires.
    /// @param maxAttempts How many times the reactive contract may trigger the order before giving up.
    event OrderCreated(
        uint256 indexed orderId,
        address indexed owner,
        PoolId indexed poolId,
        bool zeroForOne,
        bool isStopLoss,
        uint160 triggerSqrtPriceX96,
        uint128 amountIn,
        uint128 minAmountOut,
        uint8 maxAttempts
    );

    event OrderCancelled(uint256 indexed orderId);

    /// @dev `origin*` identify the Swap log that triggered the order, linking the full loop on-chain.
    event OrderExecuted(
        uint256 indexed orderId,
        uint256 amountOut,
        uint160 observedSqrtPriceX96,
        uint160 executionSqrtPriceX96,
        uint256 originBlock,
        uint256 originTxHash,
        uint256 originLogIndex
    );

    event OrderRejected(uint256 indexed orderId, RejectReason reason, uint160 currentSqrtPriceX96);

    event PoolSupportUpdated(PoolId indexed poolId, bool supported);

    /// @notice Callback target, invoked by the Reactive callback proxy on behalf of the reactive contract.
    /// @param rvm_ Overwritten by the proxy with the requesting reactive contract's address.
    function execute(
        address rvm_,
        uint256 orderId_,
        uint160 observedSqrtPriceX96_,
        uint256 originBlock_,
        uint256 originTxHash_,
        uint256 originLogIndex_
    ) external;
}
