// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Vm} from "forge-std/Test.sol";
import {IReactive} from "@reactive/src/interfaces/IReactive.sol";
import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {TripwireVault} from "../src/TripwireVault.sol";
import {TripwireReactive} from "../src/TripwireReactive.sol";
import {ITripwireVault} from "../src/interfaces/ITripwireVault.sol";
import {MockSystemContract} from "./mocks/MockSystemContract.sol";
import {UnichainForkFixture} from "./utils/UnichainForkFixture.sol";

/// @notice Drives the real vault and the real reactive contract through the whole protocol on a Unichain Sepolia
///         fork. The Reactive Network is played by this test: every log the vault and PoolManager emit is relayed to
///         `react()`, and every callback the reactive contract requests is delivered to the vault the way the
///         callback proxy would (first argument overwritten with the reactive contract's address).
contract FullLoopTest is UnichainForkFixture {
    address constant SYSTEM = 0x8888888888888888888888888888888888888888;

    MockSystemContract system;
    TripwireVault vault;
    TripwireReactive reactive;
    address proxy = makeAddr("callbackProxy");
    address alice = makeAddr("alice");
    uint256 relayedTx;
    uint256 deliveredCallbacks;

    function setUp() public {
        _setUpFork();
        vm.etch(SYSTEM, address(new MockSystemContract()).code);
        system = MockSystemContract(payable(SYSTEM));

        // Same trick as the deploy script: predict the vault address so both contracts can be immutable.
        address predictedVault = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        bytes32[] memory pools = new bytes32[](1);
        pools[0] = PoolId.unwrap(poolId);
        reactive = new TripwireReactive(block.chainid, predictedVault, address(POOL_MANAGER), proxy, pools);
        vault = new TripwireVault(POOL_MANAGER, IPayable(payable(proxy)), address(reactive), address(this));
        assertEq(address(vault), predictedVault);
        vault.setPoolSupported(key, true);

        assertTrue(token0.transfer(alice, 10e18));
        vm.prank(alice);
        token0.approve(address(vault), type(uint256).max);
    }

    // ---------------------------------------------------------------------------------------------------------
    // Network simulation
    // ---------------------------------------------------------------------------------------------------------

    /// @dev Relays every recorded log from the vault or the PoolManager to the reactive contract, in order.
    function _relayLogs() internal {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(vault) && logs[i].emitter != address(POOL_MANAGER)) continue;
            IReactive.LogRecord memory r = _toLogRecord(logs[i], uint256(keccak256(abi.encode(++relayedTx))), i);
            vm.prank(SYSTEM);
            reactive.react(r);
        }
    }

    /// @dev Delivers every callback requested since the last delivery, as the callback proxy would.
    function _deliverCallbacks() internal {
        uint256 total = system.callbackCount();
        for (; deliveredCallbacks < total; ++deliveredCallbacks) {
            MockSystemContract.CallbackRequest memory c = system.callbackAt(deliveredCallbacks);
            assertEq(c.recipient, address(vault));
            bytes memory payload = c.payload;
            address rvm = address(reactive);
            assembly {
                mstore(add(payload, 36), rvm)
            }
            vm.prank(proxy);
            (bool ok,) = c.recipient.call{gas: c.gasLimit}(payload);
            assertTrue(ok, "callback reverted");
        }
    }

    /// @dev One round of the network: relay what happened, deliver resulting callbacks, relay their outcomes.
    function _networkRound() internal {
        _relayLogs();
        vm.recordLogs();
        _deliverCallbacks();
        _relayLogs();
        vm.recordLogs();
    }

    function _state(uint256 id_) internal view returns (TripwireReactive.State) {
        return reactive.getOrder(id_).state;
    }

    // ---------------------------------------------------------------------------------------------------------
    // Scenarios
    // ---------------------------------------------------------------------------------------------------------

    function test_stopLossExecutesEndToEnd() public {
        vm.recordLogs();
        vm.prank(alice);
        uint256 id = vault.createOrder(poolId, true, true, _priceAtTick(-60), 1e18, 0.9e18, 3);
        _networkRound();
        assertEq(uint8(_state(id)), uint8(TripwireReactive.State.Armed));

        _swap(true, 5e18); // the crash
        _networkRound();

        assertEq(uint8(vault.getOrder(id).status), uint8(ITripwireVault.OrderStatus.Executed));
        assertEq(uint8(_state(id)), uint8(TripwireReactive.State.Done), "reactive saw the OrderExecuted event");
        assertGt(token1.balanceOf(alice), 0.9e18);
        assertEq(token0.balanceOf(address(vault)), 0);
    }

    function test_priceBounceBackRearmsThenExecutes() public {
        vm.recordLogs();
        vm.prank(alice);
        uint256 id = vault.createOrder(poolId, true, true, _priceAtTick(-60), 1e18, 1, 3);
        _networkRound();

        // The crash is seen by the reactive contract, but the price recovers before the callback lands.
        _swap(true, 5e18);
        _relayLogs();
        vm.recordLogs();
        _swap(false, 6e18);
        _deliverCallbacks();
        _relayLogs();
        vm.recordLogs();

        assertEq(uint8(vault.getOrder(id).status), uint8(ITripwireVault.OrderStatus.Open), "stale trigger refused");
        assertEq(uint8(_state(id)), uint8(TripwireReactive.State.Armed), "re-armed after PriceNotCrossed");
        assertEq(token0.balanceOf(address(vault)), 1e18);

        // The recovery swap was relayed too, but a rise fires nothing for a stop-loss. A second crash executes it.
        _swap(true, 8e18);
        _networkRound();
        assertEq(uint8(vault.getOrder(id).status), uint8(ITripwireVault.OrderStatus.Executed));
        assertEq(reactive.getOrder(id).attempts, 2);
    }

    function test_cancelBeforeCrashNeverExecutes() public {
        vm.recordLogs();
        vm.prank(alice);
        uint256 id = vault.createOrder(poolId, true, true, _priceAtTick(-60), 1e18, 1, 3);
        _networkRound();

        vm.prank(alice);
        vault.cancelOrder(id);
        _networkRound();
        assertEq(uint8(_state(id)), uint8(TripwireReactive.State.Done));

        _swap(true, 5e18);
        _networkRound();
        assertEq(system.callbackCount(), 0, "no callback for a cancelled order");
        assertEq(token0.balanceOf(alice), 10e18);
    }

    function test_cancelWhileCallbackInFlight() public {
        vm.recordLogs();
        vm.prank(alice);
        uint256 id = vault.createOrder(poolId, true, true, _priceAtTick(-60), 1e18, 1, 3);
        _networkRound();

        _swap(true, 5e18);
        _relayLogs(); // callback requested, not yet delivered
        vm.prank(alice);
        vault.cancelOrder(id);
        vm.recordLogs();
        _deliverCallbacks();
        _relayLogs();

        assertEq(uint8(vault.getOrder(id).status), uint8(ITripwireVault.OrderStatus.Cancelled));
        assertEq(uint8(_state(id)), uint8(TripwireReactive.State.Done), "NotOpen rejection retires the order");
        assertEq(token0.balanceOf(alice), 10e18, "refund intact");
    }

    function test_slippageFailureRetriesUntilAttemptsExhausted() public {
        vm.recordLogs();
        vm.prank(alice);
        uint256 id = vault.createOrder(poolId, true, true, _priceAtTick(-60), 1e18, 5e18, 2); // unreachable minOut
        _networkRound();

        _swap(true, 5e18);
        _networkRound();
        assertEq(uint8(_state(id)), uint8(TripwireReactive.State.Armed));
        _swap(true, 1e18);
        _networkRound();

        assertEq(uint8(_state(id)), uint8(TripwireReactive.State.Done), "gave up after maxAttempts");
        assertEq(uint8(vault.getOrder(id).status), uint8(ITripwireVault.OrderStatus.Open), "funds still cancellable");
        vm.prank(alice);
        vault.cancelOrder(id);
        assertEq(token0.balanceOf(alice), 10e18);
    }
}
