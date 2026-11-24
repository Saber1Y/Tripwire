// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {IReactive} from "@reactive/src/interfaces/IReactive.sol";
import {AbstractPayer} from "@reactive/src/base/AbstractPayer.sol";
import {TripwireReactive} from "../src/TripwireReactive.sol";
import {ITripwireVault} from "../src/interfaces/ITripwireVault.sol";
import {MockSystemContract} from "./mocks/MockSystemContract.sol";

contract TripwireReactiveTest is Test {
    address constant SYSTEM = 0x8888888888888888888888888888888888888888;
    uint256 constant REACTIVE_IGNORE = 0xa65f96fc951c35ead38878e0f0b7a3c744a6f5ccc1476b313353ce31712313ad;
    uint256 constant ORIGIN = 1301;
    address constant POOL_MANAGER = 0x00B036B58a818B1BC34d502D3fE730Db729e62AC;
    address constant PROXY = 0x775c9B990ADe401060B78D0e98684eEf8d2466C1;
    bytes32 constant POOL = keccak256("pool");
    bytes32 constant OTHER_POOL = keccak256("other");
    uint160 constant ONE = 79228162514264337593543950336; // sqrt price 1:1

    MockSystemContract system;
    TripwireReactive reactive;
    address vault = makeAddr("vault");
    uint256 txCounter;

    function setUp() public {
        vm.etch(SYSTEM, address(new MockSystemContract()).code);
        system = MockSystemContract(payable(SYSTEM));
        bytes32[] memory pools = new bytes32[](1);
        pools[0] = POOL;
        reactive = new TripwireReactive(ORIGIN, vault, POOL_MANAGER, PROXY, pools);
    }

    // ---------------------------------------------------------------------------------------------------------
    // Log builders
    // ---------------------------------------------------------------------------------------------------------

    function _base(address emitter_, uint256 topic0_) internal returns (IReactive.LogRecord memory r) {
        r.chainId = ORIGIN;
        r.contractAddress = emitter_;
        r.topic0 = topic0_;
        r.blockNumber = 5000 + txCounter;
        r.txHash = uint256(keccak256(abi.encode("tx", ++txCounter)));
        r.logIndex = 1;
    }

    function _created(uint256 id_, bool zeroForOne_, bool isStopLoss_, uint160 trigger_, uint8 maxAttempts_)
        internal
        returns (IReactive.LogRecord memory r)
    {
        r = _base(vault, uint256(ITripwireVault.OrderCreated.selector));
        r.topic1 = id_;
        r.topic2 = uint256(uint160(makeAddr("owner")));
        r.topic3 = uint256(POOL);
        r.opCode = 4;
        r.data = abi.encode(zeroForOne_, isStopLoss_, trigger_, uint128(1e18), uint128(0), maxAttempts_);
    }

    function _swap(bytes32 pool_, uint160 price_) internal returns (IReactive.LogRecord memory r) {
        r = _base(POOL_MANAGER, reactive.V4_SWAP_TOPIC0());
        r.topic1 = uint256(pool_);
        r.topic2 = uint256(uint160(makeAddr("swapper")));
        r.opCode = 3;
        r.data = abi.encode(int128(-1), int128(1), price_, uint128(1e21), int24(0), uint24(3000));
    }

    function _vaultEvent(bytes32 selector_, uint256 id_, bytes memory data_)
        internal
        returns (IReactive.LogRecord memory r)
    {
        r = _base(vault, uint256(selector_));
        r.topic1 = id_;
        r.opCode = 2;
        r.data = data_;
    }

    function _rejected(uint256 id_, ITripwireVault.RejectReason reason_) internal returns (IReactive.LogRecord memory) {
        return _vaultEvent(ITripwireVault.OrderRejected.selector, id_, abi.encode(reason_, uint160(0)));
    }

    function _callbackFailure(address target_, uint256 id_) internal returns (IReactive.LogRecord memory r) {
        r = _base(PROXY, reactive.CALLBACK_FAILURE_TOPIC0());
        r.topic1 = uint256(uint160(target_));
        r.opCode = 2;
        bytes memory payload = abi.encodeCall(ITripwireVault.execute, (address(reactive), id_, ONE, 1, 2, 3));
        r.data = abi.encode(payload);
    }

    function _react(IReactive.LogRecord memory log_) internal {
        vm.prank(SYSTEM);
        reactive.react(log_);
    }

    function _state(uint256 id_) internal view returns (TripwireReactive.State) {
        return reactive.getOrder(id_).state;
    }

    // Stop-loss selling token0: fires when the price falls to the trigger.
    function _armStopLoss(uint256 id_, uint160 trigger_) internal {
        _react(_created(id_, true, true, trigger_, 3));
    }

    // ---------------------------------------------------------------------------------------------------------
    // Subscriptions and access
    // ---------------------------------------------------------------------------------------------------------

    function test_constructorSubscriptions() public view {
        assertEq(system.subscriptionCount(), 6);
        MockSystemContract.Subscription memory s;

        s = system.subscriptionAt(0);
        assertEq(s.contractAddress, vault);
        assertEq(s.topic0, uint256(ITripwireVault.OrderCreated.selector));
        assertEq(s.topic1, REACTIVE_IGNORE);
        assertEq(system.subscriptionAt(1).topic0, uint256(ITripwireVault.OrderCancelled.selector));
        assertEq(system.subscriptionAt(2).topic0, uint256(ITripwireVault.OrderExecuted.selector));
        assertEq(system.subscriptionAt(3).topic0, uint256(ITripwireVault.OrderRejected.selector));

        s = system.subscriptionAt(4);
        assertEq(s.contractAddress, PROXY);
        assertEq(s.topic0, uint256(keccak256("CallbackFailure(address,bytes)")));
        assertEq(s.topic1, uint256(uint160(vault)), "only failures of callbacks to our vault");

        s = system.subscriptionAt(5);
        assertEq(s.chainId, ORIGIN);
        assertEq(s.contractAddress, POOL_MANAGER);
        assertEq(s.topic0, uint256(keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)")));
        assertEq(s.topic1, uint256(POOL));
        assertEq(s.topic2, REACTIVE_IGNORE);
    }

    function test_constructorValidation() public {
        bytes32[] memory none = new bytes32[](0);
        vm.expectRevert(TripwireReactive.NoPools.selector);
        new TripwireReactive(ORIGIN, vault, POOL_MANAGER, PROXY, none);

        bytes32[] memory pools = new bytes32[](1);
        vm.expectRevert(TripwireReactive.ZeroAddress.selector);
        new TripwireReactive(ORIGIN, address(0), POOL_MANAGER, PROXY, pools);
    }

    function test_reactOnlySystem() public {
        IReactive.LogRecord memory log_ = _swap(POOL, ONE);
        vm.expectRevert(abi.encodeWithSelector(AbstractPayer.NotAuthorized.selector, address(this), SYSTEM));
        reactive.react(log_);
    }

    function test_ignoresOtherChainsAndEmitters() public {
        IReactive.LogRecord memory log_ = _created(1, true, true, ONE / 2, 3);
        log_.chainId = 84532;
        _react(log_);
        log_ = _created(1, true, true, ONE / 2, 3);
        log_.contractAddress = makeAddr("notTheVault");
        _react(log_);
        assertEq(uint8(_state(1)), uint8(TripwireReactive.State.None));
    }

    // ---------------------------------------------------------------------------------------------------------
    // Arming
    // ---------------------------------------------------------------------------------------------------------

    function test_createdArmsOnCorrectSide() public {
        _armStopLoss(1, ONE / 2); // fires below
        _react(_created(2, true, false, ONE * 2, 3)); // take-profit selling token0: fires above
        _react(_created(3, false, true, ONE * 2, 3)); // stop-loss selling token1: fires above
        _react(_created(4, false, false, ONE / 2, 3)); // take-profit selling token1: fires below

        (uint256 below, uint256 above) = reactive.heapSizes(POOL);
        assertEq(below, 2);
        assertEq(above, 2);
        assertTrue(reactive.getOrder(1).firesBelow);
        assertFalse(reactive.getOrder(2).firesBelow);
        assertFalse(reactive.getOrder(3).firesBelow);
        assertTrue(reactive.getOrder(4).firesBelow);
        assertEq(reactive.getOrder(1).maxAttempts, 3);
    }

    function test_duplicateCreatedIgnored() public {
        _armStopLoss(1, ONE / 2);
        _armStopLoss(1, ONE / 3);
        (uint256 below,) = reactive.heapSizes(POOL);
        assertEq(below, 1);
        assertEq(reactive.getOrder(1).trigger, ONE / 2);
    }

    function test_unwatchedPoolRetiredImmediately() public {
        IReactive.LogRecord memory log_ = _created(1, true, true, ONE / 2, 3);
        log_.topic3 = uint256(OTHER_POOL);
        _react(log_);
        assertEq(uint8(_state(1)), uint8(TripwireReactive.State.Done));
    }

    // ---------------------------------------------------------------------------------------------------------
    // Triggering
    // ---------------------------------------------------------------------------------------------------------

    function test_swapAboveTriggerDoesNothing() public {
        _armStopLoss(1, ONE / 2);
        _react(_swap(POOL, ONE / 2 + 1));
        assertEq(system.callbackCount(), 0);
        assertEq(uint8(_state(1)), uint8(TripwireReactive.State.Armed));
    }

    function test_swapCrossingRequestsExactCallback() public {
        _armStopLoss(1, ONE / 2);
        IReactive.LogRecord memory swap = _swap(POOL, ONE / 2);
        _react(swap);

        assertEq(system.callbackCount(), 1);
        MockSystemContract.CallbackRequest memory c = system.callbackAt(0);
        assertEq(c.chainId, ORIGIN);
        assertEq(c.recipient, vault);
        assertEq(c.gasLimit, reactive.CALLBACK_GAS_LIMIT());
        assertEq(
            c.payload,
            abi.encodeCall(
                ITripwireVault.execute, (address(0), 1, ONE / 2, swap.blockNumber, swap.txHash, swap.logIndex)
            )
        );

        TripwireReactive.TrackedOrder memory o = reactive.getOrder(1);
        assertEq(uint8(o.state), uint8(TripwireReactive.State.Pending));
        assertEq(o.attempts, 1);
        assertEq(o.pendingSince, block.number);
    }

    function test_swapOnOtherPoolIgnored() public {
        _armStopLoss(1, ONE / 2);
        _react(_swap(OTHER_POOL, 1));
        assertEq(system.callbackCount(), 0);
    }

    function test_aboveSideTriggersOnRise() public {
        _react(_created(1, true, false, ONE * 2, 3));
        _react(_swap(POOL, ONE * 2 - 1));
        assertEq(system.callbackCount(), 0);
        _react(_swap(POOL, ONE * 2));
        assertEq(system.callbackCount(), 1);
    }

    function test_onlyCrossedOrdersFire_highestTriggerFirst() public {
        _armStopLoss(1, ONE / 4);
        _armStopLoss(2, ONE / 2);
        _armStopLoss(3, ONE / 3);
        _react(_swap(POOL, ONE / 3)); // crosses 1/2 and 1/3, not 1/4

        assertEq(system.callbackCount(), 2);
        assertEq(_decodeOrderId(system.callbackAt(0).payload), 2);
        assertEq(_decodeOrderId(system.callbackAt(1).payload), 3);
        assertEq(uint8(_state(1)), uint8(TripwireReactive.State.Armed));
    }

    function test_triggersPerEventAreBounded() public {
        for (uint256 i = 1; i <= 7; ++i) {
            _armStopLoss(i, ONE / 2);
        }
        _react(_swap(POOL, ONE / 4));
        assertEq(system.callbackCount(), reactive.MAX_TRIGGERS_PER_EVENT());
        _react(_swap(POOL, ONE / 4));
        assertEq(system.callbackCount(), 7, "the rest fire on the next swap");
    }

    function test_cancelledOrderSkippedAndDrained() public {
        _armStopLoss(1, ONE / 2);
        _armStopLoss(2, ONE / 2);
        _react(_vaultEvent(ITripwireVault.OrderCancelled.selector, 1, ""));
        assertEq(uint8(_state(1)), uint8(TripwireReactive.State.Done));

        _react(_swap(POOL, ONE / 4));
        assertEq(system.callbackCount(), 1);
        assertEq(_decodeOrderId(system.callbackAt(0).payload), 2);
        (uint256 below,) = reactive.heapSizes(POOL);
        assertEq(below, 0, "stale entry was popped and discarded");
    }

    // ---------------------------------------------------------------------------------------------------------
    // Outcomes
    // ---------------------------------------------------------------------------------------------------------

    function test_executedRetires() public {
        _armStopLoss(1, ONE / 2);
        _react(_swap(POOL, ONE / 4));
        _react(_vaultEvent(ITripwireVault.OrderExecuted.selector, 1, ""));
        assertEq(uint8(_state(1)), uint8(TripwireReactive.State.Done));
    }

    function test_priceNotCrossedRearms() public {
        _armStopLoss(1, ONE / 2);
        _react(_swap(POOL, ONE / 4));
        _react(_rejected(1, ITripwireVault.RejectReason.PriceNotCrossed));

        assertEq(uint8(_state(1)), uint8(TripwireReactive.State.Armed));
        (uint256 below,) = reactive.heapSizes(POOL);
        assertEq(below, 1);
        _react(_swap(POOL, ONE / 4));
        assertEq(system.callbackCount(), 2, "re-armed order fires again");
        assertEq(reactive.getOrder(1).attempts, 2);
    }

    function test_notOpenRetires() public {
        _armStopLoss(1, ONE / 2);
        _react(_swap(POOL, ONE / 4));
        _react(_rejected(1, ITripwireVault.RejectReason.NotOpen));
        assertEq(uint8(_state(1)), uint8(TripwireReactive.State.Done));
    }

    function test_attemptsExhaustedRetires() public {
        _react(_created(1, true, true, ONE / 2, 2));
        _react(_swap(POOL, ONE / 4));
        _react(_rejected(1, ITripwireVault.RejectReason.SwapFailed));
        _react(_swap(POOL, ONE / 4));
        _react(_rejected(1, ITripwireVault.RejectReason.SwapFailed));

        assertEq(uint8(_state(1)), uint8(TripwireReactive.State.Done));
        _react(_swap(POOL, ONE / 4));
        assertEq(system.callbackCount(), 2);
    }

    function test_rejectionWhenNotPendingIgnored() public {
        _armStopLoss(1, ONE / 2);
        _react(_rejected(1, ITripwireVault.RejectReason.PriceNotCrossed));
        (uint256 below,) = reactive.heapSizes(POOL);
        assertEq(below, 1, "no duplicate heap entry");
    }

    function test_callbackFailureRearms() public {
        _armStopLoss(1, ONE / 2);
        _react(_swap(POOL, ONE / 4));
        _react(_callbackFailure(vault, 1));
        assertEq(uint8(_state(1)), uint8(TripwireReactive.State.Armed));
    }

    function test_callbackFailureForOtherTargetIgnored() public {
        _armStopLoss(1, ONE / 2);
        _react(_swap(POOL, ONE / 4));
        _react(_callbackFailure(makeAddr("someoneElse"), 1));
        assertEq(uint8(_state(1)), uint8(TripwireReactive.State.Pending));
    }

    function test_rearmStale() public {
        _armStopLoss(1, ONE / 2);
        _react(_swap(POOL, ONE / 4));
        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;

        reactive.rearmStale(ids);
        assertEq(uint8(_state(1)), uint8(TripwireReactive.State.Pending), "too early");

        vm.roll(block.number + reactive.STALE_AFTER_BLOCKS());
        reactive.rearmStale(ids);
        assertEq(uint8(_state(1)), uint8(TripwireReactive.State.Armed));
    }

    /// @dev Reactive caps one reaction at 900k gas. The spike measured a whole reaction with one real callback
    ///      request at about 79k gas on Lasna, so 60k per request is a generous allowance for the system's share.
    function test_reactionGasStaysUnderCap() public {
        for (uint256 i = 1; i <= 40; ++i) {
            _armStopLoss(i, ONE / 2);
        }
        system.setCountOnly(true);
        IReactive.LogRecord memory log_ = _swap(POOL, ONE / 4);
        // A real reaction is its own transaction: start from cold storage, as it would on Lasna.
        vm.cool(address(reactive));
        vm.prank(SYSTEM);
        uint256 gasBefore = gasleft();
        reactive.react(log_);
        uint256 used = gasBefore - gasleft();

        assertEq(system.callbackRequests(), reactive.MAX_TRIGGERS_PER_EVENT());
        uint256 systemAllowance = reactive.MAX_TRIGGERS_PER_EVENT() * 60_000;
        emit log_named_uint("worst-case react gas excluding system", used);
        assertLt(used + systemAllowance, 900_000, "worst-case reaction must fit the 900k cap");
    }

    function _decodeOrderId(bytes memory payload_) internal pure returns (uint256 id) {
        assembly {
            id := mload(add(payload_, 68))
        }
    }
}
