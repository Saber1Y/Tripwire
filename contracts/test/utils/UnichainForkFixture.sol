// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test, Vm} from "forge-std/Test.sol";
import {IReactive} from "@reactive/src/interfaces/IReactive.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {TestERC20} from "v4-core/src/test/TestERC20.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";

/// @notice Forks Unichain Sepolia at a pinned block and builds a fresh, fully controlled V4 pool on the real
///         PoolManager, so vault tests exercise the deployed Uniswap code rather than a local copy.
abstract contract UnichainForkFixture is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint256 internal constant UNICHAIN_SEPOLIA = 1301;
    uint256 internal constant FORK_BLOCK = 68_679_997;
    IPoolManager internal constant POOL_MANAGER = IPoolManager(0x00B036B58a818B1BC34d502D3fE730Db729e62AC);
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    TestERC20 internal token0;
    TestERC20 internal token1;
    PoolKey internal key;
    PoolId internal poolId;
    PoolSwapTest internal swapRouter;
    PoolModifyLiquidityTest internal lpRouter;

    function _setUpFork() internal {
        vm.createSelectFork(vm.envOr("UNICHAIN_SEPOLIA_RPC", string("https://sepolia.unichain.org")), FORK_BLOCK);

        TestERC20 a = new TestERC20(1e30);
        TestERC20 b = new TestERC20(1e30);
        (token0, token1) = address(a) < address(b) ? (a, b) : (b, a);

        swapRouter = new PoolSwapTest(POOL_MANAGER);
        lpRouter = new PoolModifyLiquidityTest(POOL_MANAGER);
        key = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        poolId = key.toId();
        POOL_MANAGER.initialize(key, SQRT_PRICE_1_1);

        token0.approve(address(lpRouter), type(uint256).max);
        token1.approve(address(lpRouter), type(uint256).max);
        token0.approve(address(swapRouter), type(uint256).max);
        token1.approve(address(swapRouter), type(uint256).max);
        lpRouter.modifyLiquidity(
            key, ModifyLiquidityParams({tickLower: -6000, tickUpper: 6000, liquidityDelta: 1e21, salt: bytes32(0)}), ""
        );
    }

    /// @dev Exact-input swap by this test contract, moving the pool price.
    function _swap(bool zeroForOne_, uint256 amountIn_) internal {
        swapRouter.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne_,
                // forge-lint: disable-next-line(unsafe-typecast)
                amountSpecified: -int256(amountIn_),
                sqrtPriceLimitX96: zeroForOne_ ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }

    function _price() internal view returns (uint160 sqrtPriceX96) {
        (sqrtPriceX96,,,) = POOL_MANAGER.getSlot0(poolId);
    }

    function _priceAtTick(int24 tick_) internal pure returns (uint160) {
        return TickMath.getSqrtPriceAtTick(tick_);
    }

    /// @dev Converts a recorded log into what the Reactive Network would hand to `react()`.
    function _toLogRecord(Vm.Log memory log_, uint256 txHash_, uint256 logIndex_)
        internal
        view
        returns (IReactive.LogRecord memory r)
    {
        r.chainId = block.chainid;
        r.contractAddress = log_.emitter;
        r.opCode = log_.topics.length;
        if (log_.topics.length > 0) r.topic0 = uint256(log_.topics[0]);
        if (log_.topics.length > 1) r.topic1 = uint256(log_.topics[1]);
        if (log_.topics.length > 2) r.topic2 = uint256(log_.topics[2]);
        if (log_.topics.length > 3) r.topic3 = uint256(log_.topics[3]);
        r.data = log_.data;
        r.blockNumber = block.number;
        r.txHash = txHash_;
        r.logIndex = logIndex_;
    }
}
