// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/// @title OrderHeap
/// @notice Binary min-heap of (key, id) pairs in storage. A max-heap is obtained by storing inverted keys.
/// @dev Entries are never removed from the middle: callers delete lazily by marking the id stale elsewhere and
///      skipping it when it surfaces at the top. That keeps every operation O(log n) with no index bookkeeping.
library OrderHeap {
    struct Entry {
        uint160 key;
        uint96 id;
    }

    struct Heap {
        Entry[] entries;
    }

    error EmptyHeap();

    function size(Heap storage heap_) internal view returns (uint256) {
        return heap_.entries.length;
    }

    function isEmpty(Heap storage heap_) internal view returns (bool) {
        return heap_.entries.length == 0;
    }

    /// @return Smallest entry. Reverts when empty.
    function peek(Heap storage heap_) internal view returns (Entry memory) {
        if (heap_.entries.length == 0) revert EmptyHeap();
        return heap_.entries[0];
    }

    function push(Heap storage heap_, uint160 key_, uint96 id_) internal {
        Entry[] storage entries = heap_.entries;
        entries.push(Entry({key: key_, id: id_}));

        uint256 i = entries.length - 1;
        Entry memory moving = entries[i];
        while (i > 0) {
            uint256 parent = (i - 1) / 2;
            Entry memory p = entries[parent];
            if (p.key <= moving.key) break;
            entries[i] = p;
            i = parent;
        }
        entries[i] = moving;
    }

    /// @return top Smallest entry, removed from the heap. Reverts when empty.
    function pop(Heap storage heap_) internal returns (Entry memory top) {
        Entry[] storage entries = heap_.entries;
        uint256 n = entries.length;
        if (n == 0) revert EmptyHeap();

        top = entries[0];
        Entry memory last = entries[n - 1];
        entries.pop();
        n -= 1;
        if (n == 0) return top;

        uint256 i;
        while (true) {
            uint256 left = 2 * i + 1;
            if (left >= n) break;
            uint256 right = left + 1;
            uint256 child = left;
            Entry memory c = entries[left];
            if (right < n) {
                Entry memory r = entries[right];
                if (r.key < c.key) {
                    child = right;
                    c = r;
                }
            }
            if (last.key <= c.key) break;
            entries[i] = c;
            i = child;
        }
        entries[i] = last;
    }
}
