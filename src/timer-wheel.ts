import { EntryId, EntryStore } from "./entry-store";
import { BUCKET_NONE, BUCKET_OVERFLOW, NIL } from "./constants";
import { MonotoneTicker } from "./monotone-time";

export interface TimerWheelOptions {
    wheelSize: number;      // must be power of 2
    budgetPerTick: number;  // max processed nodes per tick advancement (soft budget)
}

export interface TimerWheelStats {
    nowTick: number;
    horizonTicks: number;
    overflowCountApprox: number;
}

function isPowerOfTwo(n: number): boolean {
    return n > 0 && (n & (n - 1)) === 0;
}

export class TimerWheel<K, V> {
    private readonly store: EntryStore<K, V>;
    private readonly ticker: MonotoneTicker;

    private readonly wheelSize: number;
    private readonly wheelMask: number;
    private readonly horizonTicks: number;
    private readonly budgetPerTick: number;

    // Heads of bucket lists
    private readonly wheelHeads: Int32Array;

    // Overflow list head (uses store.wheelNext/Prev too)
    private overflowHead: number = NIL;
    private overflowCountApprox = 0;

    // Current processed tick (discrete)
    // TODO: nowTick can overflow after 2^32 ticks (~6.8 years with tickMs=50, ~49 days with tickMs=1).
    // Current comparisons (< and <=) do not handle wrap-around correctly.
    private nowTick: number;

    // continuation state when budget is exceeded mid-advance
    private pendingTargetTick: number | null = null;

    constructor(opts: {
        store: EntryStore<K, V>;
        ticker: MonotoneTicker;
        wheelSize: number;
        budgetPerTick: number;
        initialNowTick?: number;
    }) {
        this.store = opts.store;
        this.ticker = opts.ticker;

        if (!Number.isInteger(opts.wheelSize) || opts.wheelSize < 2 || !isPowerOfTwo(opts.wheelSize)) {
            throw new Error("wheelSize must be a power of two >= 2");
        }
        if (!Number.isInteger(opts.budgetPerTick) || opts.budgetPerTick <= 0) {
            throw new Error("budgetPerTick must be a positive integer");
        }

        this.wheelSize = opts.wheelSize;
        this.wheelMask = this.wheelSize - 1;
        this.horizonTicks = this.wheelSize; // simple wheel horizon in ticks
        this.budgetPerTick = opts.budgetPerTick;

        this.wheelHeads = new Int32Array(this.wheelSize);
        this.wheelHeads.fill(NIL);

        this.nowTick = opts.initialNowTick ?? this.ticker.nowTick();
    }

    stats(): TimerWheelStats {
        return {
            nowTick: this.nowTick,
            horizonTicks: this.horizonTicks,
            overflowCountApprox: this.overflowCountApprox,
        };
    }

    /**
     * Schedule or reschedule an entryId to expire at expTick.
     * This method will unlink it from wherever it currently is (if any), then link it.
     */
    schedule(id: EntryId, expTick: number): void {
        if (!Number.isInteger(expTick) || expTick < 0) {
            throw new Error("expTick must be a non-negative integer");
        }

        // Defensive check: cannot schedule in the past
        if (expTick <= this.nowTick) {
            throw new Error(
                `Cannot schedule in the past: expTick=${expTick}, nowTick=${this.nowTick}`
            );
        }

        this.unlink(id);

        this.store.expiresTick[id] = expTick >>> 0;

        const delta = expTick - this.nowTick;
        if (delta > this.horizonTicks) {
            this.linkOverflow(id);
        } else {
            const bucket = this.bucketOf(expTick);
            this.linkWheelHead(id, bucket);
        }
    }

    /**
     * Unlink an id from wheel or overflow if it is linked. O(1).
     */
    unlink(id: EntryId): void {
        const b = this.store.wheelBucket[id];
        if (b === BUCKET_NONE) return;

        if (b === BUCKET_OVERFLOW) {
            this.unlinkOverflow(id);
            return;
        }

        // Wheel bucket
        this.unlinkWheel(id, b);
    }

    /**
     * Advance time to current ticker time (monotonic) and process expirations.
     * Returns true if fully caught up, false if budget exceeded and needs another call.
     */
    advanceToNow(onExpire: (id: EntryId) => void): boolean {
        const targetTick = this.ticker.nowTick();
        return this.advanceToTick(targetTick, onExpire);
    }

    /**
     * - Processes ticks in order: (nowTick+1 .. targetTick)
     * - Drift is naturally coalesced by processing multiple ticks at once, but guarded by budget.
     */
    advanceToTick(targetTick: number, onExpire: (id: EntryId) => void): boolean {
        if (!Number.isInteger(targetTick) || targetTick < 0) throw new Error("targetTick must be a non-negative integer");

        // If we had a pending continuation, we continue towards that target (largest of the two)
        if (this.pendingTargetTick !== null) {
            targetTick = Math.max(targetTick, this.pendingTargetTick);
        }

        let processed = 0;
        while (this.nowTick < targetTick) {
            // Move 1 tick forward
            this.nowTick++;

            // First: replanify some overflow entries that are now within horizon
            processed += this.drainOverflowWithinHorizon(processed, onExpire);
            if (processed >= this.budgetPerTick) {
                this.pendingTargetTick = targetTick;
                return false;
            }

            // Then: process the current bucket
            const bucket = this.bucketOf(this.nowTick);
            processed += this.processBucket(bucket, processed, onExpire);

            if (processed >= this.budgetPerTick) {
                this.pendingTargetTick = targetTick;
                return false;
            }
        }

        this.pendingTargetTick = null;
        return true;
    }

    // ---- Wheel internals ----

    private bucketOf(tick: number): number {
        // equivalent to tick % wheelSize (power-of-two fast path)
        return tick & this.wheelMask;
    }

    private linkWheelHead(id: EntryId, bucket: number): void {
        const head = this.wheelHeads[bucket];

        this.store.wheelBucket[id] = bucket;
        this.store.wheelPrev[id] = NIL;
        this.store.wheelNext[id] = head;

        if (head !== NIL) this.store.wheelPrev[head] = id;
        this.wheelHeads[bucket] = id;
    }

    private unlinkWheel(id: EntryId, bucket: number): void {
        const prev = this.store.wheelPrev[id];
        const next = this.store.wheelNext[id];

        if (prev !== NIL) {
            this.store.wheelNext[prev] = next;
        } else {
            // was head
            this.wheelHeads[bucket] = next;
        }

        if (next !== NIL) {
            this.store.wheelPrev[next] = prev;
        }

        this.store.wheelPrev[id] = NIL;
        this.store.wheelNext[id] = NIL;
        this.store.wheelBucket[id] = BUCKET_NONE;
    }

    // ---- Overflow internals ----

    private linkOverflow(id: EntryId): void {
        const head = this.overflowHead;

        this.store.wheelBucket[id] = BUCKET_OVERFLOW;
        this.store.wheelPrev[id] = NIL;
        this.store.wheelNext[id] = head;

        if (head !== NIL) this.store.wheelPrev[head] = id;
        this.overflowHead = id;
        this.overflowCountApprox++;
    }

    private unlinkOverflow(id: EntryId): void {
        const prev = this.store.wheelPrev[id]; 1
        const next = this.store.wheelNext[id]; 3

        if (prev !== NIL) {
            this.store.wheelNext[prev] = next;
        } else {
            // head
            this.overflowHead = next;
        }

        if (next !== NIL) {
            this.store.wheelPrev[next] = prev;
        }

        this.store.wheelPrev[id] = NIL;
        this.store.wheelNext[id] = NIL;
        this.store.wheelBucket[id] = BUCKET_NONE;
        if (this.overflowCountApprox > 0) this.overflowCountApprox--;
    }

    /**
     * Move overflow entries into the wheel when they are close enough.
     * Unsorted overflow list: we scan until we hit budget.
     */
    private drainOverflowWithinHorizon(processedSoFar: number, onExpire: (id: EntryId) => void): number {
        let processed = 0;
        let cursor = this.overflowHead;

        while (cursor !== NIL && (processedSoFar + processed) < this.budgetPerTick) {
            const id = cursor;
            const nextCursor = this.store.wheelNext[id];

            const exp = this.store.expiresTick[id];
            const delta = exp - this.nowTick;

            if (delta <= this.horizonTicks) {
                // Move to wheel (or expire if already due)
                this.unlinkOverflow(id);

                if (exp <= this.nowTick) {
                    onExpire(id);
                } else {
                    this.linkWheelHead(id, this.bucketOf(exp));
                }
                processed++;
            }

            cursor = nextCursor;
        }

        return processed;
    }

    /**
     * Process a wheel bucket (batch).
     * For each entry:
     * - if expired (expTick <= nowTick): expire
     * - else: guardrail: move to correct bucket if necessary
     */
    private processBucket(bucket: number, processedSoFar: number, onExpire: (id: EntryId) => void): number {
        let processed = 0;
        let cursor = this.wheelHeads[bucket];
        while (cursor !== NIL && (processedSoFar + processed) < this.budgetPerTick) {
            const id = cursor;
            const nextCursor = this.store.wheelNext[id];

            const exp = this.store.expiresTick[id];

            if (exp <= this.nowTick) {
                // Expire
                this.unlinkWheel(id, bucket);
                onExpire(id);
            } else {
                // guardrail: move to correct bucket if necessary
                const correctBucket = this.bucketOf(exp);
                if (correctBucket !== bucket) {
                    this.unlinkWheel(id, bucket);
                    this.linkWheelHead(id, correctBucket);
                }
            }

            processed++;
            cursor = nextCursor;
        }

        return processed;
    }
}
