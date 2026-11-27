// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {console} from "forge-std/console.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {TestERC20} from "v4-core/src/test/TestERC20.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {TripwireVault} from "../../src/TripwireVault.sol";
import {SpikeConfig} from "../spike/SpikeConfig.sol";

/// @notice Unichain Sepolia: drives the deployed Tripwire demo pool for demos, load tests and live edge cases.
/// @dev Env DEMO_ACTION:
///        "order"        stop-loss selling 1 token0, trigger 40 ticks below the current price, 3% under fair minimum
///        "crash"        sell 5 token0 (about 100 ticks down)
///        "recover"      sell 6 token1 (offsets one crash plus one 1-token fill, so repeated loops do not drift)
///        "order+crash"  order then crash
///        "cycle"        recover, order, crash: one clean full loop from wherever the price was left
///        "bounce"       recover, order, crash, then recover straight away: the callback should find the price back
///                       above the trigger and refuse (PriceNotCrossed), and Reactive should re-arm the order
///        "slippage"     recover, order with an unreachable minimum and 2 attempts, crash: refused as SwapFailed
///        "cancel-race"  recover, order, crash, then cancel at once: the in-flight callback should find NotOpen
///        "cancel"       cancel DEMO_ORDER_ID
///      Every created order id is logged as "created stop-loss order <id>" for the load-test runner.
contract TripwireDemo is SpikeConfig {
    using StateLibrary for IPoolManager;

    uint128 internal constant ORDER_AMOUNT = 1e18;
    int24 internal constant TRIGGER_OFFSET_TICKS = 40;
    uint256 internal constant CRASH_AMOUNT = 5e18;
    uint256 internal constant RECOVER_AMOUNT = 6e18;

    TripwireVault internal vault;
    PoolId internal poolId;
    PoolKey internal key;

    function run() external {
        _requireChain(UNICHAIN_SEPOLIA);
        // forge-lint: disable-next-line(unsafe-cheatcode)
        string memory tripwire = vm.readFile("deployments/tripwire.json");
        vault = TripwireVault(payable(vm.parseJsonAddress(tripwire, ".vault")));
        poolId = PoolId.wrap(vm.parseJsonBytes32(tripwire, ".poolId"));
        key = vault.getPoolKey(poolId);

        bytes32 a = keccak256(bytes(vm.envOr("DEMO_ACTION", string("order+crash"))));

        vm.startBroadcast();
        if (a == keccak256("order")) {
            _order(false, 3);
        } else if (a == keccak256("crash")) {
            _move(true, CRASH_AMOUNT);
        } else if (a == keccak256("recover")) {
            _move(false, RECOVER_AMOUNT);
        } else if (a == keccak256("order+crash")) {
            _order(false, 3);
            _move(true, CRASH_AMOUNT);
        } else if (a == keccak256("cycle")) {
            _move(false, RECOVER_AMOUNT);
            _order(false, 3);
            _move(true, CRASH_AMOUNT);
        } else if (a == keccak256("bounce")) {
            _move(false, RECOVER_AMOUNT);
            _order(false, 3);
            _move(true, CRASH_AMOUNT);
            _move(false, CRASH_AMOUNT);
        } else if (a == keccak256("slippage")) {
            _move(false, RECOVER_AMOUNT);
            _order(true, 2);
            _move(true, CRASH_AMOUNT);
        } else if (a == keccak256("cancel-race")) {
            _move(false, RECOVER_AMOUNT);
            uint256 id = _order(false, 3);
            _move(true, CRASH_AMOUNT);
            vault.cancelOrder(id);
            console.log("cancelled order", id);
        } else if (a == keccak256("cancel")) {
            uint256 id = vm.envUint("DEMO_ORDER_ID");
            vault.cancelOrder(id);
            console.log("cancelled order", id);
        } else {
            revert("TripwireDemo: unknown DEMO_ACTION");
        }
        vm.stopBroadcast();
    }

    /// @dev Trigger and minimum follow the live price, so repeated runs keep working wherever the pool sits.
    function _order(bool unreachableMinimum_, uint8 attempts_) internal returns (uint256 id) {
        TestERC20 token0 = TestERC20(Currency.unwrap(key.currency0));
        if (token0.allowance(msg.sender, address(vault)) < ORDER_AMOUNT) {
            token0.approve(address(vault), type(uint256).max);
        }
        (, int24 tick,,) = IPoolManager(POOL_MANAGER).getSlot0(poolId);
        uint160 trigger = TickMath.getSqrtPriceAtTick(tick - TRIGGER_OFFSET_TICKS);
        // Fair output at the trigger: amountIn * price, price = (sqrtP / 2^96)^2. Fits in 256 bits for these sizes.
        uint256 fair = (uint256(ORDER_AMOUNT) * trigger * trigger) >> 192;
        uint256 minOut = unreachableMinimum_ ? fair * 2 : (fair * 97) / 100;
        // forge-lint: disable-next-line(unsafe-typecast)
        id = vault.createOrder(poolId, true, true, trigger, ORDER_AMOUNT, uint128(minOut), attempts_);
        console.log("created stop-loss order", id);
    }

    function _move(bool zeroForOne_, uint256 amount_) internal {
        PoolSwapTest(_readAddress(".swapRouter"))
            .swap(
                key,
                SwapParams({
                    zeroForOne: zeroForOne_,
                    // forge-lint: disable-next-line(unsafe-typecast)
                    amountSpecified: -int256(amount_),
                    sqrtPriceLimitX96: zeroForOne_ ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
                }),
                PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
                ""
            );
        console.log(zeroForOne_ ? "price down: sold token0" : "price up: sold token1", amount_ / 1e18);
    }
}
