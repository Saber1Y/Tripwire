// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {console} from "forge-std/console.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {SpikeConfig} from "./SpikeConfig.sol";

/// @notice Unichain Sepolia: performs exact-input swaps on our pool, each emitting one V4 Swap event.
/// @dev Env: SWAP_ZERO_FOR_ONE (direction of the first swap, default true), SWAP_AMOUNT (wei of input token,
///      default 1e18), SWAP_COUNT (default 1). Multiple swaps alternate direction so the price oscillates
///      around its start instead of drifting. Run with --slow so each swap lands before the next is sent.
contract Swap is SpikeConfig {
    function run() external {
        _requireChain(UNICHAIN_SEPOLIA);
        bool zeroForOne = vm.envOr("SWAP_ZERO_FOR_ONE", true);
        uint256 amount = vm.envOr("SWAP_AMOUNT", uint256(1e18));
        uint256 count = vm.envOr("SWAP_COUNT", uint256(1));

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(_readAddress(".token0")),
            currency1: Currency.wrap(_readAddress(".token1")),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        PoolSwapTest router = PoolSwapTest(_readAddress(".swapRouter"));

        for (uint256 i; i < count; ++i) {
            vm.broadcast();
            router.swap(
                key,
                SwapParams({
                    zeroForOne: zeroForOne,
                    // forge-lint: disable-next-line(unsafe-typecast)
                    amountSpecified: -int256(amount),
                    sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
                }),
                PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
                ""
            );
            console.log("swapped", amount, zeroForOne ? "token0 -> token1" : "token1 -> token0");
            zeroForOne = !zeroForOne;
        }
    }
}
