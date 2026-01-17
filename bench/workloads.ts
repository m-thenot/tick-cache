import type { Operation, WorkloadConfig } from "./types";
import { seededRandom, UniformGenerator } from "./utils";

/**
 * Default seed for reproducibility
 */
const DEFAULT_SEED = 42;

/**
 * Expiration Stress Test: High Churn with Short TTL
 *
 * This is the core differentiator for timer wheel vs LRU+TTL.
 * Tests expiration mechanics under continuous churn with short TTLs.
 *
 * Pattern:
 * - TTL: 50-500ms (uniform distribution)
 * - 50% reads / 50% writes (high churn)
 * - Large keyspace (low key reuse)
 * - Continuous insertion rate
 */
export const EXPIRATION_STRESS: WorkloadConfig = {
    name: "expiration-stress",
    description: "High churn with short TTLs (50-500ms) - timer wheel stress test",
    maxEntries: 20_000,
    totalOps: 200_000, // 200k operations
    keySpace: 50_000,  // Low key reuse
    readPercent: 50,   // 50% get, 50% set
    distribution: "uniform",  // Spread evenly
    ttlMode: "variable",
    ttlMin: 50,    // 50ms
    ttlMax: 500,   // 500ms
    cacheConfig: {
        tickMs: 10,   // Fast tick for short TTLs
        wheelSize: 256,
        budgetPerTick: 10_000,
        updateTTLOnGet: false,
    },
    seed: DEFAULT_SEED,
};

/**
 * Map of all workloads by name
 */
export const WORKLOADS = new Map<string, WorkloadConfig>([
    [EXPIRATION_STRESS.name, EXPIRATION_STRESS],
]);

/**
 * Generate operation sequence for a workload
 * Pre-generates all operations for reproducibility and consistent measurement
 *
 * @param config - Workload configuration
 * @returns Array of operations to execute
 */
export function generateOperations(config: WorkloadConfig): Operation[] {
    const ops: Operation[] = [];

    // Uniform key distribution for low reuse
    const keyGen = new UniformGenerator(config.keySpace, config.seed);

    // Separate RNG for operation type and TTL
    const rng = seededRandom(config.seed + 1);

    for (let i = 0; i < config.totalOps; i++) {
        const keyIdx = keyGen.next();
        const key = `key_${keyIdx}`;
        const isRead = rng() * 100 < config.readPercent;

        if (isRead) {
            ops.push({ type: "get", key });
        } else {
            // Variable TTL in range (uniform distribution, integer)
            const ttl = Math.floor(config.ttlMin + rng() * (config.ttlMax - config.ttlMin + 1));
            const value = { id: i, data: `value_${i}` };
            ops.push({ type: "set", key, value, ttl });
        }
    }

    return ops;
}
