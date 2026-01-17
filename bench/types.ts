/**
 * Cache stats (benchmark-specific, includes hits/misses)
 */
export interface Stats {
    size: number;
    hits: number;
    misses: number;
    evictedTtl: number;
    evictedLru: number;
    evictedManual: number;
    evictedSet: number;
}

/**
 * Key distribution patterns for workload generation
 */
export type Distribution = "uniform" | "zipf";

/**
 * TTL assignment modes
 */
export type TtlMode = "fixed" | "variable" | "storm";

/**
 * Cache configuration options for benchmarks
 */
export interface CacheConfig {
    tickMs: number;
    wheelSize: number;
    budgetPerTick: number;
    updateTTLOnGet: boolean;
}

/**
 * Workload configuration parameters
 */
export interface WorkloadConfig {
    name: string;
    description: string;

    // Size parameters
    maxEntries: number;      // Cache capacity
    totalOps: number;        // Total operations to perform
    keySpace: number;        // Total unique keys (key pool size)

    // Operation mix
    readPercent: number;     // 0-100, rest is writes
    deletePercent?: number;  // % of operations that are deletes (default: 0)

    // Key distribution
    distribution: Distribution;
    zipfAlpha?: number;      // Zipf parameter (1.0 = realistic hotspot)

    // TTL parameters
    ttlMode: TtlMode;
    ttlMin: number;          // milliseconds
    ttlMax: number;          // milliseconds

    // Cache configuration
    cacheConfig: CacheConfig;

    // Reproducibility
    seed: number;            // Random seed
}

/**
 * Single operation to execute
 */
export interface Operation {
    type: "get" | "set" | "delete";
    key: string;
    value?: any;
    ttl?: number;
}

/**
 * Granular operation types for tracking
 */
export type OperationType =
    | "get-hit"    // Cache hit
    | "get-miss"   // Cache miss
    | "set"        // Set operation
    | "delete";    // Delete operation

/**
 * Raw latency sample (for violin plots / CDFs)
 */
export interface LatencySample {
    timestamp: number;       // Relative time in ms from benchmark start
    nanos: number;
    operation: OperationType;
    key: string;             // Key used in the operation
}

/**
 * Latency statistics (in nanoseconds)
 */
export interface LatencyStats {
    p05: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
    p95: number;
    p99: number;
    p999: number;
    max: number;
    mean: number;
    count: number;
}

/**
 * Per-operation latency breakdown
 */
export interface OperationLatencies {
    "get-hit": LatencyStats;
    "get-miss": LatencyStats;
    "set": LatencyStats;
    "delete": LatencyStats;
    "total": LatencyStats;  // Combined stats across all operations
}

/**
 * Eviction/Expiration metrics
 */
export interface EvictionMetrics {
    ttlEvictions: number;   // Number of TTL expirations
    lruEvictions: number;   // Number of LRU evictions
    manualEvictions: number; // Number of manual evictions
    setEvictions: number; // Number of set evictions
    totalEvictions: number; // Total evictions
}

/**
 * Memory usage snapshot
 */
export interface MemorySample {
    timestamp: number;      // Relative time in ms from benchmark start
    heapUsed: number;       // Bytes
    heapTotal: number;      // Bytes
    external: number;       // Bytes
    rss: number;            // Bytes (Resident Set Size)
}

/**
 * Result from a single benchmark run
 */
export interface BenchmarkResult {
    implementation: string;  // 'ttl-wheel', 'lru-cache', 'map'
    workload: string;

    // Throughput
    totalOps: number;
    durationMs: number;
    opsPerSec: number;

    // Granular latency statistics
    latencies: OperationLatencies;

    // Raw latency samples for visualization (violin plots, CDFs)
    // Includes timestamp for latency-over-time charts
    samples: LatencySample[];

    // Cache stats
    stats: Stats;
    hitRate: number;  // hits / (hits + misses)
    missRate: number; // misses / (hits + misses)

    // Eviction metrics
    evictions: EvictionMetrics;

    // Memory tracking
    memorySamples: MemorySample[];
}

/**
 * Common interface for all cache implementations in benchmarks
 */
export interface CacheBenchmark {
    get(key: string): any;
    set(key: string, value: any, ttlMs: number): void;
    delete?(key: string): boolean;  // Optional delete support
    size(): number;
    stats(): Stats;
    close(): void;
}

/**
 * Full benchmark suite results
 */
export interface BenchmarkSuiteResult {
    workload: WorkloadConfig;
    timestamp: Date;
    results: BenchmarkResult[];
    winner?: string;  // Implementation with best p95 latency
}

/**
 * Runner options
 */
export interface RunnerOptions {
    warmupOps?: number;
    maxSamples?: number;  // Max samples per operation (default: 1000)
    verbose?: boolean;
}
