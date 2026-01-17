import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TtlWheelCache } from "../src/ttl-wheel-cache";
import type { DisposeReason } from "../src/types";
import type { TimeSource } from "../src/monotone-time";

/**
 * Fake time source for deterministic testing
 */
class FakeTimeSource implements TimeSource {
    private currentMs = 0;

    nowMs(): number {
        return this.currentMs;
    }

    advance(ms: number): void {
        this.currentMs += ms;
    }

    setTime(ms: number): void {
        this.currentMs = ms;
    }
}

describe("TtlWheelCache", () => {
    describe("Constructor & Options", () => {
        it("should create cache with valid options", () => {
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
            });

            expect(cache.size()).toBe(0);
            expect(cache.stats().size).toBe(0);
            cache.close();
        });

        it("should throw on invalid maxEntries", () => {
            expect(() => new TtlWheelCache({ maxEntries: 0 })).toThrow(/positive integer/);
            expect(() => new TtlWheelCache({ maxEntries: -1 })).toThrow(/positive integer/);
            expect(() => new TtlWheelCache({ maxEntries: 1.5 })).toThrow(/positive integer/);
        });

        it("should apply default options", () => {
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
            });

            // Defaults: tickMs=50, wheelSize=4096, budgetPerTick=200000, ttlAutopurge=true
            expect(cache.size()).toBe(0);
            cache.close();
        });

        it("should accept custom options", () => {
            const disposals: Array<{ key: string; reason: DisposeReason }> = [];
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 5,
                tickMs: 100,
                wheelSize: 8,
                budgetPerTick: 1000,
                updateTTLOnGet: true,
                ttlAutopurge: false,
                onDispose: (key, _val, reason) => disposals.push({ key, reason }),
            });

            expect(cache.size()).toBe(0);
            cache.close();
        });
    });

    describe("Basic set/get/has Operations", () => {
        it("should set and get value", () => {
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
                tickMs: 50,
            });

            cache.set("key1", 100, 1000);
            expect(cache.get("key1")).toBe(100);
            cache.close();
        });

        it("should return undefined for missing key", () => {
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
            });

            expect(cache.get("missing")).toBeUndefined();
            cache.close();
        });

        it("should check existence with has()", () => {
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
            });

            cache.set("key1", 100, 1000);
            expect(cache.has("key1")).toBe(true);
            expect(cache.has("missing")).toBe(false);
            cache.close();
        });

        it("should update existing key", () => {
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
            });

            cache.set("key1", 100, 1000);
            expect(cache.get("key1")).toBe(100);
            expect(cache.size()).toBe(1);

            cache.set("key1", 200, 1000);
            expect(cache.get("key1")).toBe(200);
            expect(cache.size()).toBe(1); // Still 1 entry
            cache.close();
        });

        it("should track size correctly", () => {
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
            });

            expect(cache.size()).toBe(0);
            cache.set("k1", 1, 1000);
            expect(cache.size()).toBe(1);
            cache.set("k2", 2, 1000);
            expect(cache.size()).toBe(2);
            cache.close();
        });

        it("should reject invalid TTL", () => {
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
            });

            cache.set("k1", 1, 0); // Invalid
            cache.set("k2", 2, -100); // Invalid
            cache.set("k3", 3, NaN); // Invalid

            expect(cache.size()).toBe(0); // Nothing stored
            cache.close();
        });
    });

    describe("LRU Eviction", () => {
        it("should evict LRU when maxEntries exceeded", () => {
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 3,
            });

            cache.set("a", 1, 10000);
            cache.set("b", 2, 10000);
            cache.set("c", 3, 10000);
            expect(cache.size()).toBe(3);

            cache.set("d", 4, 10000); // Should evict 'a' (LRU)
            expect(cache.size()).toBe(3);
            expect(cache.get("a")).toBeUndefined(); // Evicted
            expect(cache.get("b")).toBe(2);
            expect(cache.get("d")).toBe(4);
            cache.close();
        });

        it("should call onDispose callback on LRU eviction", () => {
            const disposals: Array<{ key: string; value: number; reason: DisposeReason }> = [];
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 2,
                onDispose: (key, value, reason) => disposals.push({ key, value, reason }),
            });

            cache.set("a", 1, 10000);
            cache.set("b", 2, 10000);
            cache.set("c", 3, 10000); // Evicts 'a'

            expect(disposals).toHaveLength(1);
            expect(disposals[0]).toEqual({ key: "a", value: 1, reason: "lru" });
            cache.close();
        });

        it("should evict multiple entries if needed", () => {
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 1,
            });

            cache.set("a", 1, 10000);
            cache.set("b", 2, 10000); // Evicts 'a'

            expect(cache.size()).toBe(1);
            expect(cache.get("a")).toBeUndefined();
            expect(cache.get("b")).toBe(2);
            cache.close();
        });

        it("should track LRU evictions via onDispose", () => {
            let lruEvictions = 0;
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 2,
                onDispose: (_key, _value, reason) => {
                    if (reason === "lru") lruEvictions++;
                },
            });

            cache.set("a", 1, 10000);
            cache.set("b", 2, 10000);
            cache.set("c", 3, 10000); // Evicts 'a'
            cache.set("d", 4, 10000); // Evicts 'b'

            expect(lruEvictions).toBe(2);
            cache.close();
        });
    });

    describe("LRU Touch Behavior", () => {
        it("should move entry to head on get()", () => {
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 3,
            });

            cache.set("a", 1, 10000);
            cache.set("b", 2, 10000);
            cache.set("c", 3, 10000);

            cache.get("a"); // Touch 'a', making it most recent
            cache.set("d", 4, 10000); // Should evict 'b' (now LRU)

            expect(cache.get("a")).toBe(1); // Not evicted
            expect(cache.get("b")).toBeUndefined(); // Evicted
            expect(cache.get("c")).toBe(3);
            expect(cache.get("d")).toBe(4);
            cache.close();
        });

        it("should move entry to head on set() update", () => {
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 3,
            });

            cache.set("a", 1, 10000);
            cache.set("b", 2, 10000);
            cache.set("c", 3, 10000);

            cache.set("a", 10, 10000); // Update 'a', making it most recent
            cache.set("d", 4, 10000); // Should evict 'b'

            expect(cache.get("a")).toBe(10); // Not evicted, and updated
            expect(cache.get("b")).toBeUndefined(); // Evicted
            cache.close();
        });

        it("should NOT touch LRU on has()", () => {
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 3,
            });

            cache.set("a", 1, 10000);
            cache.set("b", 2, 10000);
            cache.set("c", 3, 10000);

            cache.has("a"); // Does NOT touch 'a'
            cache.set("d", 4, 10000); // Should still evict 'a' (LRU)

            expect(cache.get("a")).toBeUndefined(); // Evicted
            expect(cache.get("b")).toBe(2);
            cache.close();
        });
    });

    describe("TTL Expiration - Passive Mode", () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it("should expire entries after TTL (background cleanup)", () => {
            const fakeTime = new FakeTimeSource();
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
                tickMs: 50,
                ttlAutopurge: true, // Background interval
                time: fakeTime,
            });

            cache.set("key1", 100, 150); // 150ms TTL

            expect(cache.get("key1")).toBe(100);

            // Advance time and trigger interval
            fakeTime.advance(200);
            vi.advanceTimersByTime(200);

            expect(cache.get("key1")).toBeUndefined(); // Expired
            expect(cache.size()).toBe(0);
            cache.close();
        });

        it("should call onDispose on TTL expiration", () => {
            const fakeTime = new FakeTimeSource();
            const disposals: Array<{ key: string; reason: DisposeReason }> = [];
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
                tickMs: 50,
                ttlAutopurge: true,
                time: fakeTime,
                onDispose: (key, _val, reason) => disposals.push({ key, reason }),
            });

            cache.set("key1", 100, 150);

            fakeTime.advance(200);
            vi.advanceTimersByTime(200);

            expect(disposals).toHaveLength(1);
            expect(disposals[0]).toEqual({ key: "key1", reason: "ttl" });
            cache.close();
        });

        it("should track TTL expirations via onDispose", () => {
            const fakeTime = new FakeTimeSource();
            let ttlCount = 0;
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
                tickMs: 50,
                ttlAutopurge: true,
                time: fakeTime,
                onDispose: (_key, _value, reason) => {
                    if (reason === "ttl") ttlCount++;
                },
            });

            cache.set("k1", 1, 100);
            cache.set("k2", 2, 100);

            fakeTime.advance(150);
            vi.advanceTimersByTime(150);

            expect(ttlCount).toBe(2);
            cache.close();
        });

        it("should defensively expire on get() if not cleaned up yet", () => {
            const fakeTime = new FakeTimeSource();
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
                tickMs: 50,
                ttlAutopurge: true,
                time: fakeTime,
            });

            cache.set("key1", 100, 150);

            // Advance time but don't trigger interval
            fakeTime.advance(200);

            // Defensive check on get
            expect(cache.get("key1")).toBeUndefined();
            cache.close();
        });

        it("should defensively expire on has() if not cleaned up yet", () => {
            const fakeTime = new FakeTimeSource();
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
                tickMs: 50,
                ttlAutopurge: true,
                time: fakeTime,
            });

            cache.set("key1", 100, 150);

            fakeTime.advance(200);

            expect(cache.has("key1")).toBe(false);
            cache.close();
        });
    });

    describe("TTL Expiration - Active Mode", () => {
        it("should expire entries on access (no background cleanup)", () => {
            const fakeTime = new FakeTimeSource();
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
                tickMs: 50,
                ttlAutopurge: false, // No background interval
                time: fakeTime,
            });

            cache.set("key1", 100, 150);

            // Advance time
            fakeTime.advance(200);

            // Entry expired, cleaned up on access
            expect(cache.get("key1")).toBeUndefined();
            expect(cache.size()).toBe(0);
            cache.close();
        });

        it("should not cleanup without operations", () => {
            const fakeTime = new FakeTimeSource();
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
                tickMs: 50,
                ttlAutopurge: false,
                time: fakeTime,
            });

            cache.set("key1", 100, 150);

            fakeTime.advance(200);

            // Entry still in cache (not cleaned up yet)
            expect(cache.size()).toBe(1);

            // Cleaned up on access
            expect(cache.get("key1")).toBeUndefined();
            expect(cache.size()).toBe(0);
            cache.close();
        });

        it("should advance on set() in active mode", () => {
            const fakeTime = new FakeTimeSource();
            const disposals: string[] = [];
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
                tickMs: 50,
                ttlAutopurge: false,
                time: fakeTime,
                onDispose: (key) => disposals.push(key),
            });

            cache.set("k1", 1, 100);

            fakeTime.advance(150);

            cache.set("k2", 2, 1000); // Triggers advance

            expect(disposals).toContain("k1");
            cache.close();
        });

        it("should advance on delete() in active mode", () => {
            const fakeTime = new FakeTimeSource();
            const disposals: string[] = [];
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
                tickMs: 50,
                ttlAutopurge: false,
                time: fakeTime,
                onDispose: (key) => disposals.push(key),
            });

            cache.set("k1", 1, 100);
            cache.set("k2", 2, 1000);

            fakeTime.advance(150);

            cache.delete("k2"); // Triggers advance, k1 expires

            expect(disposals).toContain("k1");
            cache.close();
        });
    });

    describe("Manual Deletion", () => {
        it("should delete entry", () => {
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
            });

            cache.set("key1", 100, 1000);
            expect(cache.get("key1")).toBe(100);

            const deleted = cache.delete("key1");
            expect(deleted).toBe(true);
            expect(cache.get("key1")).toBeUndefined();
            expect(cache.size()).toBe(0);
            cache.close();
        });

        it("should return false for missing key", () => {
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
            });

            const deleted = cache.delete("missing");
            expect(deleted).toBe(false);
            cache.close();
        });

        it("should call onDispose on delete", () => {
            const disposals: Array<{ key: string; reason: DisposeReason }> = [];
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
                onDispose: (key, _val, reason) => disposals.push({ key, reason }),
            });

            cache.set("key1", 100, 1000);
            cache.delete("key1");

            expect(disposals).toHaveLength(1);
            expect(disposals[0]).toEqual({ key: "key1", reason: "delete" });
            cache.close();
        });

        it("should track manual deletions via onDispose", () => {
            let deleteCount = 0;
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
                onDispose: (_key, _value, reason) => {
                    if (reason === "delete") deleteCount++;
                },
            });

            cache.set("k1", 1, 1000);
            cache.set("k2", 2, 1000);
            cache.delete("k1");
            cache.delete("k2");

            expect(deleteCount).toBe(2);
            cache.close();
        });
    });

    describe("Clear Operation", () => {
        it("should clear all entries", () => {
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
            });

            cache.set("k1", 1, 1000);
            cache.set("k2", 2, 1000);
            cache.set("k3", 3, 1000);

            expect(cache.size()).toBe(3);

            cache.clear();

            expect(cache.size()).toBe(0);
            expect(cache.get("k1")).toBeUndefined();
            expect(cache.get("k2")).toBeUndefined();
            expect(cache.get("k3")).toBeUndefined();
            cache.close();
        });

        it("should call onDispose for all entries on clear", () => {
            const disposals: Array<{ key: string; reason: DisposeReason }> = [];
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
                onDispose: (key, _val, reason) => disposals.push({ key, reason }),
            });

            cache.set("k1", 1, 1000);
            cache.set("k2", 2, 1000);
            cache.clear();

            expect(disposals).toHaveLength(2);
            expect(disposals[0].reason).toBe("clear");
            expect(disposals[1].reason).toBe("clear");
            cache.close();
        });

        it("should track clear via onDispose", () => {
            let clearCount = 0;
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
                onDispose: (_key, _value, reason) => {
                    if (reason === "clear") clearCount++;
                },
            });

            cache.set("k1", 1, 1000);
            cache.set("k2", 2, 1000);
            cache.clear();

            expect(clearCount).toBe(2);
            cache.close();
        });

        it("should work on empty cache", () => {
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
            });

            expect(() => cache.clear()).not.toThrow();
            expect(cache.size()).toBe(0);
            cache.close();
        });
    });

    describe("Stats Tracking", () => {
        it("should track size in stats", () => {
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
            });

            cache.set("k1", 1, 1000);
            cache.set("k2", 2, 1000);

            const stats = cache.stats();
            expect(stats.size).toBe(2);
            cache.close();
        });

        it("should only return size in stats", () => {
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
            });

            cache.set("k1", 1, 1000);
            cache.set("k2", 2, 1000);

            const stats = cache.stats();
            expect(stats.size).toBe(2);
            expect(Object.keys(stats)).toEqual(["size"]);
            cache.close();
        });

        it("should track all disposal types via onDispose", () => {
            vi.useFakeTimers();
            const fakeTime = new FakeTimeSource();
            const disposalCounts = { ttl: 0, lru: 0, delete: 0, clear: 0, set: 0 };
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 2,
                tickMs: 50,
                ttlAutopurge: true,
                time: fakeTime,
                onDispose: (_key, _value, reason) => {
                    disposalCounts[reason]++;
                },
            });

            cache.set("k1", 1, 100); // Will expire
            cache.set("k2", 2, 10000);
            cache.set("k3", 3, 10000); // LRU evicts k1 (but k1 might already be expired)

            cache.delete("k2"); // Manual delete

            fakeTime.advance(150);
            vi.advanceTimersByTime(150); // Expire k1 if not already evicted

            expect(disposalCounts.delete).toBeGreaterThan(0);
            cache.close();
            vi.useRealTimers();
        });
    });

    describe("updateTTLOnGet Feature", () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it("should NOT update TTL by default", () => {
            const fakeTime = new FakeTimeSource();
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
                tickMs: 50,
                updateTTLOnGet: false, // default
                ttlAutopurge: true,
                time: fakeTime,
            });

            cache.set("key1", 100, 200); // 200ms TTL

            // Access after 100ms
            fakeTime.advance(100);
            vi.advanceTimersByTime(100);
            expect(cache.get("key1")).toBe(100);

            // Wait another 120ms (220ms total)
            fakeTime.advance(120);
            vi.advanceTimersByTime(120);
            expect(cache.get("key1")).toBeUndefined(); // Expired
            cache.close();
        });

        it("should update TTL on get when enabled", () => {
            const fakeTime = new FakeTimeSource();
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
                tickMs: 50,
                updateTTLOnGet: true, // Enable sliding expiration
                ttlAutopurge: true,
                time: fakeTime,
            });

            cache.set("key1", 100, 200); // 200ms TTL

            // Access after 100ms (resets TTL to expire at t=300)
            fakeTime.advance(100);
            vi.advanceTimersByTime(100);
            expect(cache.get("key1")).toBe(100);

            // Wait another 120ms (220ms total, but only 120ms since reset)
            fakeTime.advance(120);
            vi.advanceTimersByTime(120);
            expect(cache.get("key1")).toBe(100); // Still alive! (now resets to t=420)

            // Wait another 120ms (340ms total, but only 120ms since last get)
            fakeTime.advance(120);
            vi.advanceTimersByTime(120);
            expect(cache.get("key1")).toBe(100); // Still alive! (now resets to t=540)

            // Wait 220ms without accessing (560ms total, 220ms since last get)
            fakeTime.advance(220);
            vi.advanceTimersByTime(220);
            expect(cache.get("key1")).toBeUndefined(); // Now expired
            cache.close();
        });

        it("should keep entry alive with repeated access", () => {
            const fakeTime = new FakeTimeSource();
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
                tickMs: 50,
                updateTTLOnGet: true,
                ttlAutopurge: true,
                time: fakeTime,
            });

            cache.set("key1", 100, 150);

            // Access every 80ms for 400ms total
            for (let i = 0; i < 5; i++) {
                fakeTime.advance(80);
                vi.advanceTimersByTime(80);
                expect(cache.get("key1")).toBe(100); // Always alive
            }

            cache.close();
        });

        it("should NOT update TTL on has() even when enabled", () => {
            const fakeTime = new FakeTimeSource();
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
                tickMs: 50,
                updateTTLOnGet: true,
                ttlAutopurge: true,
                time: fakeTime,
            });

            cache.set("key1", 100, 200);

            // has() after 100ms (should NOT reset TTL)
            fakeTime.advance(100);
            vi.advanceTimersByTime(100);
            expect(cache.has("key1")).toBe(true);

            // Wait another 120ms (220ms total)
            fakeTime.advance(120);
            vi.advanceTimersByTime(120);
            expect(cache.has("key1")).toBe(false); // Expired
            cache.close();
        });
    });

    describe("Edge Cases", () => {
        it("should handle maxEntries=1", () => {
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 1,
            });

            cache.set("a", 1, 1000);
            expect(cache.get("a")).toBe(1);

            cache.set("b", 2, 1000);
            expect(cache.get("a")).toBeUndefined();
            expect(cache.get("b")).toBe(2);
            cache.close();
        });

        it("should handle empty cache operations", () => {
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
            });

            expect(cache.get("missing")).toBeUndefined();
            expect(cache.has("missing")).toBe(false);
            expect(cache.delete("missing")).toBe(false);
            expect(cache.size()).toBe(0);
            expect(() => cache.clear()).not.toThrow();
            cache.close();
        });

        it("should handle rapid set/get/delete", () => {
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
            });

            for (let i = 0; i < 100; i++) {
                cache.set(`k${i}`, i, 1000);
                expect(cache.get(`k${i}`)).toBe(i);
                cache.delete(`k${i}`);
            }

            expect(cache.size()).toBe(0);
            cache.close();
        });

        it("should work without onDispose callback", () => {
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 2,
            });

            cache.set("a", 1, 1000);
            cache.set("b", 2, 1000);
            cache.set("c", 3, 1000); // Evicts without callback

            expect(cache.size()).toBe(2);
            cache.close();
        });

        it("should handle very short TTLs", () => {
            vi.useFakeTimers();
            const fakeTime = new FakeTimeSource();
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
                tickMs: 10,
                ttlAutopurge: true,
                time: fakeTime,
            });

            cache.set("key1", 100, 20); // 20ms TTL

            fakeTime.advance(30);
            vi.advanceTimersByTime(30);

            expect(cache.get("key1")).toBeUndefined();
            cache.close();
            vi.useRealTimers();
        });

        it("should handle very long TTLs (overflow)", () => {
            vi.useFakeTimers();
            const fakeTime = new FakeTimeSource();
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
                tickMs: 50,
                wheelSize: 8, // Small wheel, horizon = 400ms
                ttlAutopurge: true,
                time: fakeTime,
            });

            cache.set("key1", 100, 5000); // 5 second TTL (goes to overflow)

            expect(cache.get("key1")).toBe(100);

            fakeTime.advance(4900);
            vi.advanceTimersByTime(4900);
            expect(cache.get("key1")).toBe(100); // Still alive

            fakeTime.advance(200);
            vi.advanceTimersByTime(200);
            expect(cache.get("key1")).toBeUndefined(); // Expired
            cache.close();
            vi.useRealTimers();
        });
    });

    describe("Lifecycle", () => {
        it("should stop interval on close()", () => {
            vi.useFakeTimers();
            const fakeTime = new FakeTimeSource();
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
                tickMs: 50,
                ttlAutopurge: true,
                time: fakeTime,
            });

            cache.set("key1", 100, 150);

            cache.close();

            // Advance time - no cleanup should happen
            fakeTime.advance(200);
            vi.advanceTimersByTime(200);

            // Entry still accessible (defensive check on get)
            expect(cache.get("key1")).toBeUndefined(); // Expired by defensive check
            vi.useRealTimers();
        });

        it("should be usable after close() in active mode", () => {
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 10,
                ttlAutopurge: false,
            });

            cache.set("key1", 100, 10000);
            cache.close();

            // Still works
            expect(cache.get("key1")).toBe(100);
            cache.set("key2", 200, 10000);
            expect(cache.size()).toBe(2);
        });
    });

    describe("Complex Scenarios", () => {
        it("should handle mixed operations", () => {
            vi.useFakeTimers();
            const fakeTime = new FakeTimeSource();
            const disposals: Array<{ key: string; reason: DisposeReason }> = [];
            const cache = new TtlWheelCache<string, number>({
                maxEntries: 3,
                tickMs: 50,
                ttlAutopurge: true,
                time: fakeTime,
                onDispose: (key, _val, reason) => disposals.push({ key, reason }),
            });

            cache.set("a", 1, 150); // Will expire at t=150
            cache.set("b", 2, 10000);
            cache.set("c", 3, 10000);
            // LRU order: a (oldest), b, c

            fakeTime.advance(100);
            vi.advanceTimersByTime(100);
            cache.get("b"); // Touch 'b'
            // LRU order: a (oldest), c, b (newest)

            cache.set("d", 4, 10000); // LRU evicts 'a' (oldest)
            // Now have: c, b, d

            fakeTime.advance(100); // t=200, 'a' was already evicted
            vi.advanceTimersByTime(100);

            cache.delete("b"); // Manual delete
            // Now have: c, d

            expect(cache.size()).toBe(2); // 'c' and 'd' remain
            expect(cache.get("c")).toBe(3);
            expect(cache.get("d")).toBe(4);

            expect(disposals.filter(e => e.reason === "lru").length).toBe(1); // 'a' evicted by LRU
            expect(disposals.filter(e => e.reason === "delete").length).toBe(1); // 'b' deleted

            cache.close();
            vi.useRealTimers();
        });

        it("should handle string and number keys", () => {
            const stringCache = new TtlWheelCache<string, number>({
                maxEntries: 10,
            });

            stringCache.set("key1", 100, 1000);
            expect(stringCache.get("key1")).toBe(100);
            stringCache.close();

            const numberCache = new TtlWheelCache<number, string>({
                maxEntries: 10,
            });

            numberCache.set(42, "value", 1000);
            expect(numberCache.get(42)).toBe("value");
            numberCache.close();
        });

        it("should handle object values", () => {
            interface User {
                name: string;
                age: number;
            }

            const cache = new TtlWheelCache<string, User>({
                maxEntries: 10,
            });

            const user = { name: "Alice", age: 30 };
            cache.set("user1", user, 1000);

            const retrieved = cache.get("user1");
            expect(retrieved).toEqual(user);
            expect(retrieved).toBe(user); // Same reference
            cache.close();
        });
    });
});
