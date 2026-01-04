import { Options, Stats } from "./types";

export class TtlWheelCache<K extends string | number, V> {
    constructor(_options: Options<K, V>) { }

    get(_key: K): V | undefined {
        throw new Error("Not implemented");
    }
    set(_key: K, _value: V, _ttlMs: number): void {
        throw new Error("Not implemented");
    }
    has(_key: K): boolean {
        throw new Error("Not implemented");
    }
    delete(_key: K): boolean {
        throw new Error("Not implemented");
    }

    clear(): void {
        throw new Error("Not implemented");
    }
    size(): number {
        throw new Error("Not implemented");
    }

    stats(): Stats {
        throw new Error("Not implemented");
    }
    resetStats(): void {
        throw new Error("Not implemented");
    }
}
