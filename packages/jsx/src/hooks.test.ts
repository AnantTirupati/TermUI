// ─────────────────────────────────────────────────────
// Tests — Hooks (useAsync, useContext integration)
// ─────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    createFiber, setCurrentFiber, clearCurrentFiber,
    useState, useEffect, useRef, useCallback,
    useAsync, useInterval, setRequestRender, runEffects, destroyFiber,
    _timerPoolSize, _timerPoolClear,
    type Fiber, type AsyncState,
} from './hooks.js';

describe('useInterval — shared timer pool', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        setRequestRender(() => { });
        _timerPoolClear();
    });

    afterEach(() => {
        _timerPoolClear();
        vi.useRealTimers();
        clearCurrentFiber();
    });

    it('creates exactly one pool entry for two components sharing the same delayMs', () => {
        const fiberA = createFiber();
        const fiberB = createFiber();

        setCurrentFiber(fiberA);
        useInterval(() => { }, 500);
        clearCurrentFiber();

        setCurrentFiber(fiberB);
        useInterval(() => { }, 500);
        clearCurrentFiber();

        // Both subscribed to 500 ms → pool should have exactly 1 entry
        expect(_timerPoolSize()).toBe(1);
    });

    it('creates two pool entries for two different delays', () => {
        const fiberA = createFiber();
        const fiberB = createFiber();

        setCurrentFiber(fiberA);
        useInterval(() => { }, 250);
        clearCurrentFiber();

        setCurrentFiber(fiberB);
        useInterval(() => { }, 1000);
        clearCurrentFiber();

        expect(_timerPoolSize()).toBe(2);
    });

    it('invokes the callback on each tick', () => {
        const cb = vi.fn();
        const fiber = createFiber();

        setCurrentFiber(fiber);
        useInterval(cb, 100);
        clearCurrentFiber();

        vi.advanceTimersByTime(300);
        expect(cb).toHaveBeenCalledTimes(3);
    });

    it('removes pool entry when last subscriber is destroyed', () => {
        const fiberA = createFiber();
        const fiberB = createFiber();

        setCurrentFiber(fiberA);
        useInterval(() => { }, 500);
        clearCurrentFiber();

        setCurrentFiber(fiberB);
        useInterval(() => { }, 500);
        clearCurrentFiber();

        expect(_timerPoolSize()).toBe(1);

        destroyFiber(fiberA);
        // One subscriber still active — pool entry must remain
        expect(_timerPoolSize()).toBe(1);

        destroyFiber(fiberB);
        // No subscribers left — pool entry must be gone
        expect(_timerPoolSize()).toBe(0);
    });

    it('stops firing after destroyFiber', () => {
        const cb = vi.fn();
        const fiber = createFiber();

        setCurrentFiber(fiber);
        useInterval(cb, 100);
        clearCurrentFiber();

        vi.advanceTimersByTime(200);
        expect(cb).toHaveBeenCalledTimes(2);

        destroyFiber(fiber);
        vi.advanceTimersByTime(300);
        // No additional calls after destruction
        expect(cb).toHaveBeenCalledTimes(2);
    });

    it('uses the latest callback ref on each tick (no stale closure)', () => {
        const results: string[] = [];
        const fiber = createFiber();

        // First render
        setCurrentFiber(fiber);
        useInterval(() => results.push('first'), 100);
        clearCurrentFiber();

        vi.advanceTimersByTime(100);
        expect(results).toEqual(['first']);

        // Simulate re-render with updated callback
        fiber.hookIndex = 0;
        setCurrentFiber(fiber);
        useInterval(() => results.push('second'), 100);
        clearCurrentFiber();

        vi.advanceTimersByTime(100);
        expect(results).toEqual(['first', 'second']);

        destroyFiber(fiber);
    });
});

describe('useAsync', () => {
    let fiber: Fiber;

    beforeEach(() => {
        fiber = createFiber();
        // Mock the render function
        setRequestRender(() => { });
    });

    afterEach(() => {
        clearCurrentFiber();
    });

    it('starts in loading state', () => {
        setCurrentFiber(fiber);
        const asyncFn = vi.fn(() => new Promise<string>(() => { })); // never resolves
        const state = useAsync(asyncFn, []);
        clearCurrentFiber();

        expect(state.loading).toBe(true);
        expect(state.data).toBeNull();
        expect(state.error).toBeNull();
        expect(typeof state.refetch).toBe('function');
    });

    it('calls the async function after effects run', () => {
        setCurrentFiber(fiber);
        const asyncFn = vi.fn(() => Promise.resolve('data'));
        useAsync(asyncFn, []);
        // useAsync uses useEffect internally — effects run after render
        runEffects(fiber);
        clearCurrentFiber();

        expect(asyncFn).toHaveBeenCalledOnce();
    });

    it('provides a refetch function', () => {
        setCurrentFiber(fiber);
        const asyncFn = vi.fn(() => Promise.resolve('data'));
        const state = useAsync(asyncFn, []);
        clearCurrentFiber();

        expect(typeof state.refetch).toBe('function');
    });

    it('Fiber contextValues is initialized as empty Map', () => {
        expect(fiber.contextValues).toBeInstanceOf(Map);
        expect(fiber.contextValues.size).toBe(0);
    });

    it('Fiber parent is undefined by default', () => {
        expect(fiber.parent).toBeUndefined();
    });

    it('createFiber accepts parent parameter', () => {
        const parent = createFiber();
        const child = createFiber(parent);
        expect(child.parent).toBe(parent);
    });
});
