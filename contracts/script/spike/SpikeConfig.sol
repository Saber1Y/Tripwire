// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";

/// @dev Reactive's system contract and callback proxies expose `depositTo`, which settles debt first and then tops up
///      reserves. It is not part of the published `IPayable` interface, so it is declared here.
interface IDepositor {
    function depositTo(address contract_) external payable;
}

/// @notice Addresses verified on-chain on 2026-11-20 and the shared deployment file used by the Phase 0 scripts.
abstract contract SpikeConfig is Script {
    uint256 internal constant UNICHAIN_SEPOLIA = 1301;
    uint256 internal constant LASNA = 5318007;

    address internal constant POOL_MANAGER = 0x00B036B58a818B1BC34d502D3fE730Db729e62AC;
    address internal constant UNICHAIN_CALLBACK_PROXY = 0x775c9B990ADe401060B78D0e98684eEf8d2466C1;
    address internal constant REACTIVE_SYSTEM = 0x8888888888888888888888888888888888888888;

    /// @dev Real deployments only. Simulations write to a separate file so dry runs never pollute it.
    string internal constant DEPLOYMENTS_LIVE = "deployments/spike.json";
    string internal constant DEPLOYMENTS_DRY_RUN = "deployments/spike.dry-run.json";

    function _requireChain(uint256 chainId_) internal view {
        require(block.chainid == chainId_, "SpikeConfig: wrong chain for this script");
    }

    function _deployments() internal view returns (string memory) {
        return vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) ? DEPLOYMENTS_LIVE : DEPLOYMENTS_DRY_RUN;
    }

    /// @dev Live addresses win, so simulations of later steps run against what is really deployed. The dry-run
    ///      file is only a fallback, for chaining simulations before anything is live.
    function _read(string memory key_) internal view returns (bytes memory) {
        string memory path = DEPLOYMENTS_LIVE;
        // forge-lint: disable-next-line(unsafe-cheatcode)
        if (!vm.exists(path) || !vm.keyExistsJson(vm.readFile(path), key_)) path = DEPLOYMENTS_DRY_RUN;
        // forge-lint: disable-next-line(unsafe-cheatcode)
        return vm.parseJson(vm.readFile(path), key_);
    }

    function _readAddress(string memory key_) internal view returns (address) {
        return abi.decode(_read(key_), (address));
    }

    function _readBytes32(string memory key_) internal view returns (bytes32) {
        return abi.decode(_read(key_), (bytes32));
    }

    /// @dev Writes `value_` under `key_`, creating the file on first use.
    function _write(string memory key_, string memory value_) internal {
        string memory path = _deployments();
        // forge-lint: disable-next-line(unsafe-cheatcode)
        if (!vm.exists(path)) vm.writeFile(path, "{}");
        vm.writeJson(value_, path, key_);
    }
}
