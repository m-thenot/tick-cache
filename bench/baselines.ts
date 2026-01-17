import { TtlWheelCache } from "../src/ttl-wheel-cache";
import { LRUCache } from "lru-cache";
import { TTLCache } from "@isaacs/ttlcache";
import type { Stats as CoreStats } from "../src/types";
import type { CacheBenchmark, WorkloadConfig, Stats } from "./types";


/**
 * Map entry structure for baseline implementation
 */
interface MapEntry {
    value: any;
    deadline: number; // performance.now() + ttlMs
}


/**
 * Factory function to create TtlWheelCache benchmark wrapper
 */
function createTtlWheelCacheBenchmark(ttlAutopurge: boolean) {
    return class implements CacheBenchmark {
        private cache: TtlWheelCache<string, any>;
        private hitCount: number = 0;
        private missCount: number = 0;
        private ttlEvictions: number = 0;
        private lruEvictions: number = 0;
        private manualEvictions: number = 0;
        private setEvictions: number = 0;

        constructor(config: WorkloadConfig) {
            this.cache = new TtlWheelCache({
                maxEntries: config.maxEntries,
                tickMs: config.cacheConfig.tickMs,
                wheelSize: config.cacheConfig.wheelSize,
                budgetPerTick: config.cacheConfig.budgetPerTick,
                updateTTLOnGet: config.cacheConfig.updateTTLOnGet,
                ttlAutopurge,
                onDispose: (_key, _value, reason) => {
                    if (reason === "ttl") {
                        this.ttlEvictions++;
                    } else if (reason === "lru") {
                        this.lruEvictions++;
                    } else if (reason === "delete" || reason === "clear") {
                        this.manualEvictions++;
                    } else if (reason === "set") {
                        this.setEvictions++;
                    }
                },
            });
        }

        get(key: string): any {
            const value = this.cache.get(key);
            if (value !== undefined) {
                this.hitCount++;
            } else {
                this.missCount++;
            }
            return value;
        }

        set(key: string, value: any, ttlMs: number): void {
            this.cache.set(key, value, ttlMs);
        }

        delete(key: string): boolean {
            return this.cache.delete(key);
        }

        size(): number {
            return this.cache.size();
        }

        stats(): Stats {
            const cacheStats = this.cache.stats();
            return {
                size: cacheStats.size,
                hits: this.hitCount,
                misses: this.missCount,
                evictedTtl: this.ttlEvictions,
                evictedLru: this.lruEvictions,
                evictedManual: this.manualEvictions,
                evictedSet: this.setEvictions,
            };
        }

        close(): void {
            this.cache.close();
        }
    };
}

/**
 * Factory function to create lru-cache benchmark wrapper
 */
function createLruCacheBenchmark(ttlAutopurge: boolean) {
    return class implements CacheBenchmark {
        private cache: LRUCache<string, any>;
        private getCount: number = 0;
        private hitCount: number = 0;
        private manualEvictions: number = 0;
        private ttlEvictions: number = 0;
        private lruEvictions: number = 0;
        private setEvictions: number = 0;

        constructor(config: WorkloadConfig) {
            this.cache = new LRUCache({
                max: config.maxEntries,
                updateAgeOnGet: config.cacheConfig.updateTTLOnGet,
                allowStale: false,
                ttlAutopurge,
                ttlResolution: 0,
                dispose: (_key, _value, reason) => {
                    if (reason === "delete") {
                        this.manualEvictions++;
                    }
                    if (reason === "expire") {
                        this.ttlEvictions++;
                    }
                    if (reason === "evict") {
                        this.lruEvictions++;
                    }
                    if (reason === "set") {
                        this.setEvictions++;
                    }
                    if (reason === 'fetch') {
                        this.setEvictions++;
                    }
                },
            });
        }

        get(key: string): any {
            this.getCount++;
            const value = this.cache.get(key);
            if (value !== undefined) {
                this.hitCount++;
            }
            return value;
        }

        set(key: string, value: any, ttlMs: number): void {
            this.cache.set(key, value, { ttl: ttlMs });
        }

        delete(key: string): boolean {
            return this.cache.delete(key);
        }

        size(): number {
            return this.cache.size;
        }

        stats(): Stats {
            const size = this.cache.size;
            const hits = this.hitCount;
            const misses = this.getCount - this.hitCount;

            return {
                size,
                hits,
                misses,
                evictedTtl: this.ttlEvictions,
                evictedLru: this.lruEvictions,
                evictedManual: this.manualEvictions,
                evictedSet: this.setEvictions,
            };
        }

        close(): void {
            this.cache.clear();
        }
    };
}

/**
 * TtlWheelCache WITHOUT autopurge (active expiration only)
 */
export const TtlWheelCacheBenchmark = createTtlWheelCacheBenchmark(false);

/**
 * TtlWheelCache WITH autopurge (background timer enabled)
 */
export const TtlWheelCacheAutopurgeBenchmark = createTtlWheelCacheBenchmark(true);

/**
 * lru-cache WITHOUT autopurge
 */
export const LruCacheBenchmark = createLruCacheBenchmark(false);

/**
 * lru-cache WITH autopurge
 */
export const LruCacheAutopurgeBenchmark = createLruCacheBenchmark(true);

/**
 * @isaacs/ttlcache (always in autopurge mode, not configurable)
 */
export class TTLCacheBenchmark implements CacheBenchmark {
    private cache: TTLCache<string, any>;
    private getCount: number = 0;
    private hitCount: number = 0;
    private manualEvictions: number = 0;
    private ttlEvictions: number = 0;
    private lruEvictions: number = 0;
    private setEvictions: number = 0;

    constructor(config: WorkloadConfig) {
        this.cache = new TTLCache({
            max: config.maxEntries,
            updateAgeOnGet: config.cacheConfig.updateTTLOnGet,
            checkAgeOnGet: true,
            ttl: Infinity,
            dispose: (_key, _value, reason) => {
                if (reason === "delete") {
                    this.manualEvictions++;
                }
                if (reason === "stale") {
                    this.ttlEvictions++;
                }
                if (reason === "evict") {
                    this.lruEvictions++;
                }
                if (reason === "set") {
                    this.setEvictions++;
                }
            },
        });
    }

    get(key: string): any {
        this.getCount++;
        const value = this.cache.get(key);
        if (value !== undefined) {
            this.hitCount++;
        }
        return value;
    }

    set(key: string, value: any, ttlMs: number): void {
        this.cache.set(key, value, { ttl: ttlMs });
    }

    delete(key: string): boolean {
        return this.cache.delete(key);
    }

    size(): number {
        return this.cache.size;
    }

    stats(): Stats {
        const size = this.cache.size;
        const hits = this.hitCount;
        const misses = this.getCount - this.hitCount;

        return {
            size,
            hits,
            misses,
            evictedTtl: this.ttlEvictions,
            evictedLru: this.lruEvictions,
            evictedManual: this.manualEvictions,
            evictedSet: this.setEvictions,
        };
    }

    close(): void {
        this.cache.clear();
    }
}


/**
 * Map baseline with lazy expiration and simple LRU
 *
 * This is intentionally simple (not optimized) to show baseline performance
 * without sophisticated data structures.
 */
export class MapBaselineBenchmark implements CacheBenchmark {
    private map: Map<string, MapEntry>;
    private maxEntries: number;
    private lruKeys: string[]; // Simple array-based LRU (not optimal)
    private hitCount: number = 0;
    private missCount: number = 0;
    private ttlEvictions: number = 0;
    private lruEvictions: number = 0;
    private manualEvictions: number = 0;

    constructor(config: WorkloadConfig) {
        this.map = new Map();
        this.maxEntries = config.maxEntries;
        this.lruKeys = [];
    }

    get(key: string): any {
        const entry = this.map.get(key);

        if (!entry) {
            this.missCount++;
            return undefined;
        }

        // Lazy expiration check
        if (performance.now() >= entry.deadline) {
            this.map.delete(key);
            this.removeFromLru(key);
            this.ttlEvictions++;
            this.missCount++;
            return undefined;
        }

        // Hit - update LRU
        this.hitCount++;
        this.touchLru(key);
        return entry.value;
    }

    set(key: string, value: any, ttlMs: number): void {
        // Evict if at capacity and this is a new key
        while (this.map.size >= this.maxEntries && !this.map.has(key)) {
            const oldest = this.lruKeys.shift();
            if (oldest) {
                this.map.delete(oldest);
                this.lruEvictions++;
            }
        }

        const deadline = performance.now() + ttlMs;
        this.map.set(key, { value, deadline });
        this.touchLru(key);
    }

    delete(key: string): boolean {
        const existed = this.map.has(key);
        if (existed) {
            this.map.delete(key);
            this.removeFromLru(key);
            this.manualEvictions++;
        }
        return existed;
    }

    size(): number {
        // Clean expired entries first (lazy cleanup)
        const now = performance.now();
        for (const [key, entry] of this.map) {
            if (now >= entry.deadline) {
                this.map.delete(key);
                this.removeFromLru(key);
                this.ttlEvictions++;
            }
        }
        return this.map.size;
    }

    stats(): Stats {
        return {
            size: this.map.size,
            hits: this.hitCount,
            misses: this.missCount,
            evictedTtl: this.ttlEvictions,
            evictedLru: this.lruEvictions,
            evictedManual: this.manualEvictions,
            evictedSet: 0,
        };
    }

    close(): void {
        this.map.clear();
        this.lruKeys = [];
    }

    /**
     * Touch key in LRU (move to end = most recent)
     */
    private touchLru(key: string): void {
        this.removeFromLru(key);
        this.lruKeys.push(key);
    }

    /**
     * Remove key from LRU array
     */
    private removeFromLru(key: string): void {
        const idx = this.lruKeys.indexOf(key);
        if (idx !== -1) {
            this.lruKeys.splice(idx, 1);
        }
    }
}
