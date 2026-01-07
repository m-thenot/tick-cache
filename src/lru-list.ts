import { EntryStore, EntryId } from "./entry-store";
import { NIL } from "./constants";

/**
 * LruList manages a doubly-linked list of entry IDs for LRU eviction.
 * Uses the EntryStore's lruNext and lruPrev arrays for O(1) operations.
 */
export class LruList<K, V> {
    private readonly store: EntryStore<K, V>;
    private head: EntryId;
    private tail: EntryId;

    constructor(store: EntryStore<K, V>) {
        this.store = store;
        this.head = NIL;
        this.tail = NIL;
    }

    /**
     * Link an entry to the head of the LRU list (most recent position).
     */
    linkHead(id: EntryId): void {
        const oldHead = this.head;

        this.store.lruNext[id] = oldHead;
        this.store.lruPrev[id] = NIL;

        if (oldHead !== NIL) {
            // Update old head's prev pointer
            this.store.lruPrev[oldHead] = id;
        } else {
            // List was empty, this is also the tail
            this.tail = id;
        }

        this.head = id;
    }

    /**
     * Remove an entry from the LRU list.
     */
    unlink(id: EntryId): void {
        const prev = this.store.lruPrev[id];
        const next = this.store.lruNext[id];

        if (prev !== NIL) {
            this.store.lruNext[prev] = next;
        } else {
            // Entry was the head
            this.head = next;
        }

        if (next !== NIL) {
            this.store.lruPrev[next] = prev;
        } else {
            // Entry was the tail
            this.tail = prev;
        }

        // Clear pointers
        this.store.lruNext[id] = NIL;
        this.store.lruPrev[id] = NIL;
    }

    /**
     * Move an entry to the head (mark as recently used).
     * Optimization: if already at head, does nothing.
     */
    touch(id: EntryId): void {
        // Optimization: if already at head, nothing to do
        if (this.head === id) {
            return;
        }

        this.unlink(id);
        this.linkHead(id);
    }

    /**
     * Get the tail (least recently used) entry ID.
     * Returns NIL if the list is empty.
     */
    getTail(): EntryId {
        return this.tail;
    }

    /**
     * Check if the list is empty.
     */
    isEmpty(): boolean {
        return this.head === NIL;
    }

    /**
     * Reset the list to empty state.
     */
    reset(): void {
        this.head = NIL;
        this.tail = NIL;
    }
}
