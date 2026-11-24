// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {OrderHeap} from "../src/libraries/OrderHeap.sol";

contract OrderHeapHarness {
    using OrderHeap for OrderHeap.Heap;

    OrderHeap.Heap internal heap;

    function push(uint160 key_, uint96 id_) external {
        heap.push(key_, id_);
    }

    function pop() external returns (OrderHeap.Entry memory) {
        return heap.pop();
    }

    function peek() external view returns (OrderHeap.Entry memory) {
        return heap.peek();
    }

    function size() external view returns (uint256) {
        return heap.size();
    }
}

contract OrderHeapTest is Test {
    OrderHeapHarness h;

    function setUp() public {
        h = new OrderHeapHarness();
    }

    function test_popsInAscendingKeyOrder() public {
        uint160[6] memory keys = [uint160(50), 10, 40, 10, 30, 20];
        for (uint256 i; i < keys.length; ++i) {
            // forge-lint: disable-next-line(unsafe-typecast)
            h.push(keys[i], uint96(i));
        }
        assertEq(h.size(), 6);
        assertEq(h.peek().key, 10);

        uint160 prev;
        for (uint256 i; i < keys.length; ++i) {
            OrderHeap.Entry memory e = h.pop();
            assertGe(e.key, prev);
            prev = e.key;
        }
        assertEq(h.size(), 0);
    }

    function test_emptyReverts() public {
        vm.expectRevert(OrderHeap.EmptyHeap.selector);
        h.pop();
        vm.expectRevert(OrderHeap.EmptyHeap.selector);
        h.peek();
    }

    function test_keepsIdWithKey() public {
        h.push(300, 3);
        h.push(100, 1);
        h.push(200, 2);
        assertEq(h.pop().id, 1);
        assertEq(h.pop().id, 2);
        assertEq(h.pop().id, 3);
    }

    /// forge-config: default.fuzz.runs = 256
    function testFuzz_heapSortsAnySequence(uint160[] calldata keys_) public {
        vm.assume(keys_.length <= 64);
        for (uint256 i; i < keys_.length; ++i) {
            // forge-lint: disable-next-line(unsafe-typecast)
            h.push(keys_[i], uint96(i));
        }
        uint160 prev;
        for (uint256 i; i < keys_.length; ++i) {
            OrderHeap.Entry memory e = h.pop();
            assertGe(e.key, prev);
            assertEq(e.key, keys_[e.id]);
            prev = e.key;
        }
        assertEq(h.size(), 0);
    }

    function testFuzz_interleavedPushPopMatchesMinimum(uint160[] calldata keys_, uint256 seed_) public {
        vm.assume(keys_.length <= 48);
        uint160[] memory shadow = new uint160[](keys_.length);
        uint256 shadowLen;
        for (uint256 i; i < keys_.length; ++i) {
            // forge-lint: disable-next-line(unsafe-typecast)
            h.push(keys_[i], uint96(i));
            shadow[shadowLen++] = keys_[i];
            if (uint256(keccak256(abi.encode(seed_, i))) % 3 == 0) {
                // remove minimum from shadow and compare to heap pop
                uint256 minIdx;
                for (uint256 j = 1; j < shadowLen; ++j) {
                    if (shadow[j] < shadow[minIdx]) minIdx = j;
                }
                assertEq(h.pop().key, shadow[minIdx]);
                shadow[minIdx] = shadow[--shadowLen];
            }
        }
        assertEq(h.size(), shadowLen);
    }
}
