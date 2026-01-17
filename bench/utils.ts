/**
 * Seeded random number generator (Mulberry32)
 * Returns numbers in [0, 1)
 *
 * @param seed - Integer seed value
 * @returns Function that generates next random number
 */
export function seededRandom(seed: number): () => number {
    return function() {
        seed |= 0;
        seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

/**
 * Zipf distribution generator for realistic key access patterns.
 *
 * Alpha = 1.0 is typical (80/20 rule)
 * Alpha = 1.5 is more skewed (90/10)
 *
 * Lower-numbered items are accessed more frequently.
 */
export class ZipfGenerator {
    private cumulative: number[];
    private rng: () => number;
    private n: number;

    /**
     * @param n - Total number of items (key space size)
     * @param alpha - Skew parameter (1.0 = realistic, 1.5 = very skewed)
     * @param seed - Random seed for reproducibility
     */
    constructor(n: number, alpha: number, seed: number) {
        this.n = n;
        this.rng = seededRandom(seed);

        // Precompute cumulative probabilities
        this.cumulative = new Array(n);
        let sum = 0;
        for (let i = 1; i <= n; i++) {
            sum += 1 / Math.pow(i, alpha);
        }

        let cumulativeSum = 0;
        for (let i = 0; i < n; i++) {
            cumulativeSum += (1 / Math.pow(i + 1, alpha)) / sum;
            this.cumulative[i] = cumulativeSum;
        }
    }

    /**
     * Generate next key index (0 to n-1)
     * Lower indices are more likely
     */
    next(): number {
        const rand = this.rng();

        // Binary search in cumulative array
        let left = 0;
        let right = this.cumulative.length - 1;

        while (left < right) {
            const mid = Math.floor((left + right) / 2);
            if (this.cumulative[mid] < rand) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }

        return left;
    }
}

/**
 * Uniform distribution generator
 */
export class UniformGenerator {
    private rng: () => number;
    private n: number;

    /**
     * @param n - Total number of items (key space size)
     * @param seed - Random seed for reproducibility
     */
    constructor(n: number, seed: number) {
        this.n = n;
        this.rng = seededRandom(seed);
    }

    /**
     * Generate next key index (0 to n-1)
     * All indices are equally likely
     */
    next(): number {
        return Math.floor(this.rng() * this.n);
    }
}

/**
 * Format a number with thousand separators
 * @param n - Number to format
 * @returns Formatted string (e.g., "125,430")
 */
export function formatNumber(n: number): string {
    return n.toLocaleString('en-US');
}

/**
 * Format latency in appropriate unit (ns, μs, or ms)
 * @param nanos - Latency in nanoseconds
 * @returns Formatted string with unit
 */
export function formatLatency(nanos: number): string {
    if (nanos < 1000) {
        return `${nanos.toFixed(0)} ns`;
    } else if (nanos < 1_000_000) {
        return `${(nanos / 1000).toFixed(1)} μs`;
    } else {
        return `${(nanos / 1_000_000).toFixed(2)} ms`;
    }
}

/**
 * Format percentage
 * @param ratio - Value between 0 and 1
 * @returns Formatted string (e.g., "78.4%")
 */
export function formatPercent(ratio: number): string {
    return `${(ratio * 100).toFixed(1)}%`;
}

/**
 * Format bytes in human-readable form
 * @param bytes - Number of bytes
 * @returns Formatted string (e.g., "12.4 MB")
 */
export function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes.toFixed(0)} B`;
    } else if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    } else if (bytes < 1024 * 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    } else {
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
}

/**
 * Calculate mean of an array of numbers
 */
export function mean(values: number[]): number {
    if (values.length === 0) return 0;
    const sum = values.reduce((acc, val) => acc + val, 0);
    return sum / values.length;
}

/**
 * Sleep for specified milliseconds (for warmup delays)
 */
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
