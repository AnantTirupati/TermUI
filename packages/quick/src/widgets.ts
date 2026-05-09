// ─────────────────────────────────────────────────────
// @termuijs/quick — Shorthand widget constructors
// ─────────────────────────────────────────────────────

import type { Style, Color } from '@termuijs/core';
import {
    Text,
    Table,
    List,
    TextInput,
    Gauge as GaugeWidget,
    Sparkline as SparklineWidget,
    StatusIndicator as StatusWidget,
    LogView as LogViewWidget,
    Widget,
    Tree as TreeWidget,
    Skeleton as SkeletonWidget,
    Grid as GridWidget,
    BarChart as BarChartWidget,
    ProgressBar as ProgressBarWidget,
    Spinner as SpinnerWidget,
} from '@termuijs/widgets';
import type { TreeNode, TreeOptions } from '@termuijs/widgets';
import type { BarGroup, BarChartOptions } from '@termuijs/widgets';
import type { SkeletonOptions } from '@termuijs/widgets';
import type { GridOptions } from '@termuijs/widgets';
import type { Reactive } from './reactive.js';
import { resolve } from './reactive.js';

// ── Text ──

export interface QuickTextOptions {
    bold?: boolean;
    dim?: boolean;
    italic?: boolean;
    color?: Color;
    align?: 'left' | 'center' | 'right';
}

/**
 * Create a styled text line.
 */
export function text(content: string | Reactive<string>, opts: QuickTextOptions = {}): Widget {
    const style: Partial<Style> = {
        height: 1,
        bold: opts.bold,
        dim: opts.dim,
        italic: opts.italic,
        fg: opts.color,
    };
    const resolved = typeof content === 'function' ? resolve(content) : content;
    const t = new Text(resolved, style, { align: opts.align });
    // Store reactive getter so AppBuilder can refresh on each tick
    if (typeof content === 'function') {
        (t as any).__reactiveContent = content;
    }
    return t;
}

// ── Gauge ──

export interface QuickGaugeOptions {
    color?: Color;
}

/**
 * Create a gauge (label + bar + percentage).
 * Value can be static or reactive.
 */
export function gauge(label: string, value: Reactive<number>, opts: QuickGaugeOptions = {}): Widget {
    const g = new GaugeWidget(label, { height: 1, flexGrow: 1 }, {
        color: opts.color ?? { type: 'named', name: 'green' },
        showLabel: true,
    });
    g.setValue(resolve(value));
    // Store the reactive getter so the AppBuilder can refresh it
    (g as any).__reactiveValue = value;
    return g;
}

// ── Table ──

export type QuickTableRow = Record<string, string | number>;

/**
 * Create a table from data.
 * Data can be static or reactive.
 */
export function table(
    title: string,
    data: Reactive<QuickTableRow[]>,
    columns: string[],
): Widget {
    const cols = columns.map(key => {
        return { header: key, key };
    });

    const resolved = resolve(data);
    const t = new Table(cols, resolved, {
        flexGrow: 1,
        border: 'single',
        borderColor: { type: 'named', name: 'brightBlack' },
        padding: 1,
    }, { stripe: true });

    (t as any).__reactiveData = data;
    (t as any).__tableTitle = title;
    return t;
}

// ── List ──

export interface QuickListOptions {
    selectable?: boolean;
    onSelect?: (index: number) => void;
    renderItem?: (item: string, index: number, selected: boolean) => string;
}

/**
 * Create an interactive list.
 */
export function list(items: Reactive<string[]>, opts: QuickListOptions = {}): Widget {
    const resolved = resolve(items);
    const listItems = resolved.map(label => ({ label, value: label }));

    const onSelectCb = opts.onSelect
        ? (_item: any, idx: number) => opts.onSelect!(idx)
        : undefined;

    const l = new List(
        listItems,
        { flexGrow: 1, border: 'single', borderColor: { type: 'named', name: 'brightBlack' }, padding: 1 },
        onSelectCb,
    );

    (l as any).__reactiveItems = items;
    return l;
}

// ── Input ──

export interface QuickInputOptions {
    onSubmit?: (value: string) => void;
}

/**
 * Create a text input field.
 */
export function input(placeholder: string, opts: QuickInputOptions = {}): Widget {
    const i = new TextInput(
        { height: 1 },
        { placeholder, onSubmit: opts.onSubmit },
    );

    return i;
}


// ── Sparkline ──

export interface QuickSparklineOptions {
    color?: Color;
}

/**
 * Create a sparkline chart.
 */
export function sparkline(label: string, data: Reactive<number[]>, opts: QuickSparklineOptions = {}): Widget {
    const s = new SparklineWidget(label, { height: 1, flexGrow: 1 }, {
        color: opts.color ?? { type: 'named', name: 'cyan' },
    });
    s.setData(resolve(data));
    (s as any).__reactiveData = data;
    return s;
}

// ── Status ──

export interface QuickStatusOptions {
    upColor?: Color;
    downColor?: Color;
}

/**
 * Create a status indicator.
 */
export function status(label: string, isUp: Reactive<boolean>, opts: QuickStatusOptions = {}): Widget {
    const s = new StatusWidget(label, resolve(isUp), { height: 1, flexGrow: 1 }, {
        upColor: opts.upColor ?? { type: 'named', name: 'green' },
        downColor: opts.downColor ?? { type: 'named', name: 'red' },
    });
    (s as any).__reactiveStatus = isUp;
    return s;
}

// ── LogView ──

export interface QuickLogViewOptions {
    highlight?: Record<string, Color>;
}

/**
 * Create a scrollable log view.
 */
export function logView(lines: Reactive<string[]>, opts: QuickLogViewOptions = {}): Widget {
    const lv = new LogViewWidget(
        { flexGrow: 1, border: 'single', borderColor: { type: 'named', name: 'brightBlack' }, padding: 1 },
        { highlight: opts.highlight, autoScroll: true },
    );
    lv.setLines(resolve(lines));
    (lv as any).__reactiveLines = lines;
    return lv;
}

// ── Tree ──

export interface QuickTreeOptions {
    onSelect?: (node: TreeNode, path: number[]) => void;
    indent?: number;
}

/**
 * Create a collapsible tree widget for hierarchical data.
 */
export function tree(data: TreeNode[], opts: QuickTreeOptions = {}): Widget {
    const options: TreeOptions = {
        nodes: data,
        onSelect: opts.onSelect,
        indent: opts.indent,
    };
    const t = new TreeWidget(options, {
        flexGrow: 1,
        border: 'single',
        borderColor: { type: 'named', name: 'brightBlack' },
        padding: 1,
    });
    (t as any).__reactiveTreeData = null; // static by default
    return t;
}

// ── Skeleton ──

export interface QuickSkeletonOptions {
    variant?: 'pulse' | 'shimmer';
    intervalMs?: number;
    color?: Color;
}

/**
 * Create an animated skeleton loading placeholder.
 */
export function skeleton(opts: QuickSkeletonOptions = {}): Widget {
    const skeletonOpts: SkeletonOptions = {
        variant: opts.variant,
        intervalMs: opts.intervalMs,
        color: opts.color,
    };
    return new SkeletonWidget({ flexGrow: 1, height: 3 }, skeletonOpts);
}

// ── GridWidget ──

export interface QuickGridOptions {
    gap?: number;
    rowGap?: number;
    colGap?: number;
}

/**
 * Create a CSS-Grid-like layout widget that fills items left-to-right
 * wrapping every `columns` items.
 */
export function gridWidget(columns: number, items: Widget[], opts: QuickGridOptions = {}): Widget {
    const gridOpts: GridOptions = {
        columns,
        gap: opts.gap,
        rowGap: opts.rowGap,
        colGap: opts.colGap,
    };
    const g = new GridWidget({ flexGrow: 1 }, gridOpts);
    for (const item of items) {
        g.addChild(item);
    }
    return g;
}

// ── BarChart ──

export interface QuickBarChartOptions extends BarChartOptions {}

/**
 * Create a bar chart widget.
 * Data can be static or reactive.
 */
export function barChart(data: Reactive<BarGroup[]>, opts: QuickBarChartOptions = {}): Widget {
    const resolved = resolve(data);
    const bc = new BarChartWidget(resolved, { flexGrow: 1 }, opts);
    (bc as any).__reactiveBarData = data;
    return bc;
}

// ── ProgressBar ──

export interface QuickProgressBarOptions {
    color?: Color;
    showLabel?: boolean;
}

/**
 * Create a progress bar widget.
 * Value should be between 0 and 1.
 */
export function progressBar(value: Reactive<number>, opts: QuickProgressBarOptions = {}): Widget {
    const resolved = resolve(value);
    const pb = new ProgressBarWidget(
        { height: 1, flexGrow: 1 },
        {
            value: resolved,
            fillColor: opts.color ?? { type: 'named', name: 'green' },
            showLabel: opts.showLabel ?? true,
        },
    );
    (pb as any).__reactiveValue = value;
    return pb;
}

// ── Spinner ──

export interface QuickSpinnerOptions {
    label?: string;
    color?: Color;
}

/**
 * Create an animated spinner widget.
 */
export function spinner(opts: QuickSpinnerOptions = {}): Widget {
    return new SpinnerWidget(
        { height: 1 },
        {
            label: opts.label,
            color: opts.color,
        },
    );
}

// ── Re-export types from @termuijs/widgets for convenience ──
export type { TreeNode } from '@termuijs/widgets';
export type { BarGroup, BarChartOptions } from '@termuijs/widgets';
