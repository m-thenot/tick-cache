import { Options, Stats, DisposeReason } from "./types";
import { EntryStore, EntryId } from "./entry-store";
import { TimerWheel } from "./timer-wheel";
import { MonotoneTicker } from "./monotone-time";
import { LruList } from "./lru-list";
import { NIL } from "./constants";
import { log } from "node:console";

export class TtlWheelCache<K extends string | number, V> {
    // Core components
    private readonly store: EntryStore<K, V>;
    private readonly wheel: TimerWheel<K, V>;
    private readonly ticker: MonotoneTicker;
    private readonly keyIndex: Map<K, EntryId>;
    private readonly lru: LruList<K, V>;

    // Configuration
    private readonly maxEntries: number;
    private readonly updateTTLOnGet: boolean;
    private readonly ttlAutopurge: boolean;
    private readonly tickMs: number;
    private readonly onDispose?: (key: K, value: V, reason: DisposeReason) => void;

    // Cleanup interval
    private intervalId?: NodeJS.Timeout;

    constructor(options: Options<K, V>) {
        // Store configuration
        this.maxEntries = options.maxEntries;
        this.updateTTLOnGet = options.updateTTLOnGet ?? false;
        this.ttlAutopurge = options.ttlAutopurge ?? true;
        this.onDispose = options.onDispose;

        this.tickMs = options.tickMs ?? 50;
        const wheelSize = options.wheelSize ?? 4096;
        const budgetPerTick = options.budgetPerTick ?? 200_000;

        // Initialize storage
        this.store = new EntryStore<K, V>({
            maxEntries: options.maxEntries
        });

        // Initialize key index
        this.keyIndex = new Map<K, EntryId>();

        // Initialize LRU list
        this.lru = new LruList(this.store);

        // Initialize timer wheel
        this.ticker = new MonotoneTicker({
            tickMs: this.tickMs,
            time: options.time,
        });
        this.wheel = new TimerWheel({
            store: this.store,
            ticker: this.ticker,
            wheelSize,
            budgetPerTick,
        });

        // Start background expiration processing (only if passive mode)
        if (this.ttlAutopurge) {
            this.startCleanupInterval();
        }
    }

    set(key: K, value: V, ttlMs: number): void {
        // Advance wheel if in active mode
        if (!this.ttlAutopurge) {
            this.advanceWheel();
        }

        // Reject invalid TTL
        if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
            return;
        }

        const existingId = this.keyIndex.get(key);

        if (existingId !== undefined) {
            // UPDATE existing entry
            const oldValue = this.store.valRef[existingId];

            // Replace value
            this.store.valRef[existingId] = value;

            // Store TTL and reschedule expiration
            this.store.ttlMs[existingId] = ttlMs;
            const expireTick = this.ticker.nowTick() + Math.floor(ttlMs / this.ticker.tickMs);
            this.wheel.schedule(existingId, expireTick);

            // Touch LRU (move to head)
            this.lru.touch(existingId);

            if (this.onDispose && oldValue !== undefined) {
                this.onDispose(key, oldValue, "set");
            }

        } else {
            // NEW entry: evict LRU if at capacity
            while (this.keyIndex.size >= this.maxEntries) {
                const evicted = this.evictLru();
                if (!evicted) {
                    throw new Error("Failed to evict LRU entry");
                }
            }

            // Allocate new ID
            const id = this.store.allocId();
            if (id === NIL) {
                throw new Error("Failed to allocate entry ID");
            }

            // Store key-value and TTL
            this.store.setEntry(id, key, value);
            this.store.ttlMs[id] = ttlMs;

            // Add to index
            this.keyIndex.set(key, id);

            // Schedule expiration
            const expireTick = this.ticker.nowTick() + Math.floor(ttlMs / this.ticker.tickMs);
            this.wheel.schedule(id, expireTick);

            // Add to LRU head (most recent)
            this.lru.linkHead(id);
        }
    }

    get(key: K): V | undefined {
        // Advance wheel if in active mode
        if (!this.ttlAutopurge) {
            this.advanceWheel();
        }

        const id = this.keyIndex.get(key);

        if (id === undefined) {
            return undefined;
        }

        // Defensive expire-on-read check
        const expireTick = this.store.expiresTick[id];
        const nowTick = this.ticker.nowTick();


        if (expireTick <= nowTick) {
            // Entry expired but hasn't been cleaned up yet
            this.onExpireEntry(id, "ttl");
            return undefined;
        }

        // Touch LRU (move to head)
        this.lru.touch(id);

        // Update TTL on get (sliding expiration)
        if (this.updateTTLOnGet) {
            const ttl = this.store.ttlMs[id];
            if (ttl > 0) {
                const newExpireTick = this.ticker.nowTick() + Math.floor(ttl / this.ticker.tickMs);
                this.wheel.schedule(id, newExpireTick);
            }
        }

        return this.store.valRef[id];
    }

    has(key: K): boolean {
        // Advance wheel if in active mode
        if (!this.ttlAutopurge) {
            this.advanceWheel();
        }

        const id = this.keyIndex.get(key);

        if (id === undefined) {
            return false;
        }

        // Check expiration
        const expireTick = this.store.expiresTick[id];
        const nowTick = this.ticker.nowTick();

        if (expireTick <= nowTick) {
            // Expired but not cleaned up yet
            this.onExpireEntry(id, "ttl");
            return false;
        }

        return true;
    }

    delete(key: K): boolean {
        // Advance wheel if in active mode
        if (!this.ttlAutopurge) {
            this.advanceWheel();
        }

        const id = this.keyIndex.get(key);

        if (id === undefined) {
            return false;
        }

        this.removeEntry(id, "delete");

        return true;
    }

    clear(): void {
        // Collect all entry IDs (can't modify keyIndex while iterating)
        const ids = Array.from(this.keyIndex.values());

        for (const id of ids) {
            this.removeEntry(id, "clear");
        }
    }

    size(): number {
        return this.keyIndex.size;
    }

    stats(): Stats {
        return {
            size: this.size(),
        };
    }

    close(): void {
        if (this.intervalId !== undefined) {
            clearInterval(this.intervalId);
            this.intervalId = undefined;
        }
    }

    /**
     * Advance the timer wheel and process expirations.
     * Called automatically in active mode (ttlAutopurge=false).
     */
    private advanceWheel(): void {
        this.wheel.advanceToNow((id) => {
            this.onExpireEntry(id, "ttl");
        });
    }

    private removeEntry(id: EntryId, reason: DisposeReason): void {
        const key = this.store.keyRef[id];
        const value = this.store.valRef[id];

        // Remove from key index
        if (key !== undefined) {
            this.keyIndex.delete(key);
        }

        // Unlink from timer wheel
        this.wheel.unlink(id);

        // Unlink from LRU list
        this.lru.unlink(id);

        // Free the entry ID back to store
        this.store.freeId(id);

        if (this.onDispose && key !== undefined && value !== undefined) {
            this.onDispose(key, value, reason);
        }
    }

    private onExpireEntry(id: EntryId, reason: DisposeReason): void {
        this.removeEntry(id, reason);
    }

    private evictLru(): boolean {
        const tail = this.lru.getTail();
        if (tail === NIL) {
            return false; // No entries to evict
        }

        this.removeEntry(tail, "lru");

        return true;
    }


    private startCleanupInterval(): void {
        this.intervalId = setInterval(() => {
            this.advanceWheel();
        }, this.tickMs);

        this.intervalId.unref();
    }
}