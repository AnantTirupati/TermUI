// ─────────────────────────────────────────────────────
// @termuijs/jsx — Reconciler
//
// Converts VNode trees into real Widget trees.
// On re-render, diffs the old and new VNode trees
// and applies minimal Widget mutations.
// ─────────────────────────────────────────────────────

import { Box, Text, Widget, ProgressBar, Grid, Skeleton } from '@termuijs/widgets';
import type { Style, Color } from '@termuijs/core';
import type { VNode, VElement, FC } from './vnode.js';
import { isVElement, isVFragment, Fragment, flattenChildren } from './vnode.js';
import {
    createFiber, setCurrentFiber, clearCurrentFiber,
    runEffects, destroyFiber, type Fiber,
} from './hooks.js';
import { ErrorBoundary } from './error-boundary.js';

// ── Component instance tracking ──

interface ComponentInstance {
    fiber: Fiber;
    component: FC<any>;
    props: Record<string, any>;
    children: VNode[];
    widget: Widget;
    childInstances: ComponentInstance[];
    lastVNode: VNode;
}

const _instanceMap = new Map<Widget, ComponentInstance>();
// Expose globally so render() and @termuijs/testing can dispatch to useInput handlers
(globalThis as any).__termuijs_instances = _instanceMap;

// ── Parent fiber tracking ──
// Tracks the currently-rendering fiber so child components
// can inherit the parent reference for context lookups.
let _parentFiber: Fiber | undefined = undefined;

// ── Intrinsic element mapping ──

/**  Map a string tag name to a Widget constructor call */
function createIntrinsicWidget(tag: string, props: Record<string, any>, children: VNode[]): Widget {
    const style = extractStyle(props);

    switch (tag.toLowerCase()) {
        case 'box': {
            const box = new Box({
                flexDirection: props.flexDirection ?? 'column',
                ...style,
            });
            return box;
        }

        case 'text': {
            // Children of Text are concatenated as content
            const content = children
                .map(c => (c == null || typeof c === 'boolean') ? '' : String(c))
                .join('');
            return new Text(content, {
                height: props.height ?? 1,
                ...style,
                bold: props.bold,
                dim: props.dim,
                italic: props.italic,
                fg: parseColorProp(props.color),
            }, { align: props.align });
        }

        case 'row': {
            return new Box({
                flexDirection: 'row',
                gap: props.gap ?? 1,
                ...style,
            });
        }

        case 'col':
        case 'column': {
            return new Box({
                flexDirection: 'column',
                ...style,
            });
        }

        case 'spacer': {
            return new Box({ flexGrow: props.grow ?? 1 });
        }

        case 'divider': {
            const char = props.char ?? '─';
            const color = parseColorProp(props.color) ?? { type: 'named' as const, name: 'brightBlack' as const };
            return new Text(char.repeat(200), {
                height: 1,
                fg: color,
                dim: true,
            });
        }

        case 'progressbar': {
            return new ProgressBar(style, {
                value:       typeof props.value === 'number' ? props.value : 0,
                fillChar:    props.fillChar,
                emptyChar:   props.emptyChar,
                fillColor:   props.fillColor ? parseColorProp(props.fillColor) : undefined,
                showLabel:   props.showLabel !== false,
                labelFormat: props.labelFormat,
            });
        }

        case 'grid': {
            return new Grid({ ...style }, {
                columns: props.columns ?? 12,
                gap:     props.gap,
                rowGap:  props.rowGap,
                colGap:  props.colGap,
            });
        }

        case 'skeleton': {
            return new Skeleton({ ...style }, {
                variant:    props.variant,
                intervalMs: props.intervalMs,
                chars:      props.chars,
            });
        }

        default: {
            // Unknown tag — create a Box wrapper
            return new Box({ ...style });
        }
    }
}

/** Extract style-related props */
function extractStyle(props: Record<string, any>): Partial<Style> {
    const style: Partial<Style> = {};
    if (props.flexGrow != null) style.flexGrow = props.flexGrow;
    if (props.flexShrink != null) style.flexShrink = props.flexShrink;
    if (props.width != null) style.width = props.width;
    if (props.height != null) style.height = props.height;
    if (props.padding != null) style.padding = props.padding;
    if (props.margin != null) style.margin = props.margin;
    if (props.border != null) style.border = props.border;
    if (props.borderColor != null) style.borderColor = parseColorProp(props.borderColor);
    if (props.gap != null) style.gap = props.gap;
    return style;
}

/** Parse a color prop — accepts a string name or a Color object */
function parseColorProp(value: any): Color | undefined {
    if (!value) return undefined;
    if (typeof value === 'string') {
        return { type: 'named', name: value as any };
    }
    return value as Color;
}

// ── Reconciler ──

/**
 * Render a VNode tree into a real Widget tree.
 * This is called on every re-render cycle.
 */
export function reconcile(vnode: VNode, parentWidget?: Widget): Widget {
    // Null / boolean / undefined → empty box
    if (vnode == null || typeof vnode === 'boolean') {
        return new Box({ width: 0, height: 0 });
    }

    // String or number → Text widget
    if (typeof vnode === 'string' || typeof vnode === 'number') {
        return new Text(String(vnode), { height: 1 });
    }

    // Fragment — wrap children in a Box
    if (isVFragment(vnode)) {
        const box = new Box({ flexDirection: 'column' });
        for (const child of vnode.children) {
            box.addChild(reconcile(child, box));
        }
        return box;
    }

    // VElement
    if (isVElement(vnode)) {
        const { type, props, children } = vnode;

        // Functional component
        if (typeof type === 'function') {
            return renderComponent(type, props, children);
        }

        // Intrinsic element (string tag)
        const widget = createIntrinsicWidget(type, props, children);

        // Add children (except for Text, which handles content inline)
        if (type.toLowerCase() !== 'text') {
            for (const child of children) {
                widget.addChild(reconcile(child, widget));
            }
        }

        return widget;
    }

    // Fallback
    return new Box({ width: 0, height: 0 });
}

// ── ErrorBoundary helpers ──

/** Walk the fiber parent chain looking for the nearest error boundary */
function findErrorBoundary(fiber: Fiber): Fiber | undefined {
    let f: Fiber | undefined = fiber.parent;
    while (f) {
        if (f.isErrorBoundary) return f;
        f = f.parent;
    }
    return undefined;
}

/** Default fallback VNode shown when no ErrorBoundary is present */
function defaultErrorVNode(err: Error): VNode {
    return {
        type: 'box',
        props: { border: 'single', borderColor: 'red', padding: 1 },
        children: [
            { type: 'text', props: { color: 'red', bold: true }, children: ['Error'] },
            { type: 'text', props: {}, children: [err.message] },
        ],
    } as any;
}

/**
 * Render a functional component — set up fiber, call the function, reconcile output.
 * Component render errors are caught and routed to the nearest ErrorBoundary.
 */
function renderComponent(
    component: FC<any>,
    props: Record<string, any>,
    children: VNode[],
): Widget {
    const fiber = createFiber(_parentFiber);

    // Mark ErrorBoundary fibers so the error handler can find them
    if (component === ErrorBoundary) {
        fiber.isErrorBoundary = true;
        const fallbackFn = props.fallback as ((err: Error) => VNode) | undefined;
        const onError = props.onError as ((err: Error) => void) | undefined;
        fiber.errorFallback = (err: Error) => {
            onError?.(err);
            return fallbackFn ? fallbackFn(err) : defaultErrorVNode(err);
        };
    }

    // Push this fiber as the parent for any child components
    const prevParent = _parentFiber;
    _parentFiber = fiber;

    // Set the current fiber context for hooks
    setCurrentFiber(fiber);

    // Call the component function — catch any render-time errors
    let vnode: VNode;
    try {
        vnode = component({ ...props, children: children.length === 1 ? children[0] : children });
    } catch (err) {
        clearCurrentFiber();
        _parentFiber = prevParent;
        const error = err instanceof Error ? err : new Error(String(err));
        const boundary = findErrorBoundary(fiber);
        if (boundary?.errorFallback) {
            const fallbackVNode = boundary.errorFallback(error);
            return reconcile(fallbackVNode);
        }
        // No boundary found — show default error widget and log
        console.error('[TermUI] Unhandled component error:', error);
        return reconcile(defaultErrorVNode(error));
    }

    clearCurrentFiber();

    // Reconcile the returned VNode into a real widget
    const widget = reconcile(vnode);

    // Restore parent fiber
    _parentFiber = prevParent;

    // Run effects after render
    runEffects(fiber);

    // Store instance for cleanup and re-renders
    _instanceMap.set(widget, {
        fiber,
        component,
        props,
        children,
        widget,
        childInstances: [],
        lastVNode: vnode,
    });

    return widget;
}

/**
 * Recursively remove _instanceMap entries for a widget and all its descendants.
 * This prevents stale child instances from accumulating across re-renders.
 */
function _pruneInstancesForWidget(widget: Widget): void {
    _instanceMap.delete(widget);
    const children = (widget as any)._children ?? (widget as any).children ?? [];
    if (Array.isArray(children)) {
        for (const child of children) {
            _pruneInstancesForWidget(child);
        }
    }
}

/**
 * Re-render a component (called when useState triggers a state change).
 */
export function reRenderComponent(instance: ComponentInstance): Widget {
    const { fiber, component, props, children } = instance;

    // Push this fiber as the parent for any child components
    const prevParent = _parentFiber;
    _parentFiber = fiber;

    setCurrentFiber(fiber);

    // Call the component function — catch any render-time errors (same as renderComponent)
    let vnode: VNode;
    try {
        vnode = component({ ...props, children: children.length === 1 ? children[0] : children });
    } catch (rawErr) {
        clearCurrentFiber();
        _parentFiber = prevParent;
        const err = rawErr instanceof Error ? rawErr : new Error(String(rawErr));
        const boundary = findErrorBoundary(fiber);
        if (boundary?.errorFallback) {
            return reconcile(boundary.errorFallback(err));
        }
        console.error('[TermUI] Unhandled component error:', err);
        return reconcile(defaultErrorVNode(err));
    }

    clearCurrentFiber();

    // memo() optimization: if component returned same VNode reference, skip widget rebuild
    if (vnode === instance.lastVNode) {
        _parentFiber = prevParent;
        runEffects(fiber);
        fiber.isDirty = false;
        return instance.widget;
    }

    // For simplicity in v1, rebuild the widget tree
    // TODO: Smart diffing in a future version
    const newWidget = reconcile(vnode);

    // Restore parent fiber
    _parentFiber = prevParent;

    runEffects(fiber);
    fiber.isDirty = false;

    // Remove old widget and all its descendant instances from the map to prevent memory leak
    _pruneInstancesForWidget(instance.widget);

    instance.widget = newWidget;
    instance.lastVNode = vnode;

    // Re-register with new widget
    _instanceMap.set(newWidget, instance);

    return newWidget;
}

/**
 * Unmount all component instances — run cleanups.
 */
export function unmountAll(): void {
    for (const [, instance] of _instanceMap) {
        destroyFiber(instance.fiber);
    }
    _instanceMap.clear();
}
