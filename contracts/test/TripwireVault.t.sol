// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Vm} from "forge-std/Test.sol";
import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {AbstractPayer} from "@reactive/src/base/AbstractPayer.sol";
import {AbstractCallback} from "@reactive/src/base/AbstractCallback.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {TripwireVault} from "../src/TripwireVault.sol";
import {ITripwireVault} from "../src/interfaces/ITripwireVault.sol";
import {UnichainForkFixture} from "./utils/UnichainForkFixture.sol";

/// @dev Burns 1% of every transfer, to prove the vault refuses tokens it would under-escrow.
contract FeeOnTransferToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(uint256 supply_) {
        balanceOf[msg.sender] = supply_;
    }

    function approve(address spender_, uint256 amount_) external returns (bool) {
        allowance[msg.sender][spender_] = amount_;
        return true;
    }

    function transfer(address to_, uint256 amount_) external returns (bool) {
        _move(msg.sender, to_, amount_);
        return true;
    }

    function transferFrom(address from_, address to_, uint256 amount_) external returns (bool) {
        allowance[from_][msg.sender] -= amount_;
        _move(from_, to_, amount_);
        return true;
    }

    function _move(address from_, address to_, uint256 amount_) internal {
        balanceOf[from_] -= amount_;
        balanceOf[to_] += amount_ - amount_ / 100;
    }
}

contract TripwireVaultTest is UnichainForkFixture {
    using PoolIdLibrary for PoolKey;

    TripwireVault vault;
    address proxy = makeAddr("callbackProxy");
    address reactive = makeAddr("reactive");
    address admin = makeAddr("admin");
    address alice = makeAddr("alice");

    uint160 stopTrigger; // a stop-loss selling token0 fires once the price falls to tick -60

    function setUp() public {
        _setUpFork();
        vault = new TripwireVault(POOL_MANAGER, IPayable(payable(proxy)), reactive, admin);
        vm.prank(admin);
        vault.setPoolSupported(key, true);

        assertTrue(token0.transfer(alice, 100e18));
        assertTrue(token1.transfer(alice, 100e18));
        vm.startPrank(alice);
        token0.approve(address(vault), type(uint256).max);
        token1.approve(address(vault), type(uint256).max);
        vm.stopPrank();

        stopTrigger = _priceAtTick(-60);
    }

    function _createStopLoss(uint128 amountIn_, uint128 minOut_) internal returns (uint256) {
        vm.prank(alice);
        return vault.createOrder(poolId, true, true, stopTrigger, amountIn_, minOut_, 3);
    }

    function _execute(uint256 orderId_) internal {
        uint160 observed = _price(); // read first: an external call would consume the prank
        vm.prank(proxy);
        vault.execute(reactive, orderId_, observed, 111, 0xabc, 2);
    }

    // ---------------------------------------------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------------------------------------------

    function test_setPoolSupported_onlyOwner() public {
        vm.expectRevert(TripwireVault.NotOwner.selector);
        vault.setPoolSupported(key, false);
    }

    function test_setPoolSupported_rejectsHooksAndNative() public {
        PoolKey memory hooked = key;
        hooked.hooks = IHooks(address(0x1234));
        vm.startPrank(admin);
        vm.expectRevert(TripwireVault.UnsupportedPoolKey.selector);
        vault.setPoolSupported(hooked, true);

        PoolKey memory native = key;
        native.currency0 = Currency.wrap(address(0));
        vm.expectRevert(TripwireVault.UnsupportedPoolKey.selector);
        vault.setPoolSupported(native, true);
        vm.stopPrank();
    }

    function test_triggerDirection() public view {
        assertTrue(vault.triggerFiresBelow(true, true)); // stop-loss selling token0: price falls
        assertFalse(vault.triggerFiresBelow(true, false)); // take-profit selling token0: price rises
        assertFalse(vault.triggerFiresBelow(false, true)); // stop-loss selling token1: price rises
        assertTrue(vault.triggerFiresBelow(false, false)); // take-profit selling token1: price falls
    }

    // ---------------------------------------------------------------------------------------------------------
    // createOrder
    // ---------------------------------------------------------------------------------------------------------

    function test_createOrder_escrowsAndEmits() public {
        vm.expectEmit(true, true, true, true, address(vault));
        emit ITripwireVault.OrderCreated(1, alice, poolId, true, true, stopTrigger, 1e18, 0.9e18, 3);
        uint256 id = _createStopLoss(1e18, 0.9e18);

        assertEq(id, 1);
        assertEq(vault.nextOrderId(), 2);
        assertEq(token0.balanceOf(address(vault)), 1e18);
        assertEq(token0.balanceOf(alice), 99e18);
        TripwireVault.Order memory o = vault.getOrder(id);
        assertEq(o.owner, alice);
        assertEq(uint8(o.status), uint8(ITripwireVault.OrderStatus.Open));
        assertEq(o.amountIn, 1e18);
    }

    function test_createOrder_validation() public {
        vm.startPrank(alice);
        vm.expectRevert(TripwireVault.UnsupportedPool.selector);
        vault.createOrder(PoolId.wrap(bytes32(uint256(1))), true, true, stopTrigger, 1e18, 1, 3);

        vm.expectRevert(TripwireVault.ZeroAmount.selector);
        vault.createOrder(poolId, true, true, stopTrigger, 0, 1, 3);

        vm.expectRevert(TripwireVault.ZeroMinAmountOut.selector);
        vault.createOrder(poolId, true, true, stopTrigger, 1e18, 0, 3);

        vm.expectRevert(TripwireVault.AttemptsOutOfRange.selector);
        vault.createOrder(poolId, true, true, stopTrigger, 1e18, 1, 0);

        vm.expectRevert(TripwireVault.AttemptsOutOfRange.selector);
        vault.createOrder(poolId, true, true, stopTrigger, 1e18, 1, 6);

        vm.expectRevert(TripwireVault.TriggerOutOfRange.selector);
        vault.createOrder(poolId, true, true, TickMath.MIN_SQRT_PRICE, 1e18, 1, 3);

        // A stop-loss selling token0 with its trigger above the current price would fire immediately.
        uint160 current = _price();
        vm.expectRevert(abi.encodeWithSelector(TripwireVault.TriggerAlreadyCrossed.selector, current));
        vault.createOrder(poolId, true, true, _priceAtTick(60), 1e18, 1, 3);
        vm.stopPrank();
    }

    function test_createOrder_rejectsFeeOnTransferToken() public {
        FeeOnTransferToken fot = new FeeOnTransferToken(1e30);
        (Currency c0, Currency c1) = address(fot) < address(token1)
            ? (Currency.wrap(address(fot)), Currency.wrap(address(token1)))
            : (Currency.wrap(address(token1)), Currency.wrap(address(fot)));
        PoolKey memory fotKey =
            PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))});
        POOL_MANAGER.initialize(fotKey, SQRT_PRICE_1_1);
        vm.prank(admin);
        vault.setPoolSupported(fotKey, true);

        bool fotIsToken0 = Currency.unwrap(c0) == address(fot);
        fot.approve(address(vault), type(uint256).max);
        vm.expectRevert(TripwireVault.FeeOnTransferToken.selector);
        // Sell the fee-on-transfer token with a trigger on the far side of the current price.
        vault.createOrder(
            fotKey.toId(), fotIsToken0, true, fotIsToken0 ? _priceAtTick(-60) : _priceAtTick(60), 1e18, 1, 3
        );
    }

    // ---------------------------------------------------------------------------------------------------------
    // cancelOrder
    // ---------------------------------------------------------------------------------------------------------

    function test_cancelOrder_refunds() public {
        uint256 id = _createStopLoss(1e18, 1);
        vm.expectEmit(true, false, false, false, address(vault));
        emit ITripwireVault.OrderCancelled(id);
        vm.prank(alice);
        vault.cancelOrder(id);

        assertEq(token0.balanceOf(alice), 100e18);
        assertEq(token0.balanceOf(address(vault)), 0);
        assertEq(uint8(vault.getOrder(id).status), uint8(ITripwireVault.OrderStatus.Cancelled));
    }

    function test_cancelOrder_onlyOwnerAndOnce() public {
        uint256 id = _createStopLoss(1e18, 1);
        vm.expectRevert(TripwireVault.NotOrderOwner.selector);
        vault.cancelOrder(id);

        vm.startPrank(alice);
        vault.cancelOrder(id);
        vm.expectRevert(
            abi.encodeWithSelector(TripwireVault.OrderNotOpen.selector, ITripwireVault.OrderStatus.Cancelled)
        );
        vault.cancelOrder(id);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------------------------------------------------
    // execute
    // ---------------------------------------------------------------------------------------------------------

    function test_execute_onlyProxy() public {
        uint256 id = _createStopLoss(1e18, 1);
        vm.expectRevert(abi.encodeWithSelector(AbstractPayer.NotAuthorized.selector, address(this), proxy));
        vault.execute(reactive, id, 0, 0, 0, 0);
    }

    function test_execute_onlyOurReactiveContract() public {
        uint256 id = _createStopLoss(1e18, 1);
        address impostor = makeAddr("impostor");
        vm.expectRevert(abi.encodeWithSelector(AbstractCallback.CallbackNotAuthorized.selector, impostor, reactive));
        vm.prank(proxy);
        vault.execute(impostor, id, 0, 0, 0, 0);
    }

    function test_execute_swapsWhenCrossed() public {
        uint256 id = _createStopLoss(1e18, 0.9e18);
        _swap(true, 5e18); // crash the price below tick -60
        assertLt(_price(), stopTrigger);

        uint256 aliceToken1Before = token1.balanceOf(alice);
        uint160 observed = _price();
        vm.recordLogs();
        _execute(id);

        assertEq(uint8(vault.getOrder(id).status), uint8(ITripwireVault.OrderStatus.Executed));
        assertEq(token0.balanceOf(address(vault)), 0);
        uint256 received = token1.balanceOf(alice) - aliceToken1Before;
        assertGt(received, 0.9e18);
        assertEq(token1.balanceOf(address(vault)), 0, "proceeds go straight to the owner");

        Vm.Log[] memory logs = vm.getRecordedLogs();
        Vm.Log memory executed = logs[logs.length - 1];
        assertEq(executed.topics[0], ITripwireVault.OrderExecuted.selector);
        (uint256 amountOut, uint160 obs, uint160 after_, uint256 originBlock, uint256 originTx, uint256 logIdx) =
            abi.decode(executed.data, (uint256, uint160, uint160, uint256, uint256, uint256));
        assertEq(amountOut, received);
        assertEq(obs, observed);
        assertLt(after_, observed, "selling token0 pushes the price further down");
        assertEq(originBlock, 111);
        assertEq(originTx, 0xabc);
        assertEq(logIdx, 2);
    }

    function test_execute_rejectsWhenPriceNotCrossed() public {
        uint256 id = _createStopLoss(1e18, 1);
        uint160 current = _price();
        vm.expectEmit(true, false, false, true, address(vault));
        emit ITripwireVault.OrderRejected(id, ITripwireVault.RejectReason.PriceNotCrossed, current);
        _execute(id);

        assertEq(uint8(vault.getOrder(id).status), uint8(ITripwireVault.OrderStatus.Open));
        assertEq(token0.balanceOf(address(vault)), 1e18);
    }

    function test_execute_rejectsAfterCancel() public {
        uint256 id = _createStopLoss(1e18, 1);
        vm.prank(alice);
        vault.cancelOrder(id);
        _swap(true, 5e18);

        vm.expectEmit(true, false, false, true, address(vault));
        emit ITripwireVault.OrderRejected(id, ITripwireVault.RejectReason.NotOpen, 0);
        _execute(id);
        assertEq(token0.balanceOf(alice), 100e18, "a late callback cannot touch a refunded order");
    }

    function test_execute_swapFailureKeepsOrderOpenAndFunded() public {
        uint256 id = _createStopLoss(1e18, 10e18); // unreachable minimum output
        _swap(true, 5e18);
        uint160 current = _price();

        vm.expectEmit(true, false, false, true, address(vault));
        emit ITripwireVault.OrderRejected(id, ITripwireVault.RejectReason.SwapFailed, current);
        _execute(id);

        assertEq(uint8(vault.getOrder(id).status), uint8(ITripwireVault.OrderStatus.Open));
        assertEq(token0.balanceOf(address(vault)), 1e18);
        assertEq(_price(), current, "the failed swap was rolled back");
    }

    function test_execute_duplicateCallbackIsNoOp() public {
        uint256 id = _createStopLoss(1e18, 1);
        _swap(true, 5e18);
        _execute(id);
        uint256 aliceToken1 = token1.balanceOf(alice);

        vm.expectEmit(true, false, false, true, address(vault));
        emit ITripwireVault.OrderRejected(id, ITripwireVault.RejectReason.NotOpen, 0);
        _execute(id);
        assertEq(token1.balanceOf(alice), aliceToken1);
    }

    function test_execute_takeProfitSellingToken1() public {
        // Holding token1, take-profit fires when the price falls (token1 gains value).
        uint160 trigger = _priceAtTick(-60);
        vm.prank(alice);
        uint256 id = vault.createOrder(poolId, false, false, trigger, 1e18, 1, 3);
        _swap(true, 5e18);

        uint256 aliceToken0Before = token0.balanceOf(alice);
        _execute(id);
        assertEq(uint8(vault.getOrder(id).status), uint8(ITripwireVault.OrderStatus.Executed));
        assertGt(token0.balanceOf(alice), aliceToken0Before);
        assertEq(token1.balanceOf(address(vault)), 0);
    }

    function test_performSwap_onlySelf() public {
        vm.expectRevert(TripwireVault.NotSelf.selector);
        vault.performSwap(1);
    }

    function test_unlockCallback_onlyPoolManager() public {
        vm.expectRevert(TripwireVault.NotPoolManager.selector);
        vault.unlockCallback(abi.encode(uint256(1)));
    }
}
