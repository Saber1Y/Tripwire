// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {console} from "forge-std/console.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {TripwireVault} from "../src/TripwireVault.sol";
import {TripwireReactive} from "../src/TripwireReactive.sol";
import {SpikeConfig, IDepositor} from "./spike/SpikeConfig.sol";

/// @notice Deploys Tripwire across both chains in one run (one password prompt):
///         1. Predicts the vault's address from the deployer's next Unichain Sepolia nonce.
///         2. Lasna: deploys TripwireReactive bound to that address and prepays it in lREACT.
///         3. Unichain Sepolia: deploys TripwireVault (its first transaction, so the prediction holds), creates the
///            Tripwire demo pool, adds liquidity, enables the pool and prepays callbacks in ETH.
/// @dev Reuses the Phase 0 test tokens and liquidity router. The demo pool uses a different fee tier from the
///      spike pool, so the spike's still-subscribed probe never fires on Tripwire's traffic.
///      Env: TRIPWIRE_REACTIVE_FUNDING (lREACT wei, default 1 ether), TRIPWIRE_CALLBACK_FUNDING (ETH wei,
///      default 0.003 ether). Run with --multi --slow.
contract DeployTripwire is SpikeConfig {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint24 internal constant FEE = 500;
    int24 internal constant TICK_SPACING = 10;
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    string internal constant OUT_LIVE = "deployments/tripwire.json";
    string internal constant OUT_DRY_RUN = "deployments/tripwire.dry-run.json";

    /// @dev forge-std's DEFAULT_SENDER. Multi-fork scripts keep it as msg.sender unless --sender is passed too.
    address internal constant FOUNDRY_DEFAULT_SENDER = 0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38;

    function run() external {
        address deployer = msg.sender;
        require(deployer != FOUNDRY_DEFAULT_SENDER, "DeployTripwire: pass --sender <deployer address> with --account");
        uint256 reactiveFunding = vm.envOr("TRIPWIRE_REACTIVE_FUNDING", uint256(1 ether));
        uint256 callbackFunding = vm.envOr("TRIPWIRE_CALLBACK_FUNDING", uint256(0.003 ether));

        uint256 unichainFork = vm.createFork(vm.rpcUrl("unichain_sepolia"));
        uint256 lasnaFork = vm.createFork(vm.rpcUrl("lasna"));

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(_readAddress(".token0")),
            currency1: Currency.wrap(_readAddress(".token1")),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });
        PoolId poolId = key.toId();

        // 1. Predict.
        vm.selectFork(unichainFork);
        _requireChain(UNICHAIN_SEPOLIA);
        address predictedVault = vm.computeCreateAddress(deployer, vm.getNonce(deployer));

        // 2. Lasna.
        vm.selectFork(lasnaFork);
        _requireChain(LASNA);
        bytes32[] memory pools = new bytes32[](1);
        pools[0] = PoolId.unwrap(poolId);
        vm.startBroadcast(deployer);
        TripwireReactive reactive =
            new TripwireReactive(UNICHAIN_SEPOLIA, predictedVault, POOL_MANAGER, UNICHAIN_CALLBACK_PROXY, pools);
        IDepositor(REACTIVE_SYSTEM).depositTo{value: reactiveFunding}(address(reactive));
        vm.stopBroadcast();

        // 3. Unichain Sepolia.
        vm.selectFork(unichainFork);
        IPoolManager manager = IPoolManager(POOL_MANAGER);
        vm.startBroadcast(deployer);
        TripwireVault vault =
            new TripwireVault(manager, IPayable(payable(UNICHAIN_CALLBACK_PROXY)), address(reactive), deployer);
        require(address(vault) == predictedVault, "DeployTripwire: vault address prediction failed");

        (uint160 price,,,) = manager.getSlot0(poolId);
        if (price == 0) manager.initialize(key, SQRT_PRICE_1_1);
        PoolModifyLiquidityTest(_readAddress(".lpRouter"))
            .modifyLiquidity(
                key,
                ModifyLiquidityParams({tickLower: -6000, tickUpper: 6000, liquidityDelta: 1e21, salt: bytes32(0)}),
                ""
            );
        vault.setPoolSupported(key, true);
        IDepositor(UNICHAIN_CALLBACK_PROXY).depositTo{value: callbackFunding}(address(vault));
        vm.stopBroadcast();

        _writeOut(".vault", vm.toString(address(vault)));
        _writeOut(".reactive", vm.toString(address(reactive)));
        _writeOut(".poolId", vm.toString(PoolId.unwrap(poolId)));
        _writeOut(".fee", vm.toString(uint256(FEE)));
        _writeOut(".tickSpacing", vm.toString(int256(TICK_SPACING)));

        console.log("TripwireReactive (Lasna)          ", address(reactive));
        console.log("TripwireVault    (Unichain Sepolia)", address(vault));
        console.log("poolId");
        console.logBytes32(PoolId.unwrap(poolId));
    }

    function _writeOut(string memory key_, string memory value_) internal {
        string memory path = vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) ? OUT_LIVE : OUT_DRY_RUN;
        // forge-lint: disable-next-line(unsafe-cheatcode)
        if (!vm.exists(path)) vm.writeFile(path, "{}");
        vm.writeJson(value_, path, key_);
    }
}
