import { describe, expect, it } from 'vitest';
import {
  MAX_WIDGETS, addWidget, applyBand, chartOptions, kpiView, moveWidget, normaliseChatReply, normaliseDashboard, normaliseMetrics,
  normalisePreview, normaliseRecipe, normaliseVersions, recipesEqual, removeWidget, tableView, updateWidget, widgetChartOption,
  widgetIsEmpty,
} from './insights-builder-logic';
import type { InsightsMetric, InsightsRecipe, WidgetData } from './insights-builder.models';

const RECIPE: InsightsRecipe = {
  version: 1, title: 'Morning view',
  widgets: [
    { id: 'a', title: 'Patients', metric: 'patients', chart: 'kpi', period: { preset: 'today' }, size: 's' },
    { id: 'b', title: 'Tests by department', metric: 'tests_by_department', chart: 'hbar', groupBy: 'department', period: { preset: 'month' }, size: 'm' },
    { id: 'c', title: 'Revenue', metric: 'revenue', chart: 'line', groupBy: 'day', period: { preset: 'month' }, size: 'l', filters: { branchId: 'b1' } },
  ],
};

const DATA = (over: Partial<WidgetData> = {}): WidgetData => ({
  id: 'x', state: 'ok', unit: 'count', bucketUnit: null, categories: ['Haematology', 'Biochemistry'],
  series: [{ name: 'Tests', values: [12, 30] }], total: null, deltaPct: null, ...over,
});

describe('Insights builder — recipe normalising (untrusted input)', () => {
  it('keeps a valid recipe as is', () => {
    expect(normaliseRecipe(RECIPE)).toEqual(RECIPE);
  });

  it('replaces unknown chart / size / period with safe defaults, drops widgets without a metric, clips strings', () => {
    const r = normaliseRecipe({
      title: 'x'.repeat(500),
      widgets: [
        { id: 'w1', metric: 'patients', chart: 'pie3d', size: 'xxl', period: { preset: 'forever' }, title: '<img src=x onerror=alert(1)>' },
        { id: 'w2', chart: 'line' },
        'junk',
        { id: 'w1', metric: 'tests', chart: 'table', size: 'l', period: { from: '2026-10-09', to: '2026-10-01' } },
      ],
    })!;
    expect(r.title.length).toBe(120);
    expect(r.widgets).toHaveLength(2);
    expect(r.widgets[0]).toMatchObject({ chart: 'bar', size: 'm', period: { preset: 'month' } });
    // Text stays text (rendered with interpolation, never HTML).
    expect(r.widgets[0].title).toBe('<img src=x onerror=alert(1)>');
    // Duplicate id gets a fresh one; a reversed range is put in order.
    expect(r.widgets[1].id).not.toBe('w1');
    expect(r.widgets[1].period).toEqual({ from: '2026-10-01', to: '2026-10-09' });
  });

  it('caps the number of widgets and rejects a non-recipe', () => {
    const many = { title: 't', widgets: Array.from({ length: 40 }, (_, i) => ({ id: `w${i}`, metric: 'patients', chart: 'kpi', size: 's' })) };
    expect(normaliseRecipe(many)!.widgets).toHaveLength(MAX_WIDGETS);
    expect(normaliseRecipe('nope')).toBeNull();
    expect(normaliseRecipe({ title: 'no widgets' })).toBeNull();
  });

  it('compares recipes regardless of key order', () => {
    const shuffled = JSON.parse(JSON.stringify(RECIPE));
    shuffled.widgets[0] = { size: 's', period: { preset: 'today' }, chart: 'kpi', metric: 'patients', title: 'Patients', id: 'a' };
    expect(recipesEqual(RECIPE, shuffled)).toBe(true);
    expect(recipesEqual(RECIPE, updateWidget(RECIPE, 'a', { size: 'l' }))).toBe(false);
  });
});

describe('Insights builder — edits', () => {
  it('moves up / down and stops at the ends', () => {
    expect(moveWidget(RECIPE, 'b', -1).widgets.map((w) => w.id)).toEqual(['b', 'a', 'c']);
    expect(moveWidget(RECIPE, 'b', 1).widgets.map((w) => w.id)).toEqual(['a', 'c', 'b']);
    expect(moveWidget(RECIPE, 'a', -1)).toBe(RECIPE);
    expect(moveWidget(RECIPE, 'c', 1)).toBe(RECIPE);
  });

  it('removes and adds (metric default chart + group)', () => {
    expect(removeWidget(RECIPE, 'b').widgets.map((w) => w.id)).toEqual(['a', 'c']);
    const m: InsightsMetric = { id: 'tat', label: 'Turnaround', description: '', money: false, unit: 'minutes', groupBy: ['department'], charts: ['hbar', 'table'], defaultChart: 'hbar' };
    const added = addWidget(RECIPE, m).widgets.at(-1)!;
    expect(added).toMatchObject({ metric: 'tat', chart: 'hbar', groupBy: 'department', title: 'Turnaround', size: 'm' });
  });

  it('chart type options are limited to the metric’s allowed charts', () => {
    const m: InsightsMetric = { id: 'p', label: 'P', description: '', money: false, unit: 'count', groupBy: [], charts: ['kpi', 'line'] };
    expect(chartOptions(m, 'kpi').map((o) => o.value)).toEqual(['kpi', 'line']);
    // A saved kind outside the list stays visible (never a blank control).
    expect(chartOptions(m, 'table').map((o) => o.value)).toEqual(['table', 'kpi', 'line']);
  });
});

describe('Insights builder — band applies to every widget', () => {
  it('"Each chart’s own" + no branch leaves the recipe alone', () => {
    expect(applyBand(RECIPE, { period: 'own' })).toBe(RECIPE);
  });

  it('a band period and branch replace every widget’s, without touching the saved recipe', () => {
    const r = applyBand(RECIPE, { period: '7d', branchId: 'b9' });
    expect(r.widgets.every((w) => 'preset' in w.period && w.period.preset === '7d')).toBe(true);
    expect(r.widgets.every((w) => w.filters?.branchId === 'b9')).toBe(true);
    expect(RECIPE.widgets[0].period).toEqual({ preset: 'today' });
  });

  it('custom dates only apply when both ends are real days', () => {
    expect(applyBand(RECIPE, { period: 'custom', from: '2026-10-01', to: '2026-10-07' }).widgets[0].period).toEqual({ from: '2026-10-01', to: '2026-10-07' });
    expect(applyBand(RECIPE, { period: 'custom', from: '', to: '' })).toBe(RECIPE);
  });
});

describe('Insights builder — preview + drawing', () => {
  it('a hidden (money) widget never keeps numbers, whatever arrived', () => {
    const p = normalisePreview({ widgets: [{ id: 'c', state: 'hidden', unit: 'money', categories: ['a'], series: [{ name: 'Revenue', values: [999] }], total: 999 }], notes: ['Dropped: unknown metric "foo"'] });
    expect(p.widgets[0]).toMatchObject({ state: 'hidden', categories: [], series: [], total: null });
    expect(p.notes).toEqual(['Dropped: unknown metric "foo"']);
  });

  it('coerces values to finite numbers aligned to the categories', () => {
    const p = normalisePreview({ data: { widgets: [{ id: 'b', categories: ['x', 'y', 'z'], series: [{ name: 'N', values: [1, 'NaN', null] }] }] }, success: true });
    expect(p.widgets[0].series[0].values).toEqual([1, 0, 0]);
  });

  it('builds an option for every chart kind with the shared builders', () => {
    // ≥ 4 buckets: the shared line builder draws 2–3 points as bars on purpose.
    const d = DATA({ categories: ['A', 'B', 'C', 'D'], series: [{ name: 'Tests', values: [12, 30, 7, 9] }] });
    for (const kind of ['line', 'bar', 'stacked_bar', 'hbar', 'grouped_hbar', 'donut'] as const) {
      const opt = widgetChartOption(kind, d, 'light');
      expect(opt, kind).toBeTruthy();
      expect(Array.isArray(opt.series), kind).toBe(true);
    }
    expect(widgetChartOption('line', d, 'light').series[0].type).toBe('line');
    expect(widgetChartOption('donut', d, 'dark').series[0].type).toBe('pie');
    expect(widgetChartOption('kpi', d, 'light')).toBeNull();
    expect(widgetChartOption('table', d, 'light')).toBeNull();
    expect(widgetChartOption('line', DATA({ state: 'hidden' }), 'light')).toBeNull();
  });

  it('KPI shows the total (money as rupees); table = one row per category', () => {
    expect(kpiView(DATA({ unit: 'money', total: 18000 }), 'light').value).toMatch(/₹\s?18,000/);
    const t = tableView(RECIPE.widgets[1], DATA());
    expect(t.columns.map((c) => c.headerName)).toEqual(['Department', 'Tests']);
    expect(t.rows).toEqual([{ k: 'Haematology', s0: '12' }, { k: 'Biochemistry', s0: '30' }]);
  });

  it('all-zero → empty', () => {
    expect(widgetIsEmpty(DATA({ series: [{ name: 'N', values: [0, 0] }] }))).toBe(true);
    expect(widgetIsEmpty(DATA())).toBe(false);
  });
});

describe('Insights builder — server shapes', () => {
  it('metrics: unknown charts / groups dropped, money unit inferred', () => {
    const m = normaliseMetrics([{ id: 'revenue', label: 'Revenue', money: true, charts: ['line', 'radar'], groupBy: ['day', 'moon'] }, { id: '' }, 'x']);
    expect(m).toEqual([{ id: 'revenue', label: 'Revenue', description: '', money: true, unit: 'money', groupBy: ['day'], charts: ['line'] }]);
  });

  it('dashboard + versions', () => {
    const d = normaliseDashboard({ id: 'd1', title: 'Owner', status: 'published', visibility: 'lab', version: 3, recipe: RECIPE, roleIds: ['r1'], canEdit: true });
    expect(d).toMatchObject({ id: 'd1', status: 'published', visibility: 'lab', version: 3, roleIds: ['r1'] });
    expect(d!.recipe).toEqual(RECIPE);
    expect(normaliseVersions([{ version: 1, title: 'a' }, { version: 3, title: 'c' }, { version: 0 }]).map((v) => v.version)).toEqual([3, 1]);
  });

  it('chat reply: recipe normalised, changes clipped, reply text kept as text', () => {
    const r = normaliseChatReply({ reply: '<b>hi</b>', recipe: { title: 'T', widgets: [{ id: 'z', metric: 'patients', chart: 'kpi', size: 's' }] }, changes: ['Added Patients', 42, ''] });
    expect(r.reply).toBe('<b>hi</b>');
    expect(r.recipe!.widgets[0].metric).toBe('patients');
    expect(r.changes).toEqual(['Added Patients', '42']);
    expect(normaliseChatReply({ reply: 'just words' }).recipe).toBeNull();
  });
});
