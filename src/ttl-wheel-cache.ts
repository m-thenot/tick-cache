import { Options, Stats, EvictReason } from "./types";
import { EntryStore, EntryId } from "./entry-store";
import { TimerWheel } from "./timer-wheel";
import { MonotoneTicker } from "./monotone-time";
import { LruList } from "./lru-list";
import { NIL } from "./constants";

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
    private readonly passiveExpiration: boolean;
    private readonly tickMs: number;
    private readonly onEvict?: (key: K, value: V, reason: EvictReason) => void;

    // Stats
    private statsData: {
        hits: number;
        misses: number;
        evictedTtl: number;
        evictedLru: number;
        evictedManual: number;
    };

    // Cleanup interval
    private intervalId?: NodeJS.Timeout;

    constructor(options: Options<K, V>) {
        // Store configuration
        this.maxEntries = options.maxEntries;
        this.updateTTLOnGet = options.updateTTLOnGet ?? false;
        this.passiveExpiration = options.passiveExpiration ?? true;
        this.onEvict = options.onEvict;

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

        // Initialize stats
        this.statsData = {
            hits: 0,
            misses: 0,
            evictedTtl: 0,
            evictedLru: 0,
            evictedManual: 0,
        };

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
        if (this.passiveExpiration) {
            this.startCleanupInterval();
        }
    }

    set(key: K, value: V, ttlMs: number): void {
        // Advance wheel if in active mode
        if (!this.passiveExpiration) {
            this.advanceWheel();
        }

        // Reject invalid TTL
        if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
            return;
        }

        const existingId = this.keyIndex.get(key);

        if (existingId !== undefined) {
            // UPDATE existing entry
            this.store.valRef[existingId] = value;

            // Store TTL and reschedule expiration
            this.store.ttlMs[existingId] = ttlMs;
            const expireTick = this.ticker.nowTick() + Math.floor(ttlMs / this.ticker.tickMs);
            this.wheel.schedule(existingId, expireTick);

            // Touch LRU (move to head)
            this.lru.touch(existingId);

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
        if (!this.passiveExpiration) {
            this.advanceWheel();
        }

        const id = this.keyIndex.get(key);

        if (id === undefined) {
            this.statsData.misses++;
            return undefined;
        }

        // Defensive expire-on-read check
        const expireTick = this.store.expiresTick[id];
        const nowTick = this.ticker.nowTick();

        if (expireTick <= nowTick) {
            // Entry expired but hasn't been cleaned up yet
            this.onExpireEntry(id, "ttl");
            this.statsData.misses++;
            return undefined;
        }

        // Success
        this.statsData.hits++;

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
        if (!this.passiveExpiration) {
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
        if (!this.passiveExpiration) {
            this.advanceWheel();
        }

        const id = this.keyIndex.get(key);

        if (id === undefined) {
            return false;
        }

        const value = this.store.valRef[id];

        // Call user callback
        if (this.onEvict && value !== undefined) {
            this.onEvict(key, value, "delete");
        }

        // Remove from all structures
        this.removeEntry(id);
        this.statsData.evictedManual++;

        return true;
    }

    clear(): void {
        // Call onEvict and free entries
        for (const [key, id] of this.keyIndex) {
            const value = this.store.valRef[id];

            // Call user callback
            if (this.onEvict && value !== undefined) {
                this.onEvict(key, value, "clear");
            }

            // Unlink from timer wheel
            this.wheel.unlink(id);

            // Free the entry
            this.store.freeId(id);
        }

        // Update stats
        this.statsData.evictedManual += this.keyIndex.size;

        // Clear index
        this.keyIndex.clear();

        // Reset LRU list
        this.lru.reset();
    }

    size(): number {
        return this.keyIndex.size;
    }

    stats(): Stats {
        return {
            size: this.size(),
            hits: this.statsData.hits,
            misses: this.statsData.misses,
            evictedTtl: this.statsData.evictedTtl,
            evictedLru: this.statsData.evictedLru,
            evictedManual: this.statsData.evictedManual,
        };
    }

    resetStats(): void {
        this.statsData.hits = 0;
        this.statsData.misses = 0;
        this.statsData.evictedTtl = 0;
        this.statsData.evictedLru = 0;
        this.statsData.evictedManual = 0;
    }

    close(): void {
        if (this.intervalId !== undefined) {
            clearInterval(this.intervalId);
            this.intervalId = undefined;
        }
    }

    /**
     * Advance the timer wheel and process expirations.
     * Called automatically in active mode (passiveExpiration=false).
     */
    private advanceWheel(): void {
        this.wheel.advanceToNow((id) => {
            this.onExpireEntry(id, "ttl");
        });
    }

    private removeEntry(id: EntryId): void {
        const key = this.store.keyRef[id];

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
    }

    private onExpireEntry(id: EntryId, reason: EvictReason): void {
        const key = this.store.keyRef[id];
        const value = this.store.valRef[id];

        // Call user callback
        if (this.onEvict && key !== undefined && value !== undefined) {
            this.onEvict(key, value, reason);
        }

        // Remove from all structures
        this.removeEntry(id);

        // Update stats based on reason
        if (reason === "ttl") {
            this.statsData.evictedTtl++;
        }
    }

    private evictLru(): boolean {
        const tail = this.lru.getTail();
        if (tail === NIL) {
            return false; // No entries to evict
        }

        const key = this.store.keyRef[tail];
        const value = this.store.valRef[tail];

        // Call user callback before removing entry
        if (this.onEvict && key !== undefined && value !== undefined) {
            this.onEvict(key, value, "lru");
        }

        // Remove from all structures
        this.removeEntry(tail);
        this.statsData.evictedLru++;

        return true;
    }


    private startCleanupInterval(): void {
        this.intervalId = setInterval(() => {
            this.advanceWheel();
        }, this.tickMs);

        this.intervalId.unref();
    }
}