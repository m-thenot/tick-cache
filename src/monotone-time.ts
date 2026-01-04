import { performance } from "node:perf_hooks";

export interface TimeSource {
    nowMs(): number;
}

export class PerfTimeSource implements TimeSource {
    nowMs(): number {
        return performance.now();
    }
}

/**
 * Converts monotonic milliseconds into discrete ticks.
 * tick = floor(nowMs / tickMs)
 */
export class MonotoneTicker {
    public readonly tickMs: number;
    private readonly time: TimeSource;

    constructor(opts: { tickMs: number; time?: TimeSource }) {
        if (!Number.isFinite(opts.tickMs) || opts.tickMs <= 0) {
            throw new Error("tickMs must be > 0");
        }
        this.tickMs = opts.tickMs;
        this.time = opts.time ?? new PerfTimeSource();
    }

    nowTick(): number {
        const ms = this.time.nowMs();
        return Math.floor(ms / this.tickMs);
    }
}
