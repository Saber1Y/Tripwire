// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {AbstractCallback} from "@reactive/src/base/AbstractCallback.sol";

/// @title PingReceiver
/// @notice Phase 0 latency probe. Receives callbacks from SpikeReactive and records when they land.
contract PingReceiver is AbstractCallback {
    uint256 public pings;

    event Ping(
        uint256 indexed originTxHash,
        uint256 originBlock,
        uint256 originLogIndex,
        uint256 receivedTimestamp,
        uint256 receivedBlock
    );

    constructor(IPayable callbackProxy_, address reactive_) payable AbstractCallback(callbackProxy_, reactive_) {}

    function ping(address rvm_, uint256 originTxHash_, uint256 originBlock_, uint256 originLogIndex_)
        external
        onlyServiceProvider
        onlyCallbackSender(rvm_)
    {
        unchecked {
            ++pings;
        }
        emit Ping(originTxHash_, originBlock_, originLogIndex_, block.timestamp, block.number);
    }

    /// @notice Settles any debt owed to the callback proxy from this contract's own balance.
    function coverDebt() external {
        _coverDebt();
    }
}
