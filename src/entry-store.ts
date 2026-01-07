import { BUCKET_NONE, NIL } from "./constants";

export type EntryId = number;

export interface EntryStoreDebug {
    cap: number;
    sizeAllocated: number;
    freeCount: number;
}


function fillI32(arr: Int32Array, value: number) {
    arr.fill(value);
}

/**
 * EntryStore = SoA storage + entryId allocator + free list + growth.
 *
 * Conventions:
 * - entryId: integer in [0, cap-1]
 * - free slot: keyRef[id] === undefined (source of truth)
 * - expiresTick[id] = 0 means "unused / not scheduled"
 * - list pointers: -1 means null pointer
 */
export class EntryStore<K, V> {
    private readonly maxEntries: number;
    private cap: number;
    private sizeAllocated: number; // next fresh id
    private freeList: Int32Array; // LIFO stack of free ids
    private freeCount: number; // number of free ids in the stack

    // SoA refs
    public readonly keyRef: Array<K | undefined>;
    public readonly valRef: Array<V | undefined>;

    // SoA metadata
    public expiresTick: Uint32Array;
    public ttlMs: Uint32Array; // Original TTL in milliseconds (for updateTTLOnGet)
    public wheelNext: Int32Array;
    public wheelPrev: Int32Array;
    public lruNext: Int32Array;
    public lruPrev: Int32Array;

    public wheelBucket: Int32Array;

    constructor(opts: { maxEntries: number; initialCap?: number }) {
        const { maxEntries } = opts;
        if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
            throw new Error("maxEntries must be a positive integer");
        }
        this.maxEntries = maxEntries;

        const initialCap = opts.initialCap ?? Math.min(1024, maxEntries);
        if (!Number.isInteger(initialCap) || initialCap <= 0) {
            throw new Error("initialCap must be a positive integer");
        }
        if (initialCap > maxEntries) {
            throw new Error("initialCap cannot exceed maxEntries");
        }

        this.cap = initialCap;
        this.sizeAllocated = 0;
        this.freeList = new Int32Array(maxEntries);
        this.freeCount = 0;

        this.keyRef = new Array<K | undefined>(this.cap);
        this.valRef = new Array<V | undefined>(this.cap);

        this.expiresTick = new Uint32Array(this.cap); // 0 by default
        this.ttlMs = new Uint32Array(this.cap); // 0 by default

        this.wheelNext = new Int32Array(this.cap);
        this.wheelPrev = new Int32Array(this.cap);
        this.lruNext = new Int32Array(this.cap);
        this.lruPrev = new Int32Array(this.cap);
        this.wheelBucket = new Int32Array(this.cap);

        fillI32(this.wheelNext, NIL);
        fillI32(this.wheelPrev, NIL);
        fillI32(this.lruNext, NIL);
        fillI32(this.lruPrev, NIL);
        fillI32(this.wheelBucket, BUCKET_NONE);
    }

    debug(): EntryStoreDebug {
        return {
            cap: this.cap,
            sizeAllocated: this.sizeAllocated,
            freeCount: this.freeCount,
        };
    }

    /**
     * Allocate an entryId.
     * Returns -1 if impossible (at maxEntries and no free slot).
     */
    allocId(): EntryId {
        if (this.freeCount > 0) {
            const reused = this.freeList[--this.freeCount];
            // Ensure a reused slot is clean
            this.resetSlot(reused);
            return reused;
        }

        if (this.sizeAllocated >= this.maxEntries) return -1;

        const id = this.sizeAllocated++;
        if (id >= this.cap) {
            this.ensureCapacity(id + 1);
        }

        this.resetSlot(id);
        return id;
    }

    /**
     * Store key and value for the given entry ID.
     * Should be called after allocating an entry ID.
     */
    setEntry(id: EntryId, key: K, value: V): void {
        if (!Number.isInteger(id) || id < 0 || id >= this.cap) {
            throw new Error(`invalid entryId: ${id}`);
        }
        this.keyRef[id] = key;
        this.valRef[id] = value;
    }

    /**
     * Free an entryId back to the free list.
     * Throws on double-free.
     */
    freeId(id: EntryId): void {
        if (!Number.isInteger(id) || id < 0 || id >= this.cap) {
            throw new Error(`invalid entryId: ${id}`);
        }
        if (this.keyRef[id] === undefined) {
            // Source of truth: already free
            throw new Error(`double-free detected for entryId=${id}`);
        }

        this.resetSlot(id);
        this.freeList[this.freeCount++] = id;
    }

    /**
     * Reset all SoA fields for a slot to the neutral state.
     */
    resetSlot(id: EntryId): void {
        this.keyRef[id] = undefined;
        this.valRef[id] = undefined;

        this.expiresTick[id] = 0;
        this.ttlMs[id] = 0;

        this.wheelNext[id] = NIL;
        this.wheelPrev[id] = NIL;

        this.lruNext[id] = NIL;
        this.lruPrev[id] = NIL;

        this.wheelBucket[id] = BUCKET_NONE;
    }

    /**
     * Growth strategy: doubling, capped at maxEntries.
     * Copies typed arrays.
     */
    private ensureCapacity(required: number): void {
        if (required <= this.cap) return;

        let newCap = this.cap;
        while (newCap < required) {
            const prevCap = newCap;
            newCap = Math.min(newCap * 2, this.maxEntries);
            if (newCap === prevCap) {
                throw new Error(
                    `cannot grow capacity to ${required} (maxEntries=${this.maxEntries})`
                );
            }
        }

        // Extend refs
        this.keyRef.length = newCap;
        this.valRef.length = newCap;

        // Realloc typed arrays + copy
        const oldExpires = this.expiresTick;
        this.expiresTick = new Uint32Array(newCap);
        this.expiresTick.set(oldExpires);

        const oldTtlMs = this.ttlMs;
        this.ttlMs = new Uint32Array(newCap);
        this.ttlMs.set(oldTtlMs);

        const oldWheelNext = this.wheelNext;
        const oldWheelPrev = this.wheelPrev;
        const oldLruNext = this.lruNext;
        const oldLruPrev = this.lruPrev;
        const oldWheelBucket = this.wheelBucket;

        this.wheelNext = new Int32Array(newCap);
        this.wheelPrev = new Int32Array(newCap);
        this.lruNext = new Int32Array(newCap);
        this.lruPrev = new Int32Array(newCap);
        this.wheelBucket = new Int32Array(newCap);

        fillI32(this.wheelNext, NIL);
        fillI32(this.wheelPrev, NIL);
        fillI32(this.lruNext, NIL);
        fillI32(this.lruPrev, NIL);
        fillI32(this.wheelBucket, BUCKET_NONE);

        this.wheelNext.set(oldWheelNext);
        this.wheelPrev.set(oldWheelPrev);
        this.lruNext.set(oldLruNext);
        this.lruPrev.set(oldLruPrev);
        this.wheelBucket.set(oldWheelBucket);

        this.cap = newCap;
    }
}
