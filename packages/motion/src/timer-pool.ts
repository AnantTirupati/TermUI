// ─────────────────────────────────────────────────────
// @termuijs/motion — Shared Interval Timer Pool
//
// One setInterval per unique delayMs, shared across all
// subscribers. Reduces OS timer pressure when many
// widgets poll at the same interval.
// ─────────────────────────────────────────────────────

const pool = new Map<number, { id: ReturnType<typeof setInterval>; subs: Set<() => void> }>();

/**
 * Subscribe a callback to a shared interval at `delayMs`.
 * Returns an unsubscribe function. The underlying setInterval
 * is created on the first subscriber and cleared automatically
 * when the last subscriber unsubscribes.
 *
 * ```ts
 * const unsub = subscribe(1000, () => console.log('tick'));
 * // later:
 * unsub();
 * ```
 */
export function subscribe(delayMs: number, cb: () => void): () => void {
    if (!pool.has(delayMs)) {
        const entry = { id: null as any, subs: new Set<() => void>() };
        entry.id = setInterval(() => {
            for (const s of entry.subs) s();
        }, delayMs);
        pool.set(delayMs, entry);
    }
    pool.get(delayMs)!.subs.add(cb);

    return () => {
        const entry = pool.get(delayMs);
        if (!entry) return;
        entry.subs.delete(cb);
        if (entry.subs.size === 0) {
            clearInterval(entry.id);
            pool.delete(delayMs);
        }
    };
}

/**
 * Drain the entire pool — clears all active intervals and removes all
 * subscribers. Useful in test teardown to prevent timer leaks.
 */
export function unsubscribeAll(): void {
    for (const entry of pool.values()) {
        clearInterval(entry.id);
    }
    pool.clear();
}
