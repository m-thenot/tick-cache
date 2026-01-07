import { describe, it, expect } from "vitest";
import { TimerWheel } from "../src/timer-wheel";
import { EntryStore } from "../src/entry-store";
import { MonotoneTicker, type TimeSource } from "../src/monotone-time";
import { BUCKET_NONE, BUCKET_OVERFLOW, NIL } from "../src/constants";


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

describe("TimerWheel", () => {
    describe("Construction", () => {
        it("should create with valid options", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const ticker = new MonotoneTicker({ tickMs: 50 });
            const wheel = new TimerWheel({
                store,
                ticker,
                wheelSize: 64,
                budgetPerTick: 1000,
            });

            const stats = wheel.stats();
            expect(stats.horizonTicks).toBe(64);
            expect(stats.overflowCountApprox).toBe(0);
        });

        it("should throw if wheelSize is not power of 2", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const ticker = new MonotoneTicker({ tickMs: 50 });

            expect(() =>
                new TimerWheel({
                    store,
                    ticker,
                    wheelSize: 100, // not power of 2
                    budgetPerTick: 1000,
                })
            ).toThrow(/power of two/);
        });

        it("should throw if wheelSize < 2", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const ticker = new MonotoneTicker({ tickMs: 50 });

            expect(() =>
                new TimerWheel({
                    store,
                    ticker,
                    wheelSize: 1,
                    budgetPerTick: 1000,
                })
            ).toThrow(/power of two/);
        });

        it("should throw if budgetPerTick is not positive integer", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const ticker = new MonotoneTicker({ tickMs: 50 });

            expect(() =>
                new TimerWheel({
                    store,
                    ticker,
                    wheelSize: 64,
                    budgetPerTick: 0,
                })
            ).toThrow(/positive integer/);

            expect(() =>
                new TimerWheel({
                    store,
                    ticker,
                    wheelSize: 64,
                    budgetPerTick: -100,
                })
            ).toThrow(/positive integer/);
        });

        it("should use initialNowTick if provided", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const ticker = new MonotoneTicker({ tickMs: 50 });
            const wheel = new TimerWheel({
                store,
                ticker,
                wheelSize: 64,
                budgetPerTick: 1000,
                initialNowTick: 100,
            });

            expect(wheel.stats().nowTick).toBe(100);
        });
    });

    describe("Schedule and Unlink", () => {
        it("should schedule entry in correct bucket", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const fakeTime = new FakeTimeSource();
            const ticker = new MonotoneTicker({ tickMs: 50, time: fakeTime });
            const wheel = new TimerWheel({
                store,
                ticker,
                wheelSize: 8,
                budgetPerTick: 1000,
                initialNowTick: 0,
            });

            const id = store.allocId();
            store.setEntry(id, "key1", 100);

            // Schedule to expire at tick 3
            wheel.schedule(id, 3);

            // Check bucket assignment
            const bucket = 3 & 7; // 3 % 8 = 3
            expect(store.wheelBucket[id]).toBe(bucket);
            expect(store.expiresTick[id]).toBe(3);

            // Check linked into bucket
            expect(store.wheelPrev[id]).toBe(NIL);
        });

        it("should unlink entry from bucket", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const ticker = new MonotoneTicker({ tickMs: 50 });
            const wheel = new TimerWheel({
                store,
                ticker,
                wheelSize: 8,
                budgetPerTick: 1000,
                initialNowTick: 0,
            });

            const id = store.allocId();
            store.setEntry(id, "key1", 100);

            wheel.schedule(id, 3);
            expect(store.wheelBucket[id]).toBe(3);

            wheel.unlink(id);
            expect(store.wheelBucket[id]).toBe(BUCKET_NONE); // BUCKET_NONE = -1
            expect(store.wheelNext[id]).toBe(NIL);
            expect(store.wheelPrev[id]).toBe(NIL);
        });

        it("should reschedule entry to different bucket", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const ticker = new MonotoneTicker({ tickMs: 50 });
            const wheel = new TimerWheel({
                store,
                ticker,
                wheelSize: 8,
                budgetPerTick: 1000,
                initialNowTick: 0,
            });

            const id = store.allocId();
            store.setEntry(id, "key1", 100);

            // Schedule to tick 3
            wheel.schedule(id, 3);
            expect(store.wheelBucket[id]).toBe(3);

            // Reschedule to tick 5
            wheel.schedule(id, 5);
            expect(store.wheelBucket[id]).toBe(5);
            expect(store.expiresTick[id]).toBe(5);
        });

        it("should handle multiple entries in same bucket", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const ticker = new MonotoneTicker({ tickMs: 50 });
            const wheel = new TimerWheel({
                store,
                ticker,
                wheelSize: 8,
                budgetPerTick: 1000,
                initialNowTick: 0,
            });

            const id1 = store.allocId();
            const id2 = store.allocId();
            const id3 = store.allocId();

            store.setEntry(id1, "k1", 1);
            store.setEntry(id2, "k2", 2);
            store.setEntry(id3, "k3", 3);

            // All expire at tick 3 (same bucket)
            wheel.schedule(id1, 3);
            wheel.schedule(id2, 3);
            wheel.schedule(id3, 3);

            // Check all in bucket 3
            expect(store.wheelBucket[id1]).toBe(3);
            expect(store.wheelBucket[id2]).toBe(3);
            expect(store.wheelBucket[id3]).toBe(3);

            // Verify doubly-linked (id3 is most recent, so it's the head)
            expect(store.wheelPrev[id3]).toBe(NIL);
            expect(store.wheelNext[id3]).toBe(id2);
            expect(store.wheelPrev[id2]).toBe(id3);
            expect(store.wheelNext[id2]).toBe(id1);
            expect(store.wheelPrev[id1]).toBe(id2);
            expect(store.wheelNext[id1]).toBe(NIL);
        });
    });

    describe("Overflow Handling", () => {
        it("should put entry in overflow when beyond horizon", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const ticker = new MonotoneTicker({ tickMs: 50 });
            const wheel = new TimerWheel({
                store,
                ticker,
                wheelSize: 8, // horizon = 8 ticks
                budgetPerTick: 1000,
                initialNowTick: 0,
            });

            const id = store.allocId();
            store.setEntry(id, "key1", 100);

            // Schedule beyond horizon (tick 20, horizon = 8)
            wheel.schedule(id, 20);

            expect(store.wheelBucket[id]).toBe(BUCKET_OVERFLOW); // BUCKET_OVERFLOW = -2
            expect(wheel.stats().overflowCountApprox).toBe(1);
        });

        it("should unlink from overflow", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const ticker = new MonotoneTicker({ tickMs: 50 });
            const wheel = new TimerWheel({
                store,
                ticker,
                wheelSize: 8,
                budgetPerTick: 1000,
                initialNowTick: 0,
            });

            const id = store.allocId();
            store.setEntry(id, "key1", 100);

            wheel.schedule(id, 20); // overflow
            expect(store.wheelBucket[id]).toBe(BUCKET_OVERFLOW);

            wheel.unlink(id);
            expect(store.wheelBucket[id]).toBe(BUCKET_NONE);
            expect(wheel.stats().overflowCountApprox).toBe(0);
        });

        it("should drain overflow entries within horizon during advance", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const fakeTime = new FakeTimeSource();
            const ticker = new MonotoneTicker({ tickMs: 50, time: fakeTime });
            const wheel = new TimerWheel({
                store,
                ticker,
                wheelSize: 8,
                budgetPerTick: 1000,
                initialNowTick: 0,
            });

            const id = store.allocId();
            store.setEntry(id, "key1", 100);

            // Schedule at tick 20 (overflow)
            wheel.schedule(id, 20);
            expect(store.wheelBucket[id]).toBe(BUCKET_OVERFLOW);

            // Advance time to tick 15 (within horizon of tick 20)
            fakeTime.setTime(15 * 50); // 750ms
            const expired: number[] = [];
            wheel.advanceToNow((id) => expired.push(id));

            // Should be moved to wheel
            expect(store.wheelBucket[id]).not.toBe(BUCKET_OVERFLOW);
            expect(store.wheelBucket[id]).toBe(20 & 7); // bucket 4
            expect(expired.length).toBe(0); // not yet expired
        });

        it("should expire overflow entry if already due when drained", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const fakeTime = new FakeTimeSource();
            const ticker = new MonotoneTicker({ tickMs: 50, time: fakeTime });
            const wheel = new TimerWheel({
                store,
                ticker,
                wheelSize: 8,
                budgetPerTick: 1000,
                initialNowTick: 0,
            });

            const id = store.allocId();
            store.setEntry(id, "key1", 100);

            // Schedule at tick 10 (overflow)
            wheel.schedule(id, 10);
            expect(store.wheelBucket[id]).toBe(BUCKET_OVERFLOW);

            // Advance time past expiration
            fakeTime.setTime(12 * 50); // tick 12
            const expired: number[] = [];
            wheel.advanceToNow((id) => expired.push(id));

            // Should be expired immediately during drain
            expect(expired).toContain(id);
            expect(store.wheelBucket[id]).toBe(BUCKET_NONE);
        });
    });

    describe("Time Advancement and Expiration", () => {
        it("should expire entry when tick reaches expiration", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const fakeTime = new FakeTimeSource();
            const ticker = new MonotoneTicker({ tickMs: 50, time: fakeTime });
            const wheel = new TimerWheel({
                store,
                ticker,
                wheelSize: 8,
                budgetPerTick: 1000,
                initialNowTick: 0,
            });

            const id = store.allocId();
            store.setEntry(id, "key1", 100);

            // Schedule to expire at tick 3
            wheel.schedule(id, 3);

            // Advance to tick 2 (not yet expired)
            fakeTime.setTime(2 * 50);
            let expired: number[] = [];
            wheel.advanceToNow((id) => expired.push(id));
            expect(expired.length).toBe(0);

            // Advance to tick 3 (expired)
            fakeTime.setTime(3 * 50);
            expired = [];
            wheel.advanceToNow((id) => expired.push(id));
            expect(expired).toContain(id);
            expect(wheel.stats().nowTick).toBe(3);
        });

        it("should process multiple entries in same tick", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const fakeTime = new FakeTimeSource();
            const ticker = new MonotoneTicker({ tickMs: 50, time: fakeTime });
            const wheel = new TimerWheel({
                store,
                ticker,
                wheelSize: 8,
                budgetPerTick: 1000,
                initialNowTick: 0,
            });

            const id1 = store.allocId();
            const id2 = store.allocId();
            const id3 = store.allocId();

            store.setEntry(id1, "k1", 1);
            store.setEntry(id2, "k2", 2);
            store.setEntry(id3, "k3", 3);

            // All expire at tick 5
            wheel.schedule(id1, 5);
            wheel.schedule(id2, 5);
            wheel.schedule(id3, 5);

            // Advance to tick 5
            fakeTime.setTime(5 * 50);
            const expired: number[] = [];
            wheel.advanceToNow((id) => expired.push(id));

            expect(expired.length).toBe(3);
            expect(expired).toContain(id1);
            expect(expired).toContain(id2);
            expect(expired).toContain(id3);
        });

        it("should handle large time jump (coalescing)", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const fakeTime = new FakeTimeSource();
            const ticker = new MonotoneTicker({ tickMs: 50, time: fakeTime });
            const wheel = new TimerWheel({
                store,
                ticker,
                wheelSize: 8,
                budgetPerTick: 1000,
                initialNowTick: 0,
            });

            const id1 = store.allocId();
            const id2 = store.allocId();

            store.setEntry(id1, "k1", 1);
            store.setEntry(id2, "k2", 2);

            wheel.schedule(id1, 3);
            wheel.schedule(id2, 6);

            // Jump from tick 0 to tick 10
            fakeTime.setTime(10 * 50);
            const expired: number[] = [];
            wheel.advanceToNow((id) => expired.push(id));

            // Both should expire
            expect(expired).toContain(id1);
            expect(expired).toContain(id2);
            expect(wheel.stats().nowTick).toBe(10);
        });

        it("should return true when fully caught up", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const fakeTime = new FakeTimeSource();
            const ticker = new MonotoneTicker({ tickMs: 50, time: fakeTime });
            const wheel = new TimerWheel({
                store,
                ticker,
                wheelSize: 8,
                budgetPerTick: 1000,
                initialNowTick: 0,
            });

            fakeTime.setTime(5 * 50);
            const caughtUp = wheel.advanceToNow(() => { });
            expect(caughtUp).toBe(true);
        });
    });

    describe("Budget Enforcement", () => {
        it("should respect budget during processing", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const fakeTime = new FakeTimeSource();
            const ticker = new MonotoneTicker({ tickMs: 50, time: fakeTime });
            const wheel = new TimerWheel({
                store,
                ticker,
                wheelSize: 8,
                budgetPerTick: 5, // very low budget
                initialNowTick: 0,
            });

            // Schedule 10 entries at tick 5
            const ids: number[] = [];
            for (let i = 0; i < 10; i++) {
                const id = store.allocId();
                store.setEntry(id, `k${i}`, i);
                wheel.schedule(id, 5);
                ids.push(id);
            }

            // Advance to tick 5
            fakeTime.setTime(5 * 50);
            const expired: number[] = [];
            const caughtUp = wheel.advanceToNow((id) => expired.push(id));

            // Should not be caught up (budget exhausted)
            expect(caughtUp).toBe(false);
            expect(expired.length).toBeLessThan(10);
            expect(expired.length).toBeGreaterThan(0);
        });

        it("should resume on next advance after budget exhaustion", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const fakeTime = new FakeTimeSource();
            const ticker = new MonotoneTicker({ tickMs: 50, time: fakeTime });
            const wheel = new TimerWheel({
                store,
                ticker,
                wheelSize: 8,
                budgetPerTick: 5,
                initialNowTick: 0,
            });

            // Schedule 10 entries at tick 5
            for (let i = 0; i < 10; i++) {
                const id = store.allocId();
                store.setEntry(id, `k${i}`, i);
                wheel.schedule(id, 5);
            }

            fakeTime.setTime(5 * 50);
            const expired: number[] = [];

            // First advance (budget exhausted mid-bucket)
            let caughtUp = wheel.advanceToNow((id) => expired.push(id));
            expect(caughtUp).toBe(false);
            expect(expired.length).toBe(5); // Processed budget limit

            // Second advance at same time - won't process more (nowTick == targetTick)
            caughtUp = wheel.advanceToNow((id) => expired.push(id));
            expect(caughtUp).toBe(true); // "Caught up" but 5 entries remain in bucket 5
            expect(expired.length).toBe(5);

            // Remaining entries stuck in bucket 5 until wrap-around (wheelSize=8, tick 13 → bucket 5)
            fakeTime.setTime(13 * 50);
            caughtUp = wheel.advanceToNow((id) => expired.push(id));
            expect(expired.length).toBe(10); // Now all 10 processed via guardrail
        });

        it("should handle budget across multiple ticks", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const fakeTime = new FakeTimeSource();
            const ticker = new MonotoneTicker({ tickMs: 50, time: fakeTime });
            const wheel = new TimerWheel({
                store,
                ticker,
                wheelSize: 8,
                budgetPerTick: 3,
                initialNowTick: 0,
            });

            // Schedule entries at different ticks
            for (let tick = 1; tick <= 5; tick++) {
                for (let i = 0; i < 2; i++) {
                    const id = store.allocId();
                    store.setEntry(id, `k${tick}-${i}`, tick * 10 + i);
                    wheel.schedule(id, tick);
                }
            }

            // Advance to tick 5 (10 total entries to process)
            fakeTime.setTime(5 * 50);
            const expired: number[] = [];

            let iterations = 0;
            let caughtUp = false;
            while (!caughtUp && iterations < 10) {
                caughtUp = wheel.advanceToNow((id) => expired.push(id));
                iterations++;
            }

            // Caught up at tick 5, but 2 entries remain in bucket 5 due to budget exhaustion
            expect(caughtUp).toBe(true);
            expect(expired.length).toBe(8); // Ticks 1-4 fully processed, tick 5 partial

            // Entries stuck in bucket 5 until wrap-around (wheelSize=8, so tick 13 → bucket 5)
            fakeTime.setTime(13 * 50);
            wheel.advanceToNow((id) => expired.push(id));
            expect(expired.length).toBe(10); // Now all 10 processed (guardrail moved/expired them)
        });
    });

    describe("Collision Handling (Wrap-around)", () => {
        it("should handle bucket collision due to wrap-around", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const fakeTime = new FakeTimeSource();
            const ticker = new MonotoneTicker({ tickMs: 50, time: fakeTime });
            const wheel = new TimerWheel({
                store,
                ticker,
                wheelSize: 8, // buckets 0-7, horizon = 8
                budgetPerTick: 1000,
                initialNowTick: 0,
            });

            const id1 = store.allocId();
            const id2 = store.allocId();

            store.setEntry(id1, "k1", 1);
            store.setEntry(id2, "k2", 2);

            // Schedule both entries
            wheel.schedule(id1, 3);  // tick 3, bucket 3, expires soon
            wheel.schedule(id2, 11); // tick 11, delta = 11 > 8 → OVERFLOW

            expect(store.wheelBucket[id1]).toBe(3);
            expect(store.wheelBucket[id2]).toBe(BUCKET_OVERFLOW); // Goes to overflow!

            // Advance to tick 2 - id2 still in overflow (delta=9 > 8)
            fakeTime.setTime(2 * 50);
            let expired: number[] = [];
            wheel.advanceToNow((id) => expired.push(id));

            expect(expired.length).toBe(0);
            expect(store.wheelBucket[id2]).toBe(BUCKET_OVERFLOW); // Still in overflow

            // Advance to tick 3 - id1 expires, id2 moves from overflow to bucket 3
            fakeTime.setTime(3 * 50);
            expired = [];
            wheel.advanceToNow((id) => expired.push(id));

            // Only id1 should expire
            expect(expired).toContain(id1);
            expect(expired).not.toContain(id2);

            // id2 moved from overflow to bucket 3 (delta now 8 <= horizon 8)
            expect(store.wheelBucket[id2]).toBe(3);

            // Advance to tick 10 - id2 still in bucket 3, not expired yet
            fakeTime.setTime(10 * 50);
            expired.length = 0;
            wheel.advanceToNow((id) => expired.push(id));

            // id2 still in bucket 3 (11 & 7 = 3), hasn't expired
            expect(store.wheelBucket[id2]).toBe(3);
            expect(expired).not.toContain(id2);

            // Finally advance to tick 11 - id2 expires
            fakeTime.setTime(11 * 50);
            expired.length = 0;
            wheel.advanceToNow((id) => expired.push(id));

            expect(expired).toContain(id2);
        });

        it("should correctly expire after wrap-around", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const fakeTime = new FakeTimeSource();
            const ticker = new MonotoneTicker({ tickMs: 50, time: fakeTime });
            const wheel = new TimerWheel({
                store,
                ticker,
                wheelSize: 8,
                budgetPerTick: 1000,
                initialNowTick: 0,
            });

            const id = store.allocId();
            store.setEntry(id, "key1", 100);

            // Schedule at tick 11 (bucket 3)
            wheel.schedule(id, 11);

            // Advance to tick 11
            fakeTime.setTime(11 * 50);
            const expired: number[] = [];
            wheel.advanceToNow((id) => expired.push(id));

            expect(expired).toContain(id);
        });
    });

    describe("Edge Cases", () => {
        it("should throw when scheduling at current tick", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const fakeTime = new FakeTimeSource();
            fakeTime.setTime(5 * 50); // start at tick 5
            const ticker = new MonotoneTicker({ tickMs: 50, time: fakeTime });
            const wheel = new TimerWheel({
                store,
                ticker,
                wheelSize: 8,
                budgetPerTick: 1000,
                initialNowTick: 5,
            });

            const id = store.allocId();
            store.setEntry(id, "key1", 100);

            // Cannot schedule at current tick (expTick <= nowTick)
            expect(() => wheel.schedule(id, 5)).toThrow(/Cannot schedule in the past/);

            // Cannot schedule in the past
            expect(() => wheel.schedule(id, 4)).toThrow(/Cannot schedule in the past/);

            // But can schedule in the future
            expect(() => wheel.schedule(id, 6)).not.toThrow();
        });

        it("should handle empty wheel advance", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const fakeTime = new FakeTimeSource();
            const ticker = new MonotoneTicker({ tickMs: 50, time: fakeTime });
            const wheel = new TimerWheel({
                store,
                ticker,
                wheelSize: 8,
                budgetPerTick: 1000,
                initialNowTick: 0,
            });

            // Advance with no entries
            fakeTime.setTime(10 * 50);
            const expired: number[] = [];
            const caughtUp = wheel.advanceToNow((id) => expired.push(id));

            expect(caughtUp).toBe(true);
            expect(expired.length).toBe(0);
            expect(wheel.stats().nowTick).toBe(10);
        });

        it("should handle unlink of unscheduled entry (noop)", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const ticker = new MonotoneTicker({ tickMs: 50 });
            const wheel = new TimerWheel({
                store,
                ticker,
                wheelSize: 8,
                budgetPerTick: 1000,
                initialNowTick: 0,
            });

            const id = store.allocId();
            store.setEntry(id, "key1", 100);

            // Unlink without scheduling (should not crash)
            expect(() => wheel.unlink(id)).not.toThrow();
            expect(store.wheelBucket[id]).toBe(BUCKET_NONE);
        });

        it("should throw on invalid targetTick in advanceToTick", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const ticker = new MonotoneTicker({ tickMs: 50 });
            const wheel = new TimerWheel({
                store,
                ticker,
                wheelSize: 8,
                budgetPerTick: 1000,
                initialNowTick: 0,
            });

            expect(() => wheel.advanceToTick(-1, () => { })).toThrow(/non-negative integer/);
        });
    });

    describe("Stats", () => {
        it("should track nowTick correctly", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const fakeTime = new FakeTimeSource();
            const ticker = new MonotoneTicker({ tickMs: 50, time: fakeTime });
            const wheel = new TimerWheel({
                store,
                ticker,
                wheelSize: 8,
                budgetPerTick: 1000,
                initialNowTick: 0,
            });

            expect(wheel.stats().nowTick).toBe(0);

            fakeTime.setTime(5 * 50);
            wheel.advanceToNow(() => { });
            expect(wheel.stats().nowTick).toBe(5);

            fakeTime.setTime(12 * 50);
            wheel.advanceToNow(() => { });
            expect(wheel.stats().nowTick).toBe(12);
        });

        it("should track overflow count", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const ticker = new MonotoneTicker({ tickMs: 50 });
            const wheel = new TimerWheel({
                store,
                ticker,
                wheelSize: 8,
                budgetPerTick: 1000,
                initialNowTick: 0,
            });

            expect(wheel.stats().overflowCountApprox).toBe(0);

            const id1 = store.allocId();
            store.setEntry(id1, "k1", 1);
            wheel.schedule(id1, 20); // overflow

            expect(wheel.stats().overflowCountApprox).toBe(1);

            const id2 = store.allocId();
            store.setEntry(id2, "k2", 2);
            wheel.schedule(id2, 25); // overflow

            expect(wheel.stats().overflowCountApprox).toBe(2);

            wheel.unlink(id1);
            expect(wheel.stats().overflowCountApprox).toBe(1);
        });

        it("should report horizon ticks", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const ticker = new MonotoneTicker({ tickMs: 50 });
            const wheel = new TimerWheel({
                store,
                ticker,
                wheelSize: 128,
                budgetPerTick: 1000,
                initialNowTick: 0,
            });

            expect(wheel.stats().horizonTicks).toBe(128);
        });
    });

    describe("Integration Scenarios", () => {
        it("should handle mixed operations (schedule, unlink, advance)", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const fakeTime = new FakeTimeSource();
            const ticker = new MonotoneTicker({ tickMs: 50, time: fakeTime });
            const wheel = new TimerWheel({
                store,
                ticker,
                wheelSize: 8,
                budgetPerTick: 1000,
                initialNowTick: 0,
            });

            const id1 = store.allocId();
            const id2 = store.allocId();
            const id3 = store.allocId();

            store.setEntry(id1, "k1", 1);
            store.setEntry(id2, "k2", 2);
            store.setEntry(id3, "k3", 3);

            // Schedule entries
            wheel.schedule(id1, 3);
            wheel.schedule(id2, 5);
            wheel.schedule(id3, 7);

            // Unlink id2 before it expires
            wheel.unlink(id2);

            // Advance to tick 7
            fakeTime.setTime(7 * 50);
            const expired: number[] = [];
            wheel.advanceToNow((id) => expired.push(id));

            // id1 and id3 should expire, id2 should not
            expect(expired).toContain(id1);
            expect(expired).not.toContain(id2);
            expect(expired).toContain(id3);
        });

        it("should handle overflow drain and expiration in same advance", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const fakeTime = new FakeTimeSource();
            const ticker = new MonotoneTicker({ tickMs: 50, time: fakeTime });
            const wheel = new TimerWheel({
                store,
                ticker,
                wheelSize: 8,
                budgetPerTick: 1000,
                initialNowTick: 0,
            });

            const id1 = store.allocId();
            const id2 = store.allocId();

            store.setEntry(id1, "k1", 1);
            store.setEntry(id2, "k2", 2);

            // id1 in overflow, id2 in wheel
            wheel.schedule(id1, 15); // overflow
            wheel.schedule(id2, 5); // wheel

            // Advance to tick 10 (id2 expires, id1 moves to wheel)
            fakeTime.setTime(10 * 50);
            const expired: number[] = [];
            wheel.advanceToNow((id) => expired.push(id));

            expect(expired).toContain(id2);
            expect(expired).not.toContain(id1);
            expect(store.wheelBucket[id1]).not.toBe(BUCKET_OVERFLOW);

            // Continue to tick 15 (id1 expires)
            fakeTime.setTime(15 * 50);
            expired.length = 0;
            wheel.advanceToNow((id) => expired.push(id));

            expect(expired).toContain(id1);
        });

        it("should handle reschedule during active wheel traversal", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const fakeTime = new FakeTimeSource();
            const ticker = new MonotoneTicker({ tickMs: 50, time: fakeTime });
            const wheel = new TimerWheel({
                store,
                ticker,
                wheelSize: 8,
                budgetPerTick: 1000,
                initialNowTick: 0,
            });

            const id = store.allocId();
            store.setEntry(id, "key1", 100);

            wheel.schedule(id, 3);

            // Reschedule before expiration
            wheel.schedule(id, 7);

            // Advance to tick 3 (should not expire)
            fakeTime.setTime(3 * 50);
            const expired1: number[] = [];
            wheel.advanceToNow((id) => expired1.push(id));
            expect(expired1).not.toContain(id);

            // Advance to tick 7 (should expire)
            fakeTime.setTime(7 * 50);
            const expired2: number[] = [];
            wheel.advanceToNow((id) => expired2.push(id));
            expect(expired2).toContain(id);
        });
    });

    describe("Deterministic Testing with advanceToTick", () => {
        it("should advance to specific tick deterministically", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const fakeTime = new FakeTimeSource();
            const ticker = new MonotoneTicker({ tickMs: 50, time: fakeTime });
            const wheel = new TimerWheel({
                store,
                ticker,
                wheelSize: 8,
                budgetPerTick: 1000,
                initialNowTick: 0,
            });

            const id = store.allocId();
            store.setEntry(id, "key1", 100);
            wheel.schedule(id, 5);

            // Advance to tick 5 directly
            const expired: number[] = [];
            const caughtUp = wheel.advanceToTick(5, (id) => expired.push(id));

            expect(caughtUp).toBe(true);
            expect(expired).toContain(id);
            expect(wheel.stats().nowTick).toBe(5);
        });

        it("should handle incremental tick advancement", () => {
            const store = new EntryStore<string, number>({ maxEntries: 100 });
            const ticker = new MonotoneTicker({ tickMs: 50 });
            const wheel = new TimerWheel({
                store,
                ticker,
                wheelSize: 8,
                budgetPerTick: 1000,
                initialNowTick: 0,
            });

            const ids = [1, 3, 5].map((tick) => {
                const id = store.allocId();
                store.setEntry(id, `k${tick}`, tick);
                wheel.schedule(id, tick);
                return id;
            });

            const expired: number[] = [];

            // Advance tick by tick
            wheel.advanceToTick(2, (id) => expired.push(id));
            expect(expired).toContain(ids[0]); // tick 1 expired
            expect(expired.length).toBe(1);

            wheel.advanceToTick(4, (id) => expired.push(id));
            expect(expired).toContain(ids[1]); // tick 3 expired
            expect(expired.length).toBe(2);

            wheel.advanceToTick(6, (id) => expired.push(id));
            expect(expired).toContain(ids[2]); // tick 5 expired
            expect(expired.length).toBe(3);
        });
    });
});
