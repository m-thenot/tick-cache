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

    onEvict?: (key: K, value: V, reason: EvictReason) => void;
}
