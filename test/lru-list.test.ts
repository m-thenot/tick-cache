import { describe, it, expect } from "vitest";
import { LruList } from "../src/lru-list";
import { EntryStore } from "../src/entry-store";
import { NIL } from "../src/constants";

describe("LruList", () => {
    describe("Construction and Initialization", () => {
        it("should start empty", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);

            expect(lru.isEmpty()).toBe(true);
            expect(lru.getTail()).toBe(NIL);
        });

        it("should work with any store type", () => {
            const store1 = new EntryStore<string, string>({ maxEntries: 10 });
            const lru1 = new LruList(store1);
            expect(lru1.isEmpty()).toBe(true);

            const store2 = new EntryStore<number, object>({ maxEntries: 10 });
            const lru2 = new LruList(store2);
            expect(lru2.isEmpty()).toBe(true);
        });
    });

    describe("linkHead - Single Entry", () => {
        it("should link first entry as both head and tail", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);
            const id = store.allocId();

            lru.linkHead(id);

            expect(lru.isEmpty()).toBe(false);
            expect(lru.getTail()).toBe(id);
            expect(store.lruNext[id]).toBe(NIL);
            expect(store.lruPrev[id]).toBe(NIL);
        });

        it("should set correct pointers for single entry", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);
            const id = store.allocId();

            lru.linkHead(id);

            // Single entry: no next, no prev
            expect(store.lruNext[id]).toBe(NIL);
            expect(store.lruPrev[id]).toBe(NIL);
        });
    });

    describe("linkHead - Multiple Entries", () => {
        it("should maintain correct order when linking multiple entries", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);

            const id0 = store.allocId();
            const id1 = store.allocId();
            const id2 = store.allocId();

            lru.linkHead(id0);
            lru.linkHead(id1);
            lru.linkHead(id2);

            // Most recent (head) should be id2, oldest (tail) should be id0
            expect(lru.getTail()).toBe(id0);

            // Verify chain: id2 -> id1 -> id0
            expect(store.lruNext[id2]).toBe(id1);
            expect(store.lruNext[id1]).toBe(id0);
            expect(store.lruNext[id0]).toBe(NIL);

            expect(store.lruPrev[id2]).toBe(NIL);
            expect(store.lruPrev[id1]).toBe(id2);
            expect(store.lruPrev[id0]).toBe(id1);
        });

        it("should keep tail pointing to oldest entry", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);

            const id0 = store.allocId();
            const id1 = store.allocId();
            const id2 = store.allocId();

            lru.linkHead(id0);
            expect(lru.getTail()).toBe(id0);

            lru.linkHead(id1);
            expect(lru.getTail()).toBe(id0); // Still id0

            lru.linkHead(id2);
            expect(lru.getTail()).toBe(id0); // Still id0
        });

        it("should handle many entries", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);

            const ids = [];
            for (let i = 0; i < 50; i++) {
                const id = store.allocId();
                ids.push(id);
                lru.linkHead(id);
            }

            // First entry should be tail
            expect(lru.getTail()).toBe(ids[0]);

            // Verify chain integrity
            let current = ids[ids.length - 1]; // Start from most recent
            for (let i = ids.length - 1; i >= 0; i--) {
                expect(current).toBe(ids[i]);
                current = store.lruNext[current];
            }
            expect(current).toBe(NIL);
        });
    });

    describe("unlink - Single Entry", () => {
        it("should unlink the only entry and return to empty state", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);
            const id = store.allocId();

            lru.linkHead(id);
            expect(lru.isEmpty()).toBe(false);

            lru.unlink(id);

            expect(lru.isEmpty()).toBe(true);
            expect(lru.getTail()).toBe(NIL);
        });

        it("should clear pointers after unlink", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);
            const id = store.allocId();

            lru.linkHead(id);
            lru.unlink(id);

            expect(store.lruNext[id]).toBe(NIL);
            expect(store.lruPrev[id]).toBe(NIL);
        });
    });

    describe("unlink - From Head", () => {
        it("should unlink head and update to next entry", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);

            const id0 = store.allocId();
            const id1 = store.allocId();
            const id2 = store.allocId();

            lru.linkHead(id0);
            lru.linkHead(id1);
            lru.linkHead(id2);

            // Unlink head (id2)
            lru.unlink(id2);

            // id1 should now be the head
            expect(store.lruPrev[id1]).toBe(NIL);
            expect(store.lruNext[id1]).toBe(id0);

            // id2 should be cleaned
            expect(store.lruNext[id2]).toBe(NIL);
            expect(store.lruPrev[id2]).toBe(NIL);

            // Tail should still be id0
            expect(lru.getTail()).toBe(id0);
        });

        it("should maintain tail when unlinking head from 2-entry list", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);

            const id0 = store.allocId();
            const id1 = store.allocId();

            lru.linkHead(id0);
            lru.linkHead(id1);

            // Unlink head (id1)
            lru.unlink(id1);

            expect(lru.isEmpty()).toBe(false);
            expect(lru.getTail()).toBe(id0);
            expect(store.lruNext[id0]).toBe(NIL);
            expect(store.lruPrev[id0]).toBe(NIL);
        });
    });

    describe("unlink - From Tail", () => {
        it("should unlink tail and update to previous entry", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);

            const id0 = store.allocId();
            const id1 = store.allocId();
            const id2 = store.allocId();

            lru.linkHead(id0);
            lru.linkHead(id1);
            lru.linkHead(id2);

            // Unlink tail (id0)
            lru.unlink(id0);

            // id1 should now be the tail
            expect(lru.getTail()).toBe(id1);
            expect(store.lruNext[id1]).toBe(NIL);

            // id0 should be cleaned
            expect(store.lruNext[id0]).toBe(NIL);
            expect(store.lruPrev[id0]).toBe(NIL);
        });

        it("should handle unlinking tail from 2-entry list", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);

            const id0 = store.allocId();
            const id1 = store.allocId();

            lru.linkHead(id0);
            lru.linkHead(id1);

            // Unlink tail (id0)
            lru.unlink(id0);

            expect(lru.isEmpty()).toBe(false);
            expect(lru.getTail()).toBe(id1);
            expect(store.lruNext[id1]).toBe(NIL);
            expect(store.lruPrev[id1]).toBe(NIL);
        });
    });

    describe("unlink - From Middle", () => {
        it("should unlink middle entry and maintain chain", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);

            const id0 = store.allocId();
            const id1 = store.allocId();
            const id2 = store.allocId();

            lru.linkHead(id0);
            lru.linkHead(id1);
            lru.linkHead(id2);

            // Unlink middle (id1)
            lru.unlink(id1);

            // id2 should point directly to id0
            expect(store.lruNext[id2]).toBe(id0);
            expect(store.lruPrev[id0]).toBe(id2);

            // id1 should be cleaned
            expect(store.lruNext[id1]).toBe(NIL);
            expect(store.lruPrev[id1]).toBe(NIL);

            // Head and tail unchanged
            expect(lru.getTail()).toBe(id0);
        });

        it("should handle unlinking from middle of long chain", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);

            const ids = [];
            for (let i = 0; i < 10; i++) {
                const id = store.allocId();
                ids.push(id);
                lru.linkHead(id);
            }

            // Unlink entry at index 5 (middle)
            const middleId = ids[5];
            lru.unlink(middleId);

            // Verify chain integrity
            // Head: ids[9] -> ids[8] -> ... -> skip ids[5] -> ... -> ids[0] (tail)
            expect(lru.getTail()).toBe(ids[0]);

            // Check that middleId is removed
            expect(store.lruNext[middleId]).toBe(NIL);
            expect(store.lruPrev[middleId]).toBe(NIL);

            // Check neighbors are connected
            const prevId = ids[6];
            const nextId = ids[4];
            expect(store.lruNext[prevId]).toBe(nextId);
            expect(store.lruPrev[nextId]).toBe(prevId);
        });
    });

    describe("touch - Optimization", () => {
        it("should do nothing when touching entry already at head", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);

            const id0 = store.allocId();
            const id1 = store.allocId();

            lru.linkHead(id0);
            lru.linkHead(id1);

            // id1 is at head, touch it
            const prevNext = store.lruNext[id1];
            const prevPrev = store.lruPrev[id1];

            lru.touch(id1);

            // Nothing should change
            expect(store.lruNext[id1]).toBe(prevNext);
            expect(store.lruPrev[id1]).toBe(prevPrev);
            expect(lru.getTail()).toBe(id0);
        });

        it("should move tail to head when touched", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);

            const id0 = store.allocId();
            const id1 = store.allocId();
            const id2 = store.allocId();

            lru.linkHead(id0);
            lru.linkHead(id1);
            lru.linkHead(id2);

            // Touch tail (id0)
            lru.touch(id0);

            // id0 should now be at head, id1 should be new tail
            expect(lru.getTail()).toBe(id1);
            expect(store.lruPrev[id0]).toBe(NIL); // id0 is head
            expect(store.lruNext[id0]).toBe(id2);
            expect(store.lruNext[id1]).toBe(NIL); // id1 is tail
        });

        it("should move middle entry to head when touched", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);

            const id0 = store.allocId();
            const id1 = store.allocId();
            const id2 = store.allocId();

            lru.linkHead(id0);
            lru.linkHead(id1);
            lru.linkHead(id2);

            // Touch middle (id1)
            lru.touch(id1);

            // id1 should now be at head
            expect(store.lruPrev[id1]).toBe(NIL);
            expect(store.lruNext[id1]).toBe(id2);

            // id2 should follow id1
            expect(store.lruPrev[id2]).toBe(id1);

            // Tail should still be id0
            expect(lru.getTail()).toBe(id0);
        });

        it("should handle touch on single entry", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);

            const id = store.allocId();
            lru.linkHead(id);

            // Touch the only entry (optimization: already at head)
            lru.touch(id);

            expect(lru.isEmpty()).toBe(false);
            expect(lru.getTail()).toBe(id);
            expect(store.lruNext[id]).toBe(NIL);
            expect(store.lruPrev[id]).toBe(NIL);
        });
    });

    describe("touch - Multiple Operations", () => {
        it("should maintain correct order with multiple touches", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);

            const id0 = store.allocId();
            const id1 = store.allocId();
            const id2 = store.allocId();

            lru.linkHead(id0); // [id0]
            lru.linkHead(id1); // [id1, id0]
            lru.linkHead(id2); // [id2, id1, id0]

            lru.touch(id0); // [id0, id2, id1]
            expect(lru.getTail()).toBe(id1);

            lru.touch(id1); // [id1, id0, id2]
            expect(lru.getTail()).toBe(id2);

            lru.touch(id2); // [id2, id1, id0]
            expect(lru.getTail()).toBe(id0);
        });

        it("should handle alternating touches", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);

            const id0 = store.allocId();
            const id1 = store.allocId();

            lru.linkHead(id0);
            lru.linkHead(id1);

            // Alternate touches
            for (let i = 0; i < 10; i++) {
                lru.touch(id0);
                expect(lru.getTail()).toBe(id1);

                lru.touch(id1);
                expect(lru.getTail()).toBe(id0);
            }
        });
    });

    describe("reset", () => {
        it("should reset to empty state", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);

            const id0 = store.allocId();
            const id1 = store.allocId();

            lru.linkHead(id0);
            lru.linkHead(id1);

            expect(lru.isEmpty()).toBe(false);

            lru.reset();

            expect(lru.isEmpty()).toBe(true);
            expect(lru.getTail()).toBe(NIL);
        });

        it("should not affect store pointers", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);

            const id0 = store.allocId();
            const id1 = store.allocId();

            lru.linkHead(id0);
            lru.linkHead(id1);

            // Store still has pointers
            expect(store.lruNext[id1]).toBe(id0);

            lru.reset();

            // LruList is reset, but store pointers remain
            // (they would normally be cleaned by unlink or resetSlot)
            expect(lru.isEmpty()).toBe(true);
        });

        it("should allow reuse after reset", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);

            const id0 = store.allocId();
            lru.linkHead(id0);
            lru.reset();

            const id1 = store.allocId();
            lru.linkHead(id1);

            expect(lru.isEmpty()).toBe(false);
            expect(lru.getTail()).toBe(id1);
        });
    });

    describe("isEmpty", () => {
        it("should return true for new list", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);

            expect(lru.isEmpty()).toBe(true);
        });

        it("should return false after adding entry", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);

            const id = store.allocId();
            lru.linkHead(id);

            expect(lru.isEmpty()).toBe(false);
        });

        it("should return true after removing last entry", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);

            const id = store.allocId();
            lru.linkHead(id);
            lru.unlink(id);

            expect(lru.isEmpty()).toBe(true);
        });

        it("should return true after reset", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);

            const id = store.allocId();
            lru.linkHead(id);
            lru.reset();

            expect(lru.isEmpty()).toBe(true);
        });
    });

    describe("getTail", () => {
        it("should return NIL for empty list", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);

            expect(lru.getTail()).toBe(NIL);
        });

        it("should return correct tail after operations", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);

            const id0 = store.allocId();
            const id1 = store.allocId();
            const id2 = store.allocId();

            lru.linkHead(id0);
            expect(lru.getTail()).toBe(id0);

            lru.linkHead(id1);
            expect(lru.getTail()).toBe(id0);

            lru.linkHead(id2);
            expect(lru.getTail()).toBe(id0);

            lru.unlink(id0);
            expect(lru.getTail()).toBe(id1);

            lru.unlink(id1);
            expect(lru.getTail()).toBe(id2);
        });
    });

    describe("Complex Scenarios", () => {
        it("should handle interleaved link and unlink operations", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);

            const id0 = store.allocId();
            const id1 = store.allocId();
            const id2 = store.allocId();
            const id3 = store.allocId();

            lru.linkHead(id0);
            lru.linkHead(id1);
            lru.unlink(id0);
            lru.linkHead(id2);
            lru.touch(id1);
            lru.linkHead(id3);
            lru.unlink(id2);

            // Final order: [id3, id1]
            expect(lru.getTail()).toBe(id1);
            expect(store.lruNext[id3]).toBe(id1);
            expect(store.lruNext[id1]).toBe(NIL);
        });

        it("should simulate LRU eviction pattern", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);

            const ids = [];
            for (let i = 0; i < 5; i++) {
                const id = store.allocId();
                ids.push(id);
                lru.linkHead(id);
            }

            // Simulate cache accesses (touches)
            lru.touch(ids[0]); // Access oldest
            lru.touch(ids[2]); // Access middle

            // The new tail should be ids[1] (next oldest after ids[0])
            expect(lru.getTail()).toBe(ids[1]);

            // Evict tail
            const evicted = lru.getTail();
            lru.unlink(evicted);

            expect(evicted).toBe(ids[1]);
            expect(lru.getTail()).toBe(ids[3]);
        });

        it("should maintain integrity with 100 random operations", () => {
            const store = new EntryStore<string, number>({ maxEntries: 1000 });
            const lru = new LruList(store);

            const ids = [];
            for (let i = 0; i < 50; i++) {
                ids.push(store.allocId());
            }

            // Random operations
            for (let i = 0; i < 100; i++) {
                const op = i % 3;
                const idx = i % ids.length;

                if (op === 0) {
                    lru.linkHead(ids[idx]);
                } else if (op === 1 && !lru.isEmpty()) {
                    lru.touch(ids[idx % 25]); // Touch first half
                } else if (!lru.isEmpty()) {
                    const tail = lru.getTail();
                    if (tail !== NIL) {
                        lru.unlink(tail);
                    }
                }
            }

            // List should still be valid
            if (!lru.isEmpty()) {
                const tail = lru.getTail();
                expect(tail).not.toBe(NIL);
            }
        });

        it("should handle repeated link/unlink of same entry", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);

            const id = store.allocId();

            for (let i = 0; i < 10; i++) {
                lru.linkHead(id);
                expect(lru.isEmpty()).toBe(false);
                expect(lru.getTail()).toBe(id);

                lru.unlink(id);
                expect(lru.isEmpty()).toBe(true);
            }
        });
    });

    describe("Edge Cases", () => {
        it("should handle all entries being touched in sequence", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);

            const ids = [];
            for (let i = 0; i < 10; i++) {
                const id = store.allocId();
                ids.push(id);
                lru.linkHead(id);
            }

            // Touch all in order (0 to 9)
            for (let i = 0; i < ids.length; i++) {
                lru.touch(ids[i]);
            }

            // Last touched (ids[9]) should be at head, first touched (ids[0]) should be tail
            expect(lru.getTail()).toBe(ids[0]);
        });

        it("should handle unlinking all entries one by one from tail", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);

            const ids = [];
            for (let i = 0; i < 20; i++) {
                const id = store.allocId();
                ids.push(id);
                lru.linkHead(id);
            }

            // Unlink all from tail
            for (let i = 0; i < 20; i++) {
                const tail = lru.getTail();
                expect(tail).toBe(ids[i]);
                lru.unlink(tail);
            }

            expect(lru.isEmpty()).toBe(true);
        });

        it("should handle unlinking all entries from head", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);

            const ids = [];
            for (let i = 0; i < 20; i++) {
                const id = store.allocId();
                ids.push(id);
                lru.linkHead(id);
            }

            // Unlink all from head (most recent first)
            for (let i = 19; i >= 0; i--) {
                lru.unlink(ids[i]);
            }

            expect(lru.isEmpty()).toBe(true);
        });

        it("should work correctly with maxEntries = 1", () => {
            const store = new EntryStore<string, number>({ maxEntries: 1 });
            const lru = new LruList(store);

            const id = store.allocId();
            lru.linkHead(id);

            expect(lru.isEmpty()).toBe(false);
            expect(lru.getTail()).toBe(id);

            lru.touch(id); // Should be no-op
            expect(lru.getTail()).toBe(id);

            lru.unlink(id);
            expect(lru.isEmpty()).toBe(true);
        });

        it("should verify pointer integrity after complex operations", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const lru = new LruList(store);

            const ids = [];
            for (let i = 0; i < 10; i++) {
                const id = store.allocId();
                ids.push(id);
                lru.linkHead(id);
            }

            // Perform various operations
            lru.touch(ids[5]);
            lru.unlink(ids[3]);
            lru.touch(ids[8]);
            lru.unlink(ids[0]);
            lru.linkHead(ids[3]); // Re-link previously unlinked

            // Walk the chain and verify no broken links
            const visited = new Set<number>();
            let current = lru.getTail();

            while (current !== NIL) {
                expect(visited.has(current)).toBe(false); // No cycles
                visited.add(current);

                const prev = store.lruPrev[current];
                if (prev !== NIL) {
                    expect(store.lruNext[prev]).toBe(current); // Consistency
                }

                current = store.lruPrev[current];
            }

            expect(visited.size).toBeGreaterThan(0);
        });
    });

    describe("Integration with EntryStore", () => {
        it("should work with store alloc/free cycle", () => {
            const store = new EntryStore<string, number>({ maxEntries: 10 });
            const lru = new LruList(store);

            const id0 = store.allocId();
            const id1 = store.allocId();

            // Set entries (required before freeId)
            store.setEntry(id0, "key0", 0);
            store.setEntry(id1, "key1", 1);

            lru.linkHead(id0);
            lru.linkHead(id1);

            // Simulate entry eviction
            const tail = lru.getTail();
            lru.unlink(tail);
            store.freeId(tail);

            // Allocate new entry (should reuse freed ID)
            const id2 = store.allocId();
            expect(id2).toBe(tail); // Reused

            lru.linkHead(id2);
            expect(lru.isEmpty()).toBe(false);
        });

        it("should handle store growth during operation", () => {
            const store = new EntryStore<string, number>({
                maxEntries: 100,
                initialCap: 4,
            });
            const lru = new LruList(store);

            const ids = [];
            // Allocate more than initial capacity to trigger growth
            for (let i = 0; i < 20; i++) {
                const id = store.allocId();
                ids.push(id);
                lru.linkHead(id);
            }

            expect(store.debug().cap).toBeGreaterThan(4);
            expect(lru.isEmpty()).toBe(false);
            expect(lru.getTail()).toBe(ids[0]);

            // Verify all entries are accessible
            for (const id of ids) {
                lru.touch(id);
            }
        });
    });
});
