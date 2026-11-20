// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {IReactive} from "@reactive/src/interfaces/IReactive.sol";
import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {AbstractPayer} from "@reactive/src/base/AbstractPayer.sol";
import {AbstractCallback} from "@reactive/src/base/AbstractCallback.sol";
import {SpikeReactive} from "../../src/spike/SpikeReactive.sol";
import {PingReceiver} from "../../src/spike/PingReceiver.sol";
import {MockSystemContract} from "../mocks/MockSystemContract.sol";

contract SpikeTest is Test {
    address constant SYSTEM = 0x8888888888888888888888888888888888888888;
    uint256 constant REACTIVE_IGNORE = 0xa65f96fc951c35ead38878e0f0b7a3c744a6f5ccc1476b313353ce31712313ad;
    uint256 constant UNICHAIN_SEPOLIA = 1301;
    address constant POOL_MANAGER = 0x00B036B58a818B1BC34d502D3fE730Db729e62AC;
    bytes32 constant POOL_ID = keccak256("pool");

    MockSystemContract system;
    SpikeReactive reactive;
    PingReceiver receiver;
    address proxy = makeAddr("callbackProxy");
    address owner = makeAddr("owner");

    function setUp() public {
        vm.etch(SYSTEM, address(new MockSystemContract()).code);
        system = MockSystemContract(payable(SYSTEM));

        vm.prank(owner);
        reactive = new SpikeReactive(UNICHAIN_SEPOLIA, POOL_MANAGER, POOL_ID);
        receiver = new PingReceiver(IPayable(payable(proxy)), address(reactive));
    }

    function _swapLog(uint256 txHash_) internal view returns (IReactive.LogRecord memory log_) {
        log_.chainId = UNICHAIN_SEPOLIA;
        log_.contractAddress = POOL_MANAGER;
        log_.topic0 = reactive.V4_SWAP_TOPIC0();
        log_.topic1 = uint256(POOL_ID);
        log_.topic2 = uint256(uint160(address(0xBEEF)));
        log_.blockNumber = 1234;
        log_.opCode = 3;
        log_.txHash = txHash_;
        log_.logIndex = 7;
    }

    function test_constructorSubscribesToExactPoolSwaps() public view {
        assertEq(system.subscriptionCount(), 1);
        MockSystemContract.Subscription memory s = system.subscriptionAt(0);
        assertEq(s.subscriber, address(reactive));
        assertEq(s.chainId, UNICHAIN_SEPOLIA);
        assertEq(s.contractAddress, POOL_MANAGER);
        assertEq(s.topic0, reactive.V4_SWAP_TOPIC0());
        assertEq(s.topic1, uint256(POOL_ID));
        assertEq(s.topic2, REACTIVE_IGNORE);
        assertEq(s.topic3, REACTIVE_IGNORE);
    }

    function test_swapTopicMatchesV4Event() public view {
        assertEq(
            reactive.V4_SWAP_TOPIC0(),
            uint256(keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)"))
        );
    }

    function test_reactRequestsPingCallback() public {
        vm.prank(owner);
        reactive.setRecipient(address(receiver));

        IReactive.LogRecord memory log_ = _swapLog(0xabc);
        vm.prank(SYSTEM);
        reactive.react(log_);

        assertEq(system.callbackCount(), 1);
        MockSystemContract.CallbackRequest memory c = system.callbackAt(0);
        assertEq(c.requester, address(reactive));
        assertEq(c.chainId, UNICHAIN_SEPOLIA);
        assertEq(c.recipient, address(receiver));
        assertEq(c.gasLimit, reactive.CALLBACK_GAS_LIMIT());
        assertEq(
            c.payload,
            abi.encodeWithSignature("ping(address,uint256,uint256,uint256)", address(0), uint256(0xabc), 1234, 7)
        );
    }

    function test_reactIgnoresUntilRecipientSet() public {
        IReactive.LogRecord memory log_ = _swapLog(0xabc);
        vm.prank(SYSTEM);
        reactive.react(log_);
        assertEq(system.callbackCount(), 0);
    }

    function test_reactIgnoresForeignLogs() public {
        vm.prank(owner);
        reactive.setRecipient(address(receiver));

        IReactive.LogRecord memory log_ = _swapLog(1);
        log_.topic1 = uint256(keccak256("other pool"));
        vm.prank(SYSTEM);
        reactive.react(log_);

        log_ = _swapLog(1);
        log_.chainId = 84532;
        vm.prank(SYSTEM);
        reactive.react(log_);

        assertEq(system.callbackCount(), 0);
    }

    function test_reactOnlyCallableBySystem() public {
        IReactive.LogRecord memory log_ = _swapLog(1);
        vm.expectRevert(abi.encodeWithSelector(AbstractPayer.NotAuthorized.selector, address(this), SYSTEM));
        reactive.react(log_);
    }

    function test_setRecipientOnlyOwnerAndOnce() public {
        vm.expectRevert(SpikeReactive.NotOwner.selector);
        reactive.setRecipient(address(receiver));

        vm.startPrank(owner);
        vm.expectRevert(SpikeReactive.ZeroAddress.selector);
        reactive.setRecipient(address(0));
        reactive.setRecipient(address(receiver));
        vm.expectRevert(SpikeReactive.RecipientAlreadySet.selector);
        reactive.setRecipient(address(receiver));
        vm.stopPrank();
    }

    function test_receiverRecordsPingFromProxy() public {
        vm.expectEmit(true, false, false, true, address(receiver));
        emit PingReceiver.Ping(0xabc, 1234, 7, block.timestamp, block.number);
        vm.prank(proxy);
        receiver.ping(address(reactive), 0xabc, 1234, 7);
        assertEq(receiver.pings(), 1);
    }

    function test_receiverRejectsNonProxyCaller() public {
        vm.expectRevert(abi.encodeWithSelector(AbstractPayer.NotAuthorized.selector, address(this), proxy));
        receiver.ping(address(reactive), 1, 1, 1);
    }

    function test_receiverRejectsForeignReactiveContract() public {
        address impostor = makeAddr("impostor");
        vm.expectRevert(
            abi.encodeWithSelector(AbstractCallback.CallbackNotAuthorized.selector, impostor, address(reactive))
        );
        vm.prank(proxy);
        receiver.ping(impostor, 1, 1, 1);
    }

    /// @dev End-to-end through the payload the reactive contract built: what the proxy would deliver after
    ///      overwriting the first argument with the reactive contract's address.
    function test_payloadRoundTripsIntoReceiver() public {
        vm.prank(owner);
        reactive.setRecipient(address(receiver));
        IReactive.LogRecord memory log_ = _swapLog(0xdef);
        vm.prank(SYSTEM);
        reactive.react(log_);

        // Payload layout: selector (4 bytes) | arg0 address (32 bytes) | remaining args. Replace arg0.
        bytes memory payload = system.callbackAt(0).payload;
        // forge-lint: disable-next-line(unsafe-typecast)
        bytes memory delivered = abi.encodePacked(bytes4(payload), abi.encode(address(reactive)), _slice(payload, 36));

        vm.prank(proxy);
        (bool ok,) = address(receiver).call(delivered);
        assertTrue(ok);
        assertEq(receiver.pings(), 1);
    }

    function _slice(bytes memory b_, uint256 from_) internal pure returns (bytes memory out_) {
        out_ = new bytes(b_.length - from_);
        for (uint256 i; i < out_.length; ++i) {
            out_[i] = b_[from_ + i];
        }
    }
}
