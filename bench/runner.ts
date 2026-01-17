import type {
    BenchmarkResult,
    CacheBenchmark,
    Operation,
    WorkloadConfig,
    RunnerOptions,
} from "./types";
import { MultiHistogram } from "./latency";
import { sleep } from "./utils";

/**
 * Run a benchmark for a single cache implementation
 *
 * @param workload - Workload configuration
 * @param implementation - Cache implementation to benchmark
 * @param implName - Name of implementation (for result)
 * @param operations - Pre-generated operation sequence
 * @param options - Runner options
 * @returns Benchmark result
 */
export async function runBenchmark(
    workload: WorkloadConfig,
    implementation: CacheBenchmark,
    implName: string,
    operations: Operation[],
    options: RunnerOptions = {}
): Promise<BenchmarkResult> {
    const {
        warmupOps = 5000,
        maxSamples = 10000,
        verbose = false,
    } = options;

    if (verbose) {
        console.error(`  Running ${implName}...`);
    }

    // Initialize tracking structures
    const multiHistogram = new MultiHistogram(maxSamples);
    const memorySamples: Array<{ timestamp: number; heapUsed: number; heapTotal: number; external: number; rss: number }> = [];

    // Phase 1: Warmup (no measurement)
    if (verbose) {
        console.error(`    Warming up (${warmupOps} ops)...`);
    }
    await warmup(implementation, operations, warmupOps);

    // Allow background timers to settle
    await sleep(100);

    // Phase 2: Force GC to establish clean baseline
    // This ensures we start measurement from a consistent heap state across all runs.
    // Warmup phase may have created temporary objects that should be collected before
    // measuring steady-state performance. Without GC, first-run measurements would
    // include GC overhead from warmup allocations, creating inconsistent results.
    if (typeof global.gc === "function") {
        global.gc();
    }

    // Phase 3: Measurement (steady state)
    if (verbose) {
        console.error(`    Measuring (${operations.length} ops)...`);
    }

    // Capture initial stats to calculate eviction deltas
    const statsBeforeMeasurement = implementation.stats();

    const startTime = Date.now();
    let currentTime = 0;
    let lastMemSampleTime = 0;

    for (const op of operations) {
        currentTime = Date.now() - startTime;

        // Sample memory usage every 1ms
        if (currentTime - lastMemSampleTime >= 1) {
            const mem = process.memoryUsage();
            memorySamples.push({
                timestamp: currentTime,
                heapUsed: mem.heapUsed,
                heapTotal: mem.heapTotal,
                external: mem.external,
                rss: mem.rss,
            });
            lastMemSampleTime = currentTime;
        }

        if (op.type === "get") {
            const start = process.hrtime.bigint();
            const result = implementation.get(op.key);
            const end = process.hrtime.bigint();
            const duration = end - start;

            // Distinguish hit vs miss
            if (result !== undefined) {
                multiHistogram.record("get-hit", duration, currentTime, op.key);
            } else {
                multiHistogram.record("get-miss", duration, currentTime, op.key);
            }
        } else if (op.type === "set") {
            const start = process.hrtime.bigint();
            implementation.set(op.key, op.value!, op.ttl!);
            const end = process.hrtime.bigint();
            multiHistogram.record("set", end - start, currentTime, op.key);
        } else if (op.type === "delete" && implementation.delete) {
            const start = process.hrtime.bigint();
            implementation.delete(op.key);
            const end = process.hrtime.bigint();
            multiHistogram.record("delete", end - start, currentTime, op.key);
        }
    }

    const endTime = Date.now();
    const durationMs = endTime - startTime;

    // Phase 4: Collect stats
    const stats = implementation.stats();
    const totalGets = stats.hits + stats.misses;
    const hitRate = totalGets > 0 ? stats.hits / totalGets : 0;
    const missRate = totalGets > 0 ? stats.misses / totalGets : 0;

    // Calculate eviction deltas during measurement phase
    const ttlEvictions = stats.evictedTtl - statsBeforeMeasurement.evictedTtl;
    const lruEvictions = stats.evictedLru - statsBeforeMeasurement.evictedLru;
    const manualEvictions = stats.evictedManual - statsBeforeMeasurement.evictedManual;
    const setEvictions = stats.evictedSet - statsBeforeMeasurement.evictedSet;
    const totalEvictions = ttlEvictions + lruEvictions + manualEvictions + setEvictions;

    // Phase 5: Cleanup
    implementation.close();

    // Phase 6: Build result
    const result: BenchmarkResult = {
        implementation: implName,
        workload: workload.name,
        totalOps: operations.length,
        durationMs,
        opsPerSec: (operations.length / durationMs) * 1000,
        latencies: multiHistogram.getAllStats(),
        samples: multiHistogram.getAllSamples(),
        stats,
        hitRate,
        missRate,
        evictions: {
            ttlEvictions,
            lruEvictions,
            manualEvictions,
            setEvictions,
            totalEvictions,
        },
        memorySamples,
    };

    return result;
}

/**
 * Warmup phase - execute operations without measurement
 *
 * @param cache - Cache implementation
 * @param operations - Operation sequence
 * @param count - Number of warmup operations
 */
async function warmup(
    cache: CacheBenchmark,
    operations: Operation[],
    count: number
): Promise<void> {
    const warmupOps = Math.min(count, operations.length);

    for (let i = 0; i < warmupOps; i++) {
        const op = operations[i % operations.length];
        if (op.type === "get") {
            cache.get(op.key);
        } else if (op.type === "set") {
            cache.set(op.key, op.value!, op.ttl!);
        } else if (op.type === "delete" && cache.delete) {
            cache.delete(op.key);
        }
    }
}


/**
 * Determine the winner based on a composite latency score
 *
 * Winner = lowest composite score combining median and tail latency
 *
 * Score = p50 * 0.3 + p99 * 0.7
 *
 * This weighs tail latency (p99) more heavily than median (p50), ensuring
 * the winner has both good typical performance AND good worst-case performance.
 * Unlike a simple ratio, this considers absolute latency values, preventing
 * slow-but-consistent implementations from winning.
 */
export function determineWinner(results: BenchmarkResult[]): string | undefined {
    if (results.length === 0) return undefined;

    let best = results[0];
    const totalLatency = best.latencies["total"];
    let bestScore = totalLatency.p50 * 0.3 + totalLatency.p99 * 0.7;

    for (const result of results) {
        const latency = result.latencies["total"];

        // Calculate composite score: 30% p50 (median), 70% p99 (tail)
        // Lower score = better overall performance
        const score = latency.p50 * 0.3 + latency.p99 * 0.7;

        if (score < bestScore) {
            best = result;
            bestScore = score;
        }
    }

    return best.implementation;
}
