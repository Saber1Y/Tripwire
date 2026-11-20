// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {console} from "forge-std/console.sol";
import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {PingReceiver} from "../../src/spike/PingReceiver.sol";
import {SpikeConfig, IDepositor} from "./SpikeConfig.sol";

/// @notice Unichain Sepolia: deploys the callback receiver bound to SpikeReactive and prepays its callbacks in ETH.
/// @dev Env: SPIKE_CALLBACK_FUNDING (wei, default 0.01 ether).
contract DeployPingReceiver is SpikeConfig {
    function run() external {
        _requireChain(UNICHAIN_SEPOLIA);
        address reactive = _readAddress(".spikeReactive");
        uint256 funding = vm.envOr("SPIKE_CALLBACK_FUNDING", uint256(0.01 ether));

        vm.startBroadcast();
        PingReceiver receiver = new PingReceiver(IPayable(payable(UNICHAIN_CALLBACK_PROXY)), reactive);
        IDepositor(UNICHAIN_CALLBACK_PROXY).depositTo{value: funding}(address(receiver));
        vm.stopBroadcast();

        _write(".pingReceiver", vm.toString(address(receiver)));
        console.log("PingReceiver", address(receiver));
    }
}
