// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {console} from "forge-std/console.sol";
import {SpikeReactive} from "../../src/spike/SpikeReactive.sol";
import {SpikeConfig, IDepositor} from "./SpikeConfig.sol";

/// @notice Lasna: deploys the latency probe subscribed to our pool, and prepays its reactive execution in lREACT.
/// @dev Env: SPIKE_REACTIVE_FUNDING (wei of lREACT, default 2 ether).
contract DeploySpikeReactive is SpikeConfig {
    function run() external {
        _requireChain(LASNA);
        bytes32 poolId = _readBytes32(".poolId");
        uint256 funding = vm.envOr("SPIKE_REACTIVE_FUNDING", uint256(2 ether));

        vm.startBroadcast();
        SpikeReactive reactive = new SpikeReactive(UNICHAIN_SEPOLIA, POOL_MANAGER, poolId);
        IDepositor(REACTIVE_SYSTEM).depositTo{value: funding}(address(reactive));
        vm.stopBroadcast();

        _write(".spikeReactive", vm.toString(address(reactive)));
        console.log("SpikeReactive", address(reactive));
    }
}
