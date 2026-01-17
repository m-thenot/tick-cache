import type { LatencyStats, OperationType, OperationLatencies, LatencySample } from "./types";
import { mean } from "./utils";


const DEFAULT_STATS: LatencyStats = {
    p05: 0,
    p25: 0,
    p50: 0,
    p75: 0,
    p90: 0,
    p95: 0,
    p99: 0,
    p999: 0,
    max: 0,
    mean: 0,
    count: 0,
}

/**
 * Latency histogram for tracking operation latencies and calculating percentiles.
 *
 * Uses bucketing strategy (pure TypeScript, no native addons):
 * - Stores raw samples for accurate percentile calculation
 * - Computes percentiles on-demand
 */
export class LatencyHistogram {
    private samples: bigint[];
    private sorted: boolean;

    constructor() {
        this.samples = [];
        this.sorted = false;
    }

    /**
     * Record a latency sample
     * @param nanos - Latency in nanoseconds (from process.hrtime.bigint())
     */
    record(nanos: bigint): void {
        this.samples.push(nanos);
        this.sorted = false;
    }

    /**
     * Get number of samples recorded
     */
    count(): number {
        return this.samples.length;
    }

    /**
     * Reset all samples
     */
    reset(): void {
        this.samples = [];
        this.sorted = false;
    }

    /**
     * Calculate a specific percentile
     * @param p - Percentile (0.50 for p50, 0.95 for p95, etc.)
     * @returns Latency in nanoseconds
     */
    percentile(p: number): number {
        if (this.samples.length === 0) return 0;

        this.ensureSorted();

        const index = Math.ceil(p * this.samples.length) - 1;
        const clampedIndex = Math.max(0, Math.min(index, this.samples.length - 1));

        return Number(this.samples[clampedIndex]);
    }

    /**
     * Get maximum latency
     */
    max(): number {
        if (this.samples.length === 0) return 0;
        this.ensureSorted();
        return Number(this.samples[this.samples.length - 1]);
    }

    /**
     * Calculate mean latency
     */
    mean(): number {
        if (this.samples.length === 0) return 0;
        const numericSamples = this.samples.map(s => Number(s));
        return mean(numericSamples);
    }

    /**
     * Get comprehensive latency statistics
     */
    stats(): LatencyStats {
        return {
            p05: this.percentile(0.05),
            p25: this.percentile(0.25),
            p50: this.percentile(0.50),
            p75: this.percentile(0.75),
            p90: this.percentile(0.90),
            p95: this.percentile(0.95),
            p99: this.percentile(0.99),
            p999: this.percentile(0.999),
            max: this.max(),
            mean: this.mean(),
            count: this.count(),
        };
    }

    /**
     * Get all raw samples (for violin plots / CDFs)
     * @returns Array of latency samples in nanoseconds
     */
    getSamples(): number[] {
        return this.samples.map(s => Number(s));
    }

    /**
     * Ensure samples are sorted for percentile calculations
     */
    private ensureSorted(): void {
        if (this.sorted) return;

        this.samples.sort((a, b) => {
            if (a < b) return -1;
            if (a > b) return 1;
            return 0;
        });

        this.sorted = true;
    }
}

/**
 * Measure the duration of a synchronous function
 * @param fn - Function to measure
 * @returns Duration in nanoseconds
 */
export function measureSync<T>(fn: () => T): { result: T; duration: bigint } {
    const start = process.hrtime.bigint();
    const result = fn();
    const end = process.hrtime.bigint();
    const duration = end - start;

    return { result, duration };
}

/**
 * Measure the duration of an asynchronous function
 * @param fn - Async function to measure
 * @returns Duration in nanoseconds
 */
export async function measureAsync<T>(
    fn: () => Promise<T>
): Promise<{ result: T; duration: bigint }> {
    const start = process.hrtime.bigint();
    const result = await fn();
    const end = process.hrtime.bigint();
    const duration = end - start;

    return { result, duration };
}

/**
 * Multi-histogram tracker for per-operation-type latency tracking
 */
export class MultiHistogram {
    private histograms: Map<OperationType, LatencyHistogram>;
    private timestamps: Map<OperationType, number[]> = new Map();
    private keys: Map<OperationType, string[]> = new Map();
    private maxSamplesPerOperation: number;

    constructor(maxSamplesPerOperation: number = 10000) {
        this.histograms = new Map();
        this.maxSamplesPerOperation = maxSamplesPerOperation;
        // Initialize all operation types
        const types: OperationType[] = [
            "get-hit",
            "get-miss",
            "set",
            "delete",
        ];
        for (const type of types) {
            this.histograms.set(type, new LatencyHistogram());
            this.timestamps.set(type, []);
            this.keys.set(type, []);
        }
    }

    /**
     * Record a latency sample for a specific operation type
     * @param operation - Operation type
     * @param nanos - Latency in nanoseconds
     * @param timestamp - Relative timestamp in ms from benchmark start
     * @param key - Key used in the operation
     */
    record(operation: OperationType, nanos: bigint, timestamp: number, key: string): void {
        const histogram = this.histograms.get(operation);
        if (histogram) {
            histogram.record(nanos);
        }
        // Store timestamp and key for visualization - use push() for O(1) instead of spread O(n)
        const timestamps = this.timestamps.get(operation);
        const keys = this.keys.get(operation);
        if (timestamps) {
            timestamps.push(timestamp);
        }
        if (keys) {
            keys.push(key);
        }
    }

    /**
     * Get stats for a specific operation type
     */
    getStats(operation: OperationType): LatencyStats {
        const histogram = this.histograms.get(operation);
        if (!histogram || histogram.count() === 0) {
            return DEFAULT_STATS;
        }
        return histogram.stats();
    }

    /**
     * Get stats for all operation types, including combined "total" stats
     */
    getAllStats(): OperationLatencies {
        // Calculate individual operation stats
        const getHit = this.getStats("get-hit");
        const getMiss = this.getStats("get-miss");
        const set = this.getStats("set");
        const del = this.getStats("delete");

        // Combine all samples to calculate total stats
        const totalHistogram = new LatencyHistogram();
        for (const histogram of this.histograms.values()) {
            const samples = histogram.getSamples();
            for (const sample of samples) {
                totalHistogram.record(BigInt(sample));
            }
        }

        return {
            "get-hit": getHit,
            "get-miss": getMiss,
            "set": set,
            "delete": del,
            "total": totalHistogram.count() > 0 ? totalHistogram.stats() : {
                ...DEFAULT_STATS,
            },
        };
    }

    /**
     * Get all raw samples for visualization (with timestamps and keys)
     * Samples are downsampled if they exceed maxSamplesPerOperation
     * Downsampling uses MAX aggregation to preserve spike detection
     */
    getAllSamples(): LatencySample[] {
        const samples: LatencySample[] = [];
        for (const [operation, histogram] of this.histograms.entries()) {
            const rawSamples = histogram.getSamples();
            const timestamps = this.timestamps.get(operation) || [];
            const keys = this.keys.get(operation) || [];

            // Downsample if we have too many samples
            const totalSamples = rawSamples.length;
            if (totalSamples > this.maxSamplesPerOperation) {
                // Aggregate by MAX in buckets to preserve spikes
                const bucketSize = Math.ceil(totalSamples / this.maxSamplesPerOperation);

                for (let i = 0; i < totalSamples; i += bucketSize) {
                    const bucketEnd = Math.min(i + bucketSize, totalSamples);

                    // Find max latency in this bucket
                    let maxNanos = rawSamples[i];
                    let maxIdx = i;
                    for (let j = i + 1; j < bucketEnd; j++) {
                        if (rawSamples[j] > maxNanos) {
                            maxNanos = rawSamples[j];
                            maxIdx = j;
                        }
                    }

                    // Use timestamp and key of the max sample
                    samples.push({
                        timestamp: timestamps[maxIdx] || 0,
                        nanos: maxNanos,
                        operation,
                        key: keys[maxIdx] || ""
                    });
                }
            } else {
                // Keep all samples
                for (let i = 0; i < rawSamples.length; i++) {
                    samples.push({
                        timestamp: timestamps[i] || 0,
                        nanos: rawSamples[i],
                        operation,
                        key: keys[i] || ""
                    });
                }
            }
        }
        return samples;
    }

    /**
     * Reset all histograms
     */
    reset(): void {
        for (const histogram of this.histograms.values()) {
            histogram.reset();
        }
    }
}
