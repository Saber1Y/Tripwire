// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {ISystemContract} from "@reactive/src/interfaces/ISystemContract.sol";
import {AbstractReactive} from "@reactive/src/base/AbstractReactive.sol";

/// @title SpikeReactive
/// @notice Phase 0 latency probe. Subscribes to one Uniswap V4 pool's Swap events on the origin chain and
///         requests a `ping` callback for every swap, carrying the origin tx hash so the full loop can be joined.
contract SpikeReactive is AbstractReactive {
    /// @dev keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)")
    uint256 public constant V4_SWAP_TOPIC0 = 0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f;
    uint64 public constant CALLBACK_GAS_LIMIT = 300_000;

    address public immutable OWNER;
    uint256 public immutable ORIGIN_CHAIN_ID;
    address public immutable POOL_MANAGER;
    uint256 public immutable POOL_ID;

    address public recipient;

    event RecipientSet(address indexed recipient);
    event PingRequested(uint256 indexed originTxHash, uint256 originBlock, uint256 originLogIndex);

    error NotOwner();
    error RecipientAlreadySet();
    error ZeroAddress();

    constructor(uint256 originChainId_, address poolManager_, bytes32 poolId_) payable {
        if (poolManager_ == address(0)) revert ZeroAddress();
        OWNER = msg.sender;
        ORIGIN_CHAIN_ID = originChainId_;
        POOL_MANAGER = poolManager_;
        POOL_ID = uint256(poolId_);

        SYSTEM.subscribe(
            originChainId_, poolManager_, V4_SWAP_TOPIC0, uint256(poolId_), REACTIVE_IGNORE, REACTIVE_IGNORE
        );
    }

    /// @notice One-time wiring of the callback receiver, which can only be deployed once this contract's address is known.
    function setRecipient(address recipient_) external {
        if (msg.sender != OWNER) revert NotOwner();
        if (recipient != address(0)) revert RecipientAlreadySet();
        if (recipient_ == address(0)) revert ZeroAddress();
        recipient = recipient_;
        emit RecipientSet(recipient_);
    }

    function react(LogRecord calldata log_) external onlySystem {
        // Subscriptions are exact, but stay defensive: ignore anything that is not our pool's Swap.
        if (
            log_.chainId != ORIGIN_CHAIN_ID || log_.contractAddress != POOL_MANAGER || log_.topic0 != V4_SWAP_TOPIC0
                || log_.topic1 != POOL_ID
        ) return;

        address target = recipient;
        if (target == address(0)) return;

        // The callback proxy overwrites the first argument with this contract's address.
        bytes memory payload = abi.encodeWithSignature(
            "ping(address,uint256,uint256,uint256)", address(0), log_.txHash, log_.blockNumber, log_.logIndex
        );
        SYSTEM.requestCallbackV_1_0(
            ISystemContract.CallbackConfiguration_V_1_0({
                chainId: ORIGIN_CHAIN_ID, recipient: target, gasLimit: CALLBACK_GAS_LIMIT, payload: payload
            })
        );
        emit PingRequested(log_.txHash, log_.blockNumber, log_.logIndex);
    }
}
