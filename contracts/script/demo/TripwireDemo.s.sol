// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {console} from "forge-std/console.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {TestERC20} from "v4-core/src/test/TestERC20.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {TripwireVault} from "../../src/TripwireVault.sol";
import {SpikeConfig} from "../spike/SpikeConfig.sol";

/// @notice Unichain Sepolia: drives the deployed Tripwire demo pool.
/// @dev Env: DEMO_ACTION = "order" | "crash" | "recover" | "order+crash" (default "order+crash").
///      "order" places a stop-loss selling 1 token0 if the price falls to tick -60, with a 0.95 token1 minimum.
///      "crash" sells 5 token0 into the pool (price to about tick -100); "recover" sells 5 token1 back.
contract TripwireDemo is SpikeConfig {
    uint128 internal constant ORDER_AMOUNT = 1e18;
    uint128 internal constant ORDER_MIN_OUT = 0.95e18;
    int24 internal constant TRIGGER_TICK = -60;
    uint256 internal constant MOVE_AMOUNT = 5e18;

    function run() external {
        _requireChain(UNICHAIN_SEPOLIA);
        string memory action = vm.envOr("DEMO_ACTION", string("order+crash"));
        // forge-lint: disable-next-line(unsafe-cheatcode)
        string memory tripwire = vm.readFile("deployments/tripwire.json");
        TripwireVault vault = TripwireVault(payable(vm.parseJsonAddress(tripwire, ".vault")));
        PoolId poolId = PoolId.wrap(vm.parseJsonBytes32(tripwire, ".poolId"));
        PoolKey memory key = vault.getPoolKey(poolId);

        bytes32 a = keccak256(bytes(action));
        bool doOrder = a == keccak256("order") || a == keccak256("order+crash");
        bool doCrash = a == keccak256("crash") || a == keccak256("order+crash");
        bool doRecover = a == keccak256("recover");
        require(doOrder || doCrash || doRecover, "TripwireDemo: unknown DEMO_ACTION");

        vm.startBroadcast();
        if (doOrder) {
            TestERC20 token0 = TestERC20(Currency.unwrap(key.currency0));
            if (token0.allowance(msg.sender, address(vault)) < ORDER_AMOUNT) {
                token0.approve(address(vault), type(uint256).max);
            }
            uint256 id = vault.createOrder(
                poolId, true, true, TickMath.getSqrtPriceAtTick(TRIGGER_TICK), ORDER_AMOUNT, ORDER_MIN_OUT, 3
            );
            console.log("created stop-loss order", id);
        }
        if (doCrash) _move(key, true);
        if (doRecover) _move(key, false);
        vm.stopBroadcast();
    }

    function _move(PoolKey memory key_, bool zeroForOne_) internal {
        PoolSwapTest(_readAddress(".swapRouter"))
            .swap(
                key_,
                SwapParams({
                    zeroForOne: zeroForOne_,
                    // forge-lint: disable-next-line(unsafe-typecast)
                    amountSpecified: -int256(MOVE_AMOUNT),
                    sqrtPriceLimitX96: zeroForOne_ ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
                }),
                PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
                ""
            );
        console.log(zeroForOne_ ? "crashed the price (sold 5 token0)" : "recovered the price (sold 5 token1)");
    }
}
