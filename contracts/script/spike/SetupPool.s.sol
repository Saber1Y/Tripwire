// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {console} from "forge-std/console.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {TestERC20} from "v4-core/src/test/TestERC20.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {SpikeConfig} from "./SpikeConfig.sol";

/// @notice Unichain Sepolia: deploys two test tokens and a fresh V4 pool we fully control, so every Swap event
///         on it is ours (no billing for other people's traffic) and the price can be moved on demand.
contract SetupPool is SpikeConfig {
    using PoolIdLibrary for PoolKey;

    uint24 internal constant FEE = 3000;
    int24 internal constant TICK_SPACING = 60;
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    uint256 internal constant MINT = 1e30;

    function run() external {
        _requireChain(UNICHAIN_SEPOLIA);
        IPoolManager manager = IPoolManager(POOL_MANAGER);

        vm.startBroadcast();
        TestERC20 a = new TestERC20(MINT);
        TestERC20 b = new TestERC20(MINT);
        (TestERC20 t0, TestERC20 t1) = address(a) < address(b) ? (a, b) : (b, a);

        PoolSwapTest swapRouter = new PoolSwapTest(manager);
        PoolModifyLiquidityTest lpRouter = new PoolModifyLiquidityTest(manager);

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(t0)),
            currency1: Currency.wrap(address(t1)),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });
        manager.initialize(key, SQRT_PRICE_1_1);

        t0.approve(address(lpRouter), type(uint256).max);
        t1.approve(address(lpRouter), type(uint256).max);
        t0.approve(address(swapRouter), type(uint256).max);
        t1.approve(address(swapRouter), type(uint256).max);

        lpRouter.modifyLiquidity(
            key, ModifyLiquidityParams({tickLower: -6000, tickUpper: 6000, liquidityDelta: 1e21, salt: bytes32(0)}), ""
        );
        vm.stopBroadcast();

        PoolId id = key.toId();
        _write(".token0", vm.toString(address(t0)));
        _write(".token1", vm.toString(address(t1)));
        _write(".swapRouter", vm.toString(address(swapRouter)));
        _write(".lpRouter", vm.toString(address(lpRouter)));
        _write(".poolId", vm.toString(PoolId.unwrap(id)));

        console.log("token0      ", address(t0));
        console.log("token1      ", address(t1));
        console.log("swapRouter  ", address(swapRouter));
        console.log("lpRouter    ", address(lpRouter));
        console.log("poolId");
        console.logBytes32(PoolId.unwrap(id));
    }
}
