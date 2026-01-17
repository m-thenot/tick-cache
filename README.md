# tick-cache

A high-performance, memory-efficient TTL cache with LRU eviction, implemented using a timer wheel algorithm.

**Why a timer wheel?** Traditional approaches like min-heaps (O(log n)) or per-entry timers (memory overhead) become inefficient with many entries and diverse TTLs. Timer wheels provide **consistent O(1) performance** for scheduling and expiration, making them ideal for caches with thousands of entries and varying expiration times, without the overhead of managing individual JavaScript timers.

## Features

- ⚡ **O(1) amortized complexity** for get/set/delete operations
- 🎯 **Precise TTL expiration** using a timer wheel
- 💾 **Memory efficient** with Structure-of-Arrays (SoA) layout
- 🔄 **LRU eviction** when cache capacity is reached
- 🎛️ **Flexible expiration modes**: active (on-access) or passive (background timer)
- 📊 **Optional sliding expiration** with `updateTTLOnGet`
- 🔧 **TypeScript native** with full type safety
- 🪝 **Disposal callbacks** for cleanup and tracking
- 🚀 **Zero dependencies** for production use

## Installation

```bash
npm install tick-cache
```

## Quick Start

```typescript
import { TtlWheelCache } from 'tick-cache';

// Create a cache with 1000 entry limit
const cache = new TtlWheelCache<string, any>({
    maxEntries: 1000,
});

// Store entries with TTL (in milliseconds)
cache.set("user:123", { name: "Alice" }, 5000); // expires in 5 seconds
cache.set("session:abc", { token: "xyz" }, 60000); // expires in 1 minute

// Retrieve entries
const user = cache.get("user:123"); // { name: "Alice" } or undefined if expired

// Check existence
if (cache.has("session:abc")) {
    console.log("Session is active");
}

// Manual deletion
cache.delete("user:123");

// Always close the cache to stop background timers
cache.close();
```

## API Reference

### Constructor Options

```typescript
interface Options<K, V> {
    maxEntries: number;           // Maximum number of entries (required)
    tickMs?: number;              // Tick interval in ms (default: 50)
    wheelSize?: number;           // Timer wheel size, power of 2 (default: 4096)
    budgetPerTick?: number;       // Max operations per tick (default: 200_000)
    updateTTLOnGet?: boolean;     // Reset TTL on access (default: false)
    ttlAutopurge?: boolean;       // Background cleanup (default: true)
    onDispose?: (key: K, value: V, reason: DisposeReason) => void;
}

type DisposeReason = "ttl" | "lru" | "delete" | "clear" | "set";
```

### Methods

#### `set(key: K, value: V, ttlMs: number): void`

Store a key-value pair with a time-to-live in milliseconds.

```typescript
cache.set("key", "value", 5000); // expires in 5 seconds
```

#### `get(key: K): V | undefined`

Retrieve a value by key. Returns `undefined` if the key doesn't exist or has expired.

```typescript
const value = cache.get("key");
```

#### `has(key: K): boolean`

Check if a key exists and is not expired.

```typescript
if (cache.has("key")) {
    // Key exists and is valid
}
```

#### `delete(key: K): boolean`

Manually delete an entry. Returns `true` if the entry existed.

```typescript
cache.delete("key");
```

#### `clear(): void`

Remove all entries from the cache.

```typescript
cache.clear();
```

#### `size(): number`

Get the current number of entries in the cache.

```typescript
console.log(cache.size()); // 42
```

#### `stats(): Stats`

Get cache statistics.

```typescript
const stats = cache.stats();
console.log(stats.size); // Current size
```

#### `close(): void`

Stop background cleanup timer. Call this when you're done using the cache to prevent memory leaks.

```typescript
cache.close();
```

## Advanced Usage

### TypeScript with Generics

```typescript
interface User {
    id: string;
    name: string;
    email: string;
}

const userCache = new TtlWheelCache<string, User>({
    maxEntries: 10000,
});

userCache.set("user:123", {
    id: "123",
    name: "Alice",
    email: "alice@example.com"
}, 300000); // 5 minutes

// TypeScript knows this is User | undefined
const user = userCache.get("user:123");
```

### Disposal Callback

Track when entries are removed from the cache:

```typescript
const cache = new TtlWheelCache({
    maxEntries: 100,
    onDispose: (key, value, reason) => {
        console.log(`Entry ${key} removed: ${reason}`);
        // reason: "ttl" | "lru" | "delete" | "clear" | "set"

        // Cleanup logic (e.g., close connections, free resources)
        if (value.connection) {
            value.connection.close();
        }
    },
});
```

### Sliding Expiration

Reset TTL on each access:

```typescript
const cache = new TtlWheelCache({
    maxEntries: 1000,
    updateTTLOnGet: true, // Reset TTL on every get()
});

cache.set("session", { user: "alice" }, 30000); // 30 seconds

// Each get() resets the TTL
cache.get("session"); // TTL reset to 30 seconds
setTimeout(() => cache.get("session"), 20000); // TTL reset again
// Entry stays alive as long as it's accessed within 30 seconds
```

### Active Expiration (No Background Timer)

For applications that frequently access the cache, disable background cleanup:

```typescript
const cache = new TtlWheelCache({
    maxEntries: 1000,
    ttlAutopurge: false, // No background timer
});

// Expirations are processed during get/set/has/delete operations
cache.get("key"); // Triggers expiration check
```

This saves CPU cycles by avoiding background timers while still maintaining correctness.

### Custom Tick Configuration

Fine-tune the timer wheel for your use case:

```typescript
const cache = new TtlWheelCache({
    maxEntries: 10000,
    tickMs: 100,        // Check every 100ms (less frequent = lower CPU)
    wheelSize: 8192,    // Larger wheel = more precise, more memory
    budgetPerTick: 500, // Limit operations per tick (prevent CPU spikes)
});
```

## Performance Characteristics

### Time Complexity

| Operation | Average | Worst Case |
|-----------|---------|------------|
| `get()`   | O(1)    | O(1)       |
| `set()`   | O(1)    | O(1)*      |
| `delete()`| O(1)    | O(1)       |
| `has()`   | O(1)    | O(1)       |

\* May trigger LRU eviction when at capacity

### Space Complexity

Memory usage per entry:
- **Metadata**: ~68 bytes (pointers, TTL, timestamps, indexes)
- **Key + Value**: Size of your JavaScript objects
- **Total**: ~68 bytes + sizeof(key) + sizeof(value)

For 10,000 entries with small keys/values: ~1.2 MB

## Timer Wheel Algorithm

This cache uses a **timer wheel with overflow** for efficient TTL management. The timer wheel is a circular buffer that divides time into fixed-size buckets, providing O(1) operations for scheduling and expiration.

### How It Works

**Conceptual Model:**
```
Time advances →

Bucket:  [0] [1] [2] [3] [4] ... [4095]
          ↑
       Current tick

Each bucket contains a doubly-linked list of entries expiring in that time slot.
```

**Scheduling an Entry (O(1)):**

When you call `cache.set(key, value, 5000)`:

1. **Calculate target tick**: `targetTick = currentTick + (5000ms / tickMs)`
   - Example: If `tickMs=50`, then `targetTick = currentTick + 100`

2. **Find bucket**: `bucketIndex = targetTick % wheelSize`
   - With `wheelSize=4096`, this wraps around circularly

3. **Link entry**: Add the entry to the doubly-linked list in that bucket
   - O(1) operation: just update `wheelNext` and `wheelPrev` pointers

**Processing Expirations (O(1) amortized):**

Every `tickMs` milliseconds (or on cache access if `ttlAutopurge=false`):

1. **Advance to current bucket**: Calculate which bucket corresponds to `now`

2. **Process bucket**: Walk the linked list of entries in that bucket
   - Each entry with `expireTick <= currentTick` is expired
   - Call `onDispose(key, value, "ttl")`
   - Remove from cache structures

3. **Budget limit**: Stop after `budgetPerTick` operations to prevent CPU spikes
   - Remaining entries are processed in the next tick
   - This prevents one huge expiration wave from blocking the event loop

**Overflow Handling:**

When TTL exceeds the wheel's time horizon (`wheelSize × tickMs`):

```
Horizon = 4096 buckets × 50ms = ~204 seconds

If TTL = 5 minutes (300,000ms):
  → Entry goes to overflow list (special bucket -2)
  → Periodically reschedule from overflow to wheel as time passes
```

### Key Properties

- **O(1) scheduling**: Adding an entry with TTL
- **O(1) amortized expiration**: Processing expired entries per tick
- **Bounded work per tick**: Configurable `budgetPerTick` prevents CPU spikes
- **Predictable latency**: No sudden pauses from processing thousands of expirations
- **Memory efficient**: Reuses bucket slots as the wheel rotates

### Example Timeline

```typescript
const cache = new TtlWheelCache({
    maxEntries: 1000,
    tickMs: 50,        // Process every 50ms
    wheelSize: 4096,   // 4096 buckets
});

// t=0: Set entries
cache.set("a", 1, 100);  // Expires at t=100ms → bucket 2
cache.set("b", 2, 250);  // Expires at t=250ms → bucket 5
cache.set("c", 3, 150);  // Expires at t=150ms → bucket 3

// t=50ms: Tick 1 - Process bucket 1 (empty)
// t=100ms: Tick 2 - Process bucket 2 (expire "a")
// t=150ms: Tick 3 - Process bucket 3 (expire "c")
// t=250ms: Tick 5 - Process bucket 5 (expire "b")
```

## Architecture

### Structure-of-Arrays (SoA)

Data is stored in separate typed arrays for optimal CPU cache usage:

```typescript
// Instead of Array<{key, value, ttl, next, prev}>
// We use:
keyRef: Array<K>
valRef: Array<V>
expiresTick: Uint32Array
wheelNext: Int32Array
wheelPrev: Int32Array
lruNext: Int32Array
lruPrev: Int32Array
```

This layout improves:
- **Cache locality**: Related data is contiguous in memory
- **Memory efficiency**: Typed arrays are compact
- **Iteration speed**: SIMD-friendly for modern CPUs


## FAQ

### Is this a hierarchical timer wheel?

No, this implementation uses a **single-level timer wheel with overflow**. Hierarchical timer wheels (with multiple levels like seconds/minutes/hours) could handle very long TTLs more efficiently but add complexity.

The current design:
- Single wheel with configurable size (default 4096 buckets)
- Overflow list for TTLs beyond the wheel horizon
- Works well for TTLs up to ~49 days

A hierarchical implementation could be added in future development if there's demand for more efficient handling of very long TTLs (months/years).

### When should I use `ttlAutopurge: false`?

When your application frequently accesses the cache (e.g., every few milliseconds), active expiration is more efficient than background timers. Expirations will be processed during cache operations.

### How does LRU eviction work with TTL?

When the cache reaches `maxEntries`, the least recently used entry is evicted to make room for new entries. TTL and LRU work together: entries can be removed either by expiring (TTL) or by being evicted (LRU).

### What's the maximum TTL?

The practical maximum is ~2^32 milliseconds (~49 days) due to Uint32Array for tick storage. For longer TTLs, consider using a different caching strategy.

### How do I monitor cache performance?

Use the `onDispose` callback to track evictions:

```typescript
const metrics = { ttl: 0, lru: 0, set: 0 };

const cache = new TtlWheelCache({
    maxEntries: 1000,
    onDispose: (key, value, reason) => {
        metrics[reason]++;
    },
});
```

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run benchmarks
npm run bench

# Build
npm run build
```

## License

MIT

