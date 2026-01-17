#!/usr/bin/env node

import { Command } from "commander";
import fs from "node:fs";
import type { BenchmarkResult, BenchmarkSuiteResult, CacheBenchmark, WorkloadConfig } from "./types";
import { WORKLOADS, generateOperations } from "./workloads";
import {
    TtlWheelCacheBenchmark,
    TtlWheelCacheAutopurgeBenchmark,
    LruCacheBenchmark,
    LruCacheAutopurgeBenchmark,
    TTLCacheBenchmark,
    MapBaselineBenchmark
} from "./baselines";
import { runBenchmark, determineWinner } from "./runner";

/**
 * Available implementations
 */
const IMPLEMENTATIONS = {
    "ttl-wheel": TtlWheelCacheBenchmark,
    "ttl-wheel-autopurge": TtlWheelCacheAutopurgeBenchmark,
    "lru-cache": LruCacheBenchmark,
    "lru-cache-autopurge": LruCacheAutopurgeBenchmark,
    "ttlcache": TTLCacheBenchmark,
    "map": MapBaselineBenchmark,
};

type ImplementationName = keyof typeof IMPLEMENTATIONS;

/**
 * Main CLI program
 */
const program = new Command();

program
    .name("bench")
    .description("TtlWheelCache benchmark suite - outputs JSON for Plotly visualization")
    .version("1.0.0")
    .option("-w, --workload <name>", "Run specific workload (default: all)")
    .option(
        "-i, --implementations <list>",
        "Comma-separated list: ttl-wheel,ttl-wheel-autopurge,lru-cache,lru-cache-autopurge,ttlcache,map (default: all)",
        "ttl-wheel,ttl-wheel-autopurge,lru-cache,lru-cache-autopurge,ttlcache,map"
    )
    .option("-o, --output <file>", "Output file path (default: stdout)")
    .option("--ops <number>", "Override total operations", parseInt)
    .option("--max-entries <number>", "Override max entries", parseInt)
    .option("--warmup <number>", "Warmup iterations (default: 5000)", parseInt)
    .option("--max-samples <number>", "Max samples per operation for JSON size control (default: 10000)", parseInt)
    .option("--seed <number>", "Random seed for reproducibility", parseInt)
    .option("--quiet", "Suppress progress output", false)
    .parse();

const options = program.opts();

/**
 * Log to stderr (so stdout is clean JSON)
 */
function log(...args: any[]) {
    if (!options.quiet) {
        console.error(...args);
    }
}

/**
 * Main execution
 */
async function main() {
    log("🚀 TtlWheelCache Benchmark Suite");
    log("");

    // Parse implementations
    const implNames = options.implementations
        .split(",")
        .map((s: string) => s.trim()) as ImplementationName[];

    // Validate implementations
    for (const name of implNames) {
        if (!(name in IMPLEMENTATIONS)) {
            console.error(`❌ Unknown implementation: ${name}`);
            console.error(`   Available: ${Object.keys(IMPLEMENTATIONS).join(", ")}`);
            process.exit(1);
        }
    }

    // Get workloads to run
    const workloadsToRun: WorkloadConfig[] = [];

    if (options.workload) {
        const workload = WORKLOADS.get(options.workload);
        if (!workload) {
            console.error(`❌ Unknown workload: ${options.workload}`);
            console.error(`   Available: ${Array.from(WORKLOADS.keys()).join(", ")}`);
            process.exit(1);
        }
        workloadsToRun.push(workload);
    } else {
        // Run all workloads
        workloadsToRun.push(...Array.from(WORKLOADS.values()));
    }

    // Apply overrides if specified
    if (options.ops || options.maxEntries || options.seed) {
        for (const workload of workloadsToRun) {
            if (options.ops) workload.totalOps = options.ops;
            if (options.maxEntries) workload.maxEntries = options.maxEntries;
            if (options.seed !== undefined) workload.seed = options.seed;
        }
    }

    // Run benchmarks
    const suiteResults: BenchmarkSuiteResult[] = [];
    let completedCount = 0;
    const totalRuns = workloadsToRun.length * implNames.length;

    for (const workload of workloadsToRun) {
        log(`📊 Workload: ${workload.name}`);
        log(`   ${workload.description}`);

        // Generate operations once (same for all implementations)
        const operations = generateOperations(workload);

        const results: BenchmarkResult[] = [];

        // Run each implementation
        for (const implName of implNames) {
            completedCount++;
            log(`   [${completedCount}/${totalRuns}] Running ${implName}...`);

            const ImplClass = IMPLEMENTATIONS[implName];
            const cache: CacheBenchmark = new ImplClass(workload);

            const result = await runBenchmark(
                workload,
                cache,
                implName,
                operations,
                {
                    warmupOps: options.warmup || 5000,
                    maxSamples: options.maxSamples || 10000,
                    verbose: false,
                }
            );

            results.push(result);
        }

        // Determine winner
        const winner = determineWinner(results);

        const suiteResult: BenchmarkSuiteResult = {
            workload,
            timestamp: new Date(),
            results,
            winner,
        };

        suiteResults.push(suiteResult);
        log("");
    }

    // Format as JSON
    const output = JSON.stringify(suiteResults, null, 2);

    // Write to file or stdout
    if (options.output) {
        fs.writeFileSync(options.output, output, "utf-8");
        log(`✓ Results written to ${options.output}`);
    } else {
        // Output JSON to stdout (progress was on stderr)
        console.log(output);
    }

    log("✓ Benchmark complete!");
}

// Run main and handle errors
main().catch((error) => {
    console.error("❌ Error:", error.message);
    console.error(error.stack);
    process.exit(1);
});
