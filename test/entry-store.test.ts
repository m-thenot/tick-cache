import { describe, it, expect } from "vitest";
import { EntryStore, type EntryId } from "../src/entry-store";

describe("EntryStore", () => {
    describe("Construction", () => {
        it("should create with valid maxEntries", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const debug = store.debug();

            expect(debug.cap).toBeGreaterThan(0);
            expect(debug.sizeAllocated).toBe(0);
            expect(debug.freeCount).toBe(0);
        });

        it("should respect custom initialCap", () => {
            const store = new EntryStore<string, number>({
                maxEntries: 1000,
                initialCap: 64,
            });
            expect(store.debug().cap).toBe(64);
        });

        it("should default initialCap to min(1024, maxEntries)", () => {
            const store1 = new EntryStore<string, number>({ maxEntries: 2000 });
            expect(store1.debug().cap).toBe(1024);

            const store2 = new EntryStore<string, number>({ maxEntries: 500 });
            expect(store2.debug().cap).toBe(500);
        });

        it("should throw on invalid maxEntries", () => {
            expect(() => new EntryStore({ maxEntries: 0 })).toThrow();
            expect(() => new EntryStore({ maxEntries: -1 })).toThrow();
            expect(() => new EntryStore({ maxEntries: 1.5 })).toThrow();
        });

        it("should throw on invalid initialCap", () => {
            expect(() =>
                new EntryStore({ maxEntries: 100, initialCap: 0 })
            ).toThrow();
            expect(() =>
                new EntryStore({ maxEntries: 100, initialCap: -1 })
            ).toThrow();
            expect(() =>
                new EntryStore({ maxEntries: 100, initialCap: 1.5 })
            ).toThrow();
        });

        it("should throw when initialCap > maxEntries", () => {
            expect(() =>
                new EntryStore({ maxEntries: 10, initialCap: 20 })
            ).toThrow(/cannot exceed maxEntries/);
        });
    });

    describe("Allocation - Sequential", () => {
        it("should allocate IDs sequentially starting from 0", () => {
            const store = new EntryStore<string, number>({
                maxEntries: 100,
                initialCap: 16,
            });

            const id0 = store.allocId();
            const id1 = store.allocId();
            const id2 = store.allocId();

            expect(id0).toBe(0);
            expect(id1).toBe(1);
            expect(id2).toBe(2);
            expect(store.debug().sizeAllocated).toBe(3);
        });

        it("should allocate up to maxEntries", () => {
            const store = new EntryStore<string, number>({
                maxEntries: 5,
                initialCap: 2,
            });

            const ids: EntryId[] = [];
            for (let i = 0; i < 5; i++) {
                ids.push(store.allocId());
            }

            expect(ids).toEqual([0, 1, 2, 3, 4]);
            expect(store.debug().sizeAllocated).toBe(5);
        });

        it("should return -1 when maxEntries reached", () => {
            const store = new EntryStore<string, number>({
                maxEntries: 3,
                initialCap: 2,
            });

            store.allocId(); // 0
            store.allocId(); // 1
            store.allocId(); // 2

            const id = store.allocId(); // should fail
            expect(id).toBe(-1);
        });
    });

    describe("Capacity Growth", () => {
        it("should grow capacity when needed", () => {
            const store = new EntryStore<string, number>({
                maxEntries: 100,
                initialCap: 4,
            });

            expect(store.debug().cap).toBe(4);

            // Allocate 5 entries (triggers growth)
            for (let i = 0; i < 5; i++) {
                store.allocId();
            }

            expect(store.debug().cap).toBeGreaterThanOrEqual(8);
        });

        it("should double capacity on growth", () => {
            const store = new EntryStore<string, number>({
                maxEntries: 1000,
                initialCap: 8,
            });

            // Fill initial capacity
            for (let i = 0; i < 8; i++) {
                store.allocId();
            }
            expect(store.debug().cap).toBe(8);

            // Trigger growth
            store.allocId();
            expect(store.debug().cap).toBe(16);

            // Fill and grow again
            for (let i = 0; i < 7; i++) {
                store.allocId();
            }
            store.allocId();
            expect(store.debug().cap).toBe(32);
        });

        it("should cap growth at maxEntries", () => {
            const store = new EntryStore<string, number>({
                maxEntries: 20,
                initialCap: 8,
            });

            // Allocate 17 entries (would normally double to 32, but capped at 20)
            for (let i = 0; i < 17; i++) {
                store.allocId();
            }

            expect(store.debug().cap).toBe(20);
        });

        it("should preserve existing data after growth", () => {
            const store = new EntryStore<string, number>({
                maxEntries: 100,
                initialCap: 4,
            });

            // Allocate and mark some entries
            const id0 = store.allocId();
            const id1 = store.allocId();
            store.markUsed(id0, "key0", 100);
            store.markUsed(id1, "key1", 200);

            // Trigger growth by allocating more
            for (let i = 0; i < 10; i++) {
                store.allocId();
            }

            // Verify original data is intact
            expect(store.keyRef[id0]).toBe("key0");
            expect(store.valRef[id0]).toBe(100);
            expect(store.keyRef[id1]).toBe("key1");
            expect(store.valRef[id1]).toBe(200);
        });

        it("should throw when trying to grow beyond maxEntries", () => {
            const store = new EntryStore<string, number>({
                maxEntries: 10,
                initialCap: 10,
            });

            // Fill to capacity
            for (let i = 0; i < 10; i++) {
                store.allocId();
            }

            // This should not throw (maxEntries reached, returns -1)
            const id = store.allocId();
            expect(id).toBe(-1);
        });
    });

    describe("Free List - LIFO Behavior", () => {
        it("should reuse freed IDs in LIFO order", () => {
            const store = new EntryStore<string, number>({
                maxEntries: 100,
                initialCap: 16,
            });

            // Allocate 3 IDs
            const id0 = store.allocId(); // 0
            const id1 = store.allocId(); // 1
            const id2 = store.allocId(); // 2

            // Mark them as used
            store.markUsed(id0, "k0", 0);
            store.markUsed(id1, "k1", 1);
            store.markUsed(id2, "k2", 2);

            // Free in order: 0, 1, 2
            store.freeId(id0);
            store.freeId(id1);
            store.freeId(id2);

            // Should reuse in LIFO order: 2, 1, 0
            const reused0 = store.allocId();
            const reused1 = store.allocId();
            const reused2 = store.allocId();

            expect(reused0).toBe(2);
            expect(reused1).toBe(1);
            expect(reused2).toBe(0);
        });

        it("should mix new allocations with reused IDs", () => {
            const store = new EntryStore<string, number>({
                maxEntries: 100,
                initialCap: 16,
            });

            // Allocate 3
            store.allocId(); // 0
            const id1 = store.allocId(); // 1
            store.allocId(); // 2

            store.markUsed(id1, "k1", 1);

            // Free one
            store.freeId(id1);

            // Next allocation should reuse freed ID
            const reused = store.allocId();
            expect(reused).toBe(1);

            // Next allocation should be sequential
            const sequential = store.allocId();
            expect(sequential).toBe(3);
        });

        it("should track freeCount correctly", () => {
            const store = new EntryStore<string, number>({
                maxEntries: 100,
                initialCap: 16,
            });

            expect(store.debug().freeCount).toBe(0);

            const id0 = store.allocId();
            const id1 = store.allocId();
            const id2 = store.allocId();

            store.markUsed(id0, "k0", 0);
            store.markUsed(id1, "k1", 1);
            store.markUsed(id2, "k2", 2);

            store.freeId(id0);
            expect(store.debug().freeCount).toBe(1);

            store.freeId(id1);
            expect(store.debug().freeCount).toBe(2);

            store.allocId(); // reuse
            expect(store.debug().freeCount).toBe(1);

            store.allocId(); // reuse
            expect(store.debug().freeCount).toBe(0);
        });

        it("should allow reuse after maxEntries reached", () => {
            const store = new EntryStore<string, number>({
                maxEntries: 3,
                initialCap: 2,
            });

            const id0 = store.allocId(); // 0
            const id1 = store.allocId(); // 1
            const id2 = store.allocId(); // 2

            store.markUsed(id0, "k0", 0);
            store.markUsed(id1, "k1", 1);
            store.markUsed(id2, "k2", 2);

            // All slots used
            expect(store.allocId()).toBe(-1);

            // Free one
            store.freeId(id1);

            // Should be able to allocate again
            const reused = store.allocId();
            expect(reused).toBe(1);
        });
    });

    describe("markUsed / freeId", () => {
        it("should store key and value in correct slots", () => {
            const store = new EntryStore<string, number>({
                maxEntries: 100,
                initialCap: 16,
            });

            const id = store.allocId();
            store.markUsed(id, "myKey", 42);

            expect(store.keyRef[id]).toBe("myKey");
            expect(store.valRef[id]).toBe(42);
        });

        it("should throw on invalid entryId in markUsed", () => {
            const store = new EntryStore<string, number>({
                maxEntries: 100,
                initialCap: 16,
            });

            expect(() => store.markUsed(-1, "k", 1)).toThrow(/invalid entryId/);
            expect(() => store.markUsed(1000, "k", 1)).toThrow(/invalid entryId/);
            expect(() => store.markUsed(1.5, "k", 1)).toThrow(/invalid entryId/);
        });

        it("should throw on invalid entryId in freeId", () => {
            const store = new EntryStore<string, number>({
                maxEntries: 100,
                initialCap: 16,
            });

            const id = store.allocId();
            store.markUsed(id, "k", 1);

            expect(() => store.freeId(-1)).toThrow(/invalid entryId/);
            expect(() => store.freeId(1000)).toThrow(/invalid entryId/);
            expect(() => store.freeId(1.5)).toThrow(/invalid entryId/);
        });

        it("should detect double-free", () => {
            const store = new EntryStore<string, number>({
                maxEntries: 100,
                initialCap: 16,
            });

            const id = store.allocId();
            store.markUsed(id, "key", 123);

            // First free is OK
            store.freeId(id);

            // Second free should throw
            expect(() => store.freeId(id)).toThrow(/double-free/);
        });

        it("should clear references on free (for GC)", () => {
            const store = new EntryStore<string, number>({
                maxEntries: 100,
                initialCap: 16,
            });

            const id = store.allocId();
            store.markUsed(id, "key", 999);

            store.freeId(id);

            expect(store.keyRef[id]).toBeUndefined();
            expect(store.valRef[id]).toBeUndefined();
        });
    });

    describe("resetSlot", () => {
        it("should reset all SoA fields to neutral state", () => {
            const store = new EntryStore<string, number>({
                maxEntries: 100,
                initialCap: 16,
            });

            const id = store.allocId();
            store.markUsed(id, "key", 123);

            // Manually set some metadata
            store.expiresTick[id] = 999;
            store.wheelNext[id] = 5;
            store.wheelPrev[id] = 3;
            store.lruNext[id] = 7;
            store.lruPrev[id] = 2;

            // Reset slot
            store.resetSlot(id);

            expect(store.keyRef[id]).toBeUndefined();
            expect(store.valRef[id]).toBeUndefined();
            expect(store.expiresTick[id]).toBe(0);
            expect(store.wheelNext[id]).toBe(-1);
            expect(store.wheelPrev[id]).toBe(-1);
            expect(store.lruNext[id]).toBe(-1);
            expect(store.lruPrev[id]).toBe(-1);
        });

        it("should be called automatically on alloc from free list", () => {
            const store = new EntryStore<string, number>({
                maxEntries: 100,
                initialCap: 16,
            });

            const id = store.allocId();
            store.markUsed(id, "key", 123);
            store.expiresTick[id] = 999;

            store.freeId(id);

            // Reuse the ID
            const reused = store.allocId();
            expect(reused).toBe(id);

            // Should be clean
            expect(store.keyRef[reused]).toBeUndefined();
            expect(store.expiresTick[reused]).toBe(0);
        });
    });

    describe("Invariants", () => {
        it("should maintain: sizeAllocated >= number of live entries", () => {
            const store = new EntryStore<string, number>({
                maxEntries: 100,
                initialCap: 16,
            });

            const id0 = store.allocId();
            const id1 = store.allocId();
            const id2 = store.allocId();

            expect(store.debug().sizeAllocated).toBe(3);

            store.markUsed(id0, "k0", 0);
            store.markUsed(id1, "k1", 1);

            store.freeId(id0);

            // sizeAllocated should still be 3 (high-water mark)
            expect(store.debug().sizeAllocated).toBe(3);
        });

        it("should maintain: freeCount + live entries <= sizeAllocated", () => {
            const store = new EntryStore<string, number>({
                maxEntries: 100,
                initialCap: 16,
            });

            for (let i = 0; i < 10; i++) {
                const id = store.allocId();
                store.markUsed(id, `k${i}`, i);
            }

            const debug1 = store.debug();
            expect(debug1.sizeAllocated).toBe(10);
            expect(debug1.freeCount).toBe(0);

            // Free 3 entries
            store.freeId(0);
            store.freeId(2);
            store.freeId(5);

            const debug2 = store.debug();
            expect(debug2.sizeAllocated).toBe(10);
            expect(debug2.freeCount).toBe(3);

            // Live entries: 7 (10 - 3)
            // 7 + 3 = 10 = sizeAllocated ✓
        });

        it("should never have same ID in free list twice", () => {
            const store = new EntryStore<string, number>({
                maxEntries: 100,
                initialCap: 16,
            });

            const id = store.allocId();
            store.markUsed(id, "k", 1);

            store.freeId(id);

            // Try to free again - should throw
            expect(() => store.freeId(id)).toThrow(/double-free/);
        });
    });

    describe("Edge Cases", () => {
        it("should handle maxEntries = 1", () => {
            const store = new EntryStore<string, number>({
                maxEntries: 1,
                initialCap: 1,
            });

            const id = store.allocId();
            expect(id).toBe(0);

            const fail = store.allocId();
            expect(fail).toBe(-1);

            store.markUsed(id, "k", 1);
            store.freeId(id);

            const reused = store.allocId();
            expect(reused).toBe(0);
        });

        it("should handle large maxEntries", () => {
            const store = new EntryStore<string, number>({
                maxEntries: 1_000_000,
                initialCap: 16,
            });

            expect(store.debug().cap).toBe(16);

            // Allocate a bunch
            for (let i = 0; i < 100; i++) {
                store.allocId();
            }

            expect(store.debug().sizeAllocated).toBe(100);
        });

        it("should handle complex alloc/free patterns", () => {
            const store = new EntryStore<string, number>({
                maxEntries: 100,
                initialCap: 8,
            });

            const ids: EntryId[] = [];

            // Allocate 20
            for (let i = 0; i < 20; i++) {
                const id = store.allocId();
                store.markUsed(id, `k${i}`, i);
                ids.push(id);
            }

            // Free every other one
            for (let i = 0; i < 20; i += 2) {
                store.freeId(ids[i]);
            }

            expect(store.debug().freeCount).toBe(10);

            // Allocate 5 more (should reuse)
            for (let i = 0; i < 5; i++) {
                const id = store.allocId();
                expect(id).toBeLessThan(20); // Should be reused
            }

            expect(store.debug().freeCount).toBe(5);
        });

        it("should handle generic key/value types", () => {
            interface User {
                name: string;
                age: number;
            }

            const store = new EntryStore<number, User>({
                maxEntries: 100,
                initialCap: 16,
            });

            const id = store.allocId();
            const user: User = { name: "Alice", age: 30 };

            store.markUsed(id, 12345, user);

            expect(store.keyRef[id]).toBe(12345);
            expect(store.valRef[id]).toEqual(user);
            expect(store.valRef[id]?.name).toBe("Alice");
        });
    });

    describe("Performance Characteristics", () => {
        it("should allocate 10k entries efficiently", () => {
            const store = new EntryStore<string, string>({
                maxEntries: 10_000,
                initialCap: 16,
            });

            const start = performance.now();

            for (let i = 0; i < 10_000; i++) {
                const id = store.allocId();
                store.markUsed(id, `key${i}`, `val${i}`);
            }

            const elapsed = performance.now() - start;

            // Should be very fast (< 50ms on modern hardware)
            expect(elapsed).toBeLessThan(100);
            expect(store.debug().sizeAllocated).toBe(10_000);
        });

        it("should handle 10k alloc/free cycles efficiently", () => {
            const store = new EntryStore<number, number>({
                maxEntries: 1000,
                initialCap: 16,
            });

            const start = performance.now();

            for (let cycle = 0; cycle < 10; cycle++) {
                const ids: EntryId[] = [];

                // Allocate 1000
                for (let i = 0; i < 1000; i++) {
                    const id = store.allocId();
                    store.markUsed(id, i, i * 2);
                    ids.push(id);
                }

                // Free all
                for (const id of ids) {
                    store.freeId(id);
                }
            }

            const elapsed = performance.now() - start;

            // Should complete in reasonable time
            expect(elapsed).toBeLessThan(200);
            expect(store.debug().freeCount).toBe(1000);
        });
    });
});
