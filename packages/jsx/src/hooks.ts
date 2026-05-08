// ─────────────────────────────────────────────────────
// @termuijs/jsx — Hooks Engine
//
// A minimal React-like hooks runtime. Each functional
// component gets a Fiber that tracks its hook state.
// Hooks are called in order — same rules as React.
// ─────────────────────────────────────────────────────

import type { KeyEvent } from '@termuijs/core';

// ── Fiber — per-component-instance state ──

export interface Fiber {
    id: number;
    hooks: HookState[];
    hookIndex: number;
    isDirty: boolean;
    onInput?: (event: KeyEvent) => void;
    effects: EffectRecord[];
    cleanups: (() => void)[];
    intervals: ReturnType<typeof setInterval>[];
    /** Context values provided by this fiber's component */
    contextValues: Map<symbol, any>;
    /** Parent fiber for context lookup */
    parent?: Fiber;
}

interface HookState {
    value: any;
    deps?: any[];
}

interface EffectRecord {
    effect: () => void | (() => void);
    deps?: any[];
    cleanup?: () => void;
    ran: boolean;
}

// ── Module-level timer pool ──
//
// One setInterval per unique delayMs, shared across all component instances
// in this process. Reduces OS timer pressure when many components poll at
// the same interval (e.g. a hundred widgets all at 1 000 ms → 1 timer).

const _timerPool = new Map<number, { id: ReturnType<typeof setInterval>; subs: Set<() => void> }>();

function _poolSubscribe(delayMs: number, cb: () => void): () => void {
    if (!_timerPool.has(delayMs)) {
        const entry = { id: null as any, subs: new Set<() => void>() };
        entry.id = setInterval(() => {
            for (const s of entry.subs) s();
        }, delayMs);
        _timerPool.set(delayMs, entry);
    }
    _timerPool.get(delayMs)!.subs.add(cb);
    return () => {
        const entry = _timerPool.get(delayMs);
        if (!entry) return;
        entry.subs.delete(cb);
        if (entry.subs.size === 0) {
            clearInterval(entry.id);
            _timerPool.delete(delayMs);
        }
    };
}

/** @internal — exposed for testing only. Returns current pool entry count. */
export function _timerPoolSize(): number { return _timerPool.size; }

/** @internal — exposed for testing only. Drains the entire pool (call in afterEach). */
export function _timerPoolClear(): void {
    for (const entry of _timerPool.values()) clearInterval(entry.id);
    _timerPool.clear();
}

// ── Global state ──

let _currentFiber: Fiber | null = null;
let _requestRender: (() => void) | null = null;
let _nextFiberId = 0;

/** Get or throw the current fiber (hooks must be called inside a component) */
export function currentFiber(): Fiber {
    if (!_currentFiber) {
        throw new Error(
            'Hooks can only be called inside a functional component. ' +
            'Make sure you are not calling hooks outside of a render cycle.'
        );
    }
    return _currentFiber;
}

/** Set the current render context */
export function setCurrentFiber(fiber: Fiber): void {
    _currentFiber = fiber;
    fiber.hookIndex = 0; // Reset for each render pass
}

/** Clear the current render context */
export function clearCurrentFiber(): void {
    _currentFiber = null;
}

/** Create a new Fiber for a component instance */
export function createFiber(parent?: Fiber): Fiber {
    return {
        id: _nextFiberId++,
        hooks: [],
        hookIndex: 0,
        isDirty: true,
        effects: [],
        cleanups: [],
        intervals: [],
        contextValues: new Map(),
        parent,
    };
}

/** Set the requestRender callback (called by the renderer) */
export function setRequestRender(fn: () => void): void {
    _requestRender = fn;
}

// ── Batched State Updates ──

let _pendingUpdates = new Set<Fiber>();
let _flushScheduled = false;

/**
 * Schedule a re-render. Multiple setState calls within the same
 * microtask are batched into a single re-render cycle.
 */
function scheduleRender(fiber?: Fiber): void {
    if (fiber) {
        _pendingUpdates.add(fiber);
    }
    if (!_flushScheduled) {
        _flushScheduled = true;
        queueMicrotask(flushUpdates);
    }
}

/** Flush all pending state updates in a single render pass */
function flushUpdates(): void {
    _flushScheduled = false;
    _pendingUpdates.clear();
    _requestRender?.();
}

// ── Hooks ──

/**
 * useState — manage component state.
 *
 * ```tsx
 * const [count, setCount] = useState(0);
 * setCount(prev => prev + 1);
 * ```
 */
export function useState<T>(initialValue: T | (() => T)): [T, (newValue: T | ((prev: T) => T)) => void] {
    const fiber = currentFiber();
    const idx = fiber.hookIndex++;

    // Initialize on first render
    if (idx >= fiber.hooks.length) {
        const value = typeof initialValue === 'function'
            ? (initialValue as () => T)()
            : initialValue;
        fiber.hooks.push({ value });
    }

    const hookState = fiber.hooks[idx];

    const setState = (newValue: T | ((prev: T) => T)) => {
        const prev = hookState.value;
        const next = typeof newValue === 'function'
            ? (newValue as (prev: T) => T)(prev)
            : newValue;

        if (!Object.is(prev, next)) {
            hookState.value = next;
            fiber.isDirty = true;
            scheduleRender(fiber);
        }
    };

    return [hookState.value, setState];
}

/**
 * useEffect — run side effects after render.
 *
 * ```tsx
 * useEffect(() => {
 *     const sub = subscribe();
 *     return () => sub.unsubscribe(); // cleanup
 * }, [dep]);
 * ```
 */
export function useEffect(effect: () => void | (() => void), deps?: any[]): void {
    const fiber = currentFiber();
    const idx = fiber.hookIndex++;

    // Initialize or check deps
    if (idx >= fiber.hooks.length) {
        const record: EffectRecord = { effect, deps, ran: false };
        fiber.hooks.push({ value: record, deps });
        fiber.effects.push(record);
    } else {
        const prev = fiber.hooks[idx];
        const shouldRun = !deps || !prev.deps || deps.some((d, i) => !Object.is(d, prev.deps![i]));

        if (shouldRun) {
            prev.deps = deps;
            // Update the existing record in-place (avoids duplicates)
            const record = prev.value as EffectRecord;
            record.effect = effect;
            record.deps = deps;
            record.ran = false;
        }
    }
}

/**
 * useInput — handle keyboard input in the component.
 *
 * ```tsx
 * useInput((key, event) => {
 *     if (key === 'q') process.exit(0);
 *     if (key === 'up') selectPrev();
 * });
 * ```
 */
export function useInput(handler: (key: string, event: KeyEvent) => void): void {
    const fiber = currentFiber();
    fiber.onInput = (event: KeyEvent) => handler(event.key, event);
}

/**
 * useInterval — call a function at regular intervals (auto-cleans up).
 *
 * ```tsx
 * useInterval(() => {
 *     setData(fetchData());
 * }, 1000);
 * ```
 */
export function useInterval(callback: () => void, delayMs: number): void {
    const fiber = currentFiber();
    const idx = fiber.hookIndex++;

    if (idx >= fiber.hooks.length) {
        // First render: subscribe to the shared pool with a mutable callback ref
        const callbackRef = { current: callback };
        const unsub = _poolSubscribe(delayMs, () => {
            callbackRef.current();
            scheduleRender();
        });
        fiber.hooks.push({ value: { unsub, callbackRef } });
        // Register unsub in cleanups so destroyFiber unsubscribes automatically
        fiber.cleanups.push(unsub);
        // NOTE: do NOT push to fiber.intervals — unsub handles pool cleanup
    } else {
        // Re-render: update the callback ref to avoid stale closures
        fiber.hooks[idx].value.callbackRef.current = callback;
    }
}

/**
 * useMemo — memoize expensive computations.
 *
 * ```tsx
 * const sorted = useMemo(() => items.sort(), [items]);
 * ```
 */
export function useMemo<T>(factory: () => T, deps: any[]): T {
    const fiber = currentFiber();
    const idx = fiber.hookIndex++;

    if (idx >= fiber.hooks.length) {
        const value = factory();
        fiber.hooks.push({ value, deps });
        return value;
    }

    const prev = fiber.hooks[idx];
    const changed = !prev.deps || deps.some((d, i) => !Object.is(d, prev.deps![i]));

    if (changed) {
        prev.value = factory();
        prev.deps = deps;
    }

    return prev.value;
}

/**
 * useRef — mutable ref that persists across renders.
 *
 * ```tsx
 * const inputRef = useRef('');
 * inputRef.current = 'hello';
 * ```
 */
export function useRef<T>(initialValue: T): { current: T } {
    const fiber = currentFiber();
    const idx = fiber.hookIndex++;

    if (idx >= fiber.hooks.length) {
        fiber.hooks.push({ value: { current: initialValue } });
    }

    return fiber.hooks[idx].value;
}

/**
 * useCallback — memoize a callback function.
 */
export function useCallback<T extends (...args: any[]) => any>(callback: T, deps: any[]): T {
    return useMemo(() => callback, deps);
}

/** Run all pending effects for a fiber */
export function runEffects(fiber: Fiber): void {
    for (const record of fiber.effects) {
        if (!record.ran) {
            // Run cleanup from previous effect
            record.cleanup?.();
            const cleanup = record.effect();
            if (typeof cleanup === 'function') {
                record.cleanup = cleanup;
            }
            record.ran = true;
        }
    }
}

/** Clean up all effects and intervals for a fiber */
export function destroyFiber(fiber: Fiber): void {
    // Run effect cleanups
    for (const record of fiber.effects) {
        record.cleanup?.();
    }
    for (const cleanup of fiber.cleanups) {
        cleanup();
    }
    // Clear intervals
    for (const timer of fiber.intervals) {
        clearInterval(timer);
    }
    fiber.hooks = [];
    fiber.effects = [];
    fiber.cleanups = [];
    fiber.intervals = [];
    fiber.contextValues.clear();
}

// ── Async Data Hook ──

/**
 * State shape returned by useAsync.
 */
export interface AsyncState<T> {
    /** Resolved data (null while loading or on error) */
    data: T | null;
    /** True while the async function is executing */
    loading: boolean;
    /** Error object if the async function threw */
    error: Error | null;
    /** Call this to re-execute the async function */
    refetch: () => void;
}

/**
 * useAsync — load async data with automatic loading/error states.
 *
 * ```tsx
 * function UserList() {
 *     const { data, loading, error } = useAsync(() => fetchUsers(), []);
 *     if (loading) return <Text>Loading...</Text>;
 *     if (error) return <Text color="red">Error: {error.message}</Text>;
 *     return <Table rows={data} columns={['name', 'email']} />;
 * }
 * ```
 */
export function useAsync<T>(
    asyncFn: () => Promise<T>,
    deps: any[] = [],
): AsyncState<T> {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    // Track a version counter to ignore stale responses
    const versionRef = useRef(0);

    const refetch = useCallback(() => {
        const version = ++versionRef.current;
        setLoading(true);
        setError(null);

        asyncFn()
            .then((result) => {
                // Only update if this is still the latest request
                if (versionRef.current === version) {
                    setData(result);
                    setLoading(false);
                }
            })
            .catch((err) => {
                if (versionRef.current === version) {
                    setError(err instanceof Error ? err : new Error(String(err)));
                    setLoading(false);
                }
            });
    }, deps);

    useEffect(() => {
        refetch();
    }, deps);

    return { data, loading, error, refetch };
}

