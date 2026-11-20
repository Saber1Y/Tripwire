// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {SpikeReactive} from "../../src/spike/SpikeReactive.sol";
import {SpikeConfig} from "./SpikeConfig.sol";

/// @notice Lasna: points SpikeReactive at the deployed PingReceiver. Callbacks are only requested after this runs.
contract WireRecipient is SpikeConfig {
    function run() external {
        _requireChain(LASNA);
        SpikeReactive reactive = SpikeReactive(payable(_readAddress(".spikeReactive")));
        address receiver = _readAddress(".pingReceiver");

        vm.broadcast();
        reactive.setRecipient(receiver);
    }
}
