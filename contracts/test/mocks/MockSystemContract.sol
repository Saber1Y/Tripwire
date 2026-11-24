// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {ISystemContract} from "@reactive/src/interfaces/ISystemContract.sol";

/// @notice Records subscriptions and callback requests so reactive contracts can be unit-tested off-network.
///         Etched at 0x8888…8888 in tests.
contract MockSystemContract {
    struct Subscription {
        address subscriber;
        uint256 chainId;
        address contractAddress;
        uint256 topic0;
        uint256 topic1;
        uint256 topic2;
        uint256 topic3;
    }

    struct CallbackRequest {
        address requester;
        uint256 chainId;
        address recipient;
        uint64 gasLimit;
        bytes payload;
    }

    Subscription[] internal _subscriptions;
    CallbackRequest[] internal _callbacks;
    /// @dev When true, callback requests are only counted, so gas tests measure the caller's own cost rather
    ///      than this mock's storage writes. Defaults to false because the mock is installed with `vm.etch`,
    ///      which copies code but runs no initialisers.
    bool public countOnly;
    uint256 public callbackRequests;

    function setCountOnly(bool countOnly_) external {
        countOnly = countOnly_;
    }

    function subscribe(uint256 chainId_, address contract_, uint256 t0_, uint256 t1_, uint256 t2_, uint256 t3_)
        external
    {
        _subscriptions.push(
            Subscription({
                subscriber: msg.sender,
                chainId: chainId_,
                contractAddress: contract_,
                topic0: t0_,
                topic1: t1_,
                topic2: t2_,
                topic3: t3_
            })
        );
    }

    function unsubscribe(uint256, address, uint256, uint256, uint256, uint256) external {}

    // forge-lint: disable-next-line(mixed-case-function)
    function requestCallbackV_1_0(ISystemContract.CallbackConfiguration_V_1_0 memory config_) external {
        ++callbackRequests;
        if (countOnly) return;
        _callbacks.push(
            CallbackRequest({
                requester: msg.sender,
                chainId: config_.chainId,
                recipient: config_.recipient,
                gasLimit: config_.gasLimit,
                payload: config_.payload
            })
        );
    }

    function debt(address) external pure returns (uint256) {
        return 0;
    }

    function subscriptionCount() external view returns (uint256) {
        return _subscriptions.length;
    }

    function subscriptionAt(uint256 i_) external view returns (Subscription memory) {
        return _subscriptions[i_];
    }

    function callbackCount() external view returns (uint256) {
        return _callbacks.length;
    }

    function callbackAt(uint256 i_) external view returns (CallbackRequest memory) {
        return _callbacks[i_];
    }

    receive() external payable {}
}
