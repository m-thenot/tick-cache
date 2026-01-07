import type { TimeSource } from "./monotone-time";

export type EvictReason = "ttl" | "lru" | "delete" | "clear";

export interface Stats {
    size: number;
    hits: number;
    misses: number;
    evictedTtl: number;
    evictedLru: number;
    evictedManual: number; // delete/clear
}

export interface Options<K extends string | number, V> {
    maxEntries: number;

    tickMs?: number;        // default 50
    wheelSize?: number;     // default 4096 (power of 2)
    updateTTLOnGet?: boolean; // default false
    budgetPerTick?: number; // default 200_000

    /**
     * When true (default), a background interval will automatically process expirations.
     * When false, expirations are only processed during cache operations (get/set/has/delete).
     * Use false to avoid background timers if you access the cache frequently enough.
     */
    passiveExpiration?: boolean; // default true

    /**
     * Optional custom time source (primarily for testing).
     * Defaults to performance.now() if not provided.
     */
    time?: TimeSource;

    onEvict?: (key: K, value: V, reason: EvictReason) => void;
}
