import { describe, expect, it } from 'vitest';
import {
  MAX_WIDGETS, addWidget, chartOptions, compareAllowed, isVersionConflict, kpiView, moveWidget, normaliseChatReply, normaliseDashboard,
  normaliseDimensions, normaliseMetrics, normaliseOptions, normalisePreview, normaliseRecipe, normaliseSummaries, normaliseVersionDetail,
  normaliseVersions, previewBand, previewFailureText, previewKey, recipesEqual, removeWidget, saveErrorMessage, tableView, updateWidget, visibilityOptionsFor,
  widgetChartOption, widgetErrorText, widgetIsEmpty,
} from './insights-builder-logic';
import type { InsightsMetric, InsightsRecipe, WidgetData } from './insights-builder.models';
import { formatMinutes } from '../../../shared/utils/insights-view';

const formatMinutesLike = (m: number) => formatMinutes(m);

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
  series: [{ name: 'Tests', values: [12, 30], unit: 'count' }], total: null, deltaPct: null, ...over,
});

const METRIC = (over: Partial<InsightsMetric> = {}): InsightsMetric => ({
  id: 'p', label: 'P', description: '', money: false, unit: 'count', groupBy: [], charts: ['kpi', 'line'],
  filters: [], supportsCompare: false, usesPeriod: true, multiSeries: false, groupByKinds: {}, ...over,
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
    const m = METRIC({ id: 'tat', label: 'Turnaround', unit: 'minutes', groupBy: ['department'], charts: ['hbar', 'table'], defaultChart: 'hbar' });
    const added = addWidget(RECIPE, m).widgets.at(-1)!;
    expect(added).toMatchObject({ metric: 'tat', chart: 'hbar', groupBy: 'department', title: 'Turnaround', size: 'm' });
    // The server's widget cap (GET /options maxWidgets) is respected.
    expect(addWidget(RECIPE, m, 3)).toBe(RECIPE);
  });

  it('chart type options are limited to the metric’s allowed charts', () => {
    const m = METRIC();
    expect(chartOptions(m, 'kpi').map((o) => o.value)).toEqual(['kpi', 'line']);
    // A saved kind outside the list stays visible (never a blank control).
    expect(chartOptions(m, 'table').map((o) => o.value)).toEqual(['table', 'kpi', 'line']);
  });
});

describe('Insights builder — the band goes to /preview as `band` (the server applies it)', () => {
  it('"Each chart’s own" + no branch sends no band', () => {
    expect(previewBand({ period: 'own' })).toBeNull();
  });

  it('a band period and branch become {branchId, period}', () => {
    expect(previewBand({ period: '7d', branchId: 'b9' })).toEqual({ branchId: 'b9', period: { preset: '7d' } });
    expect(previewBand({ period: 'own', branchId: 'b9' })).toEqual({ branchId: 'b9' });
  });

  it('custom dates only apply when both ends are real days (put in order)', () => {
    expect(previewBand({ period: 'custom', from: '2026-10-01', to: '2026-10-07' })).toEqual({ period: { from: '2026-10-01', to: '2026-10-07' } });
    expect(previewBand({ period: 'custom', from: '2026-10-07', to: '2026-10-01' })).toEqual({ period: { from: '2026-10-01', to: '2026-10-07' } });
    expect(previewBand({ period: 'custom', from: '', to: '' })).toBeNull();
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

  it('the real wire shape: series units + previous flag, missing values 0, the cleaned recipe; unknown units fall back', () => {
    const p = normalisePreview({ widgets: [{
      id: 'f', state: 'ok', unit: 'count', bucketUnit: null, categories: ['Registered', 'Collected', 'Received'],
      series: [{ name: 'Visits', values: [9, 7, 5], unit: 'count' }, { name: 'Typical minutes', values: [0, 14.5], unit: 'minutes' },
        { name: 'Visits (previous period)', values: [8, 6, 4], unit: 'count', previous: true }, { name: 'Odd', values: [1, 1, 1], unit: 'ratio' }],
      total: 9, deltaPct: null, ids: null, chart: 'hbar',
    }], notes: ['Dropped "Weather": not something Prefrontal can show.'], recipe: { version: 1, title: 'T', widgets: [{ id: 'f', metric: 'patient_flow', chart: 'hbar', size: 'm' }] } });
    const w = p.widgets[0];
    expect(w.series.map((s) => s.unit)).toEqual(['count', 'minutes', 'count', 'count']);
    expect(w.series[1].values).toEqual([0, 14.5, 0]);
    expect(w.series[2].previous).toBe(true);
    expect(w.series[0].previous).toBeUndefined();
    expect(p.recipe!.widgets[0].metric).toBe('patient_flow');
    expect(p.notes).toHaveLength(1);
  });

  it('a chart draws one unit (the headline’s); the table shows every series in its own unit', () => {
    const d = DATA({ categories: ['Registered', 'Collected', 'Received', 'Resulted'], series: [
      { name: 'Visits', values: [9, 7, 5, 4], unit: 'count' }, { name: 'Typical minutes', values: [0, 14, 35, 90], unit: 'minutes' }] });
    const opt = widgetChartOption('stacked_bar', d, 'light');
    expect(opt.series.map((s: { name: string }) => s.name)).toEqual(['Visits']);
    const t = tableView({ ...RECIPE.widgets[1], groupBy: 'stage' }, d);
    expect(t.columns.map((c) => c.headerName)).toEqual(['Stage', 'Visits', 'Typical minutes']);
    expect(t.rows[3]).toEqual({ k: 'Resulted', s0: '4', s1: formatMinutesLike(90) });
  });

  it('compare: the previous period is a dashed line, and side-by-side bars (never stacked)', () => {
    const cats = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];
    const d = DATA({ bucketUnit: 'day', categories: cats, series: [
      { name: 'Patients', values: [4, 6, 5, 7], unit: 'count' }, { name: 'Patients (previous period)', values: [3, 5, 6, 4], unit: 'count', previous: true }] });
    const line = widgetChartOption('line', d, 'light');
    expect(line.series[1].lineStyle.type).toBe('dashed');
    expect(line.series[1].areaStyle).toBeUndefined();
    const bars = widgetChartOption('bar', d, 'light');
    expect(bars.series).toHaveLength(2);
    expect(bars.series.every((s: { stack?: string }) => s.stack === undefined)).toBe(true);
    // Without compare a bar chart is one series, no legend.
    const one = widgetChartOption('bar', DATA({ categories: cats, series: [{ name: 'Patients', values: [4, 6, 5, 7], unit: 'count' }] }), 'light');
    expect(one.series).toHaveLength(1);
    expect(one.legend).toBeUndefined();
  });

  it('compare is offered only where the server supports it (kpi / line / bar)', () => {
    const m = METRIC({ supportsCompare: true });
    expect(compareAllowed(m, 'line')).toBe(true);
    expect(compareAllowed(m, 'kpi')).toBe(true);
    expect(compareAllowed(m, 'donut')).toBe(false);
    expect(compareAllowed(METRIC(), 'line')).toBe(false);
  });

  it('builds an option for every chart kind with the shared builders', () => {
    // ≥ 4 buckets: the shared line builder draws 2–3 points as bars on purpose.
    const d = DATA({ categories: ['A', 'B', 'C', 'D'], series: [{ name: 'Tests', values: [12, 30, 7, 9], unit: 'count' }] });
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

  it('all-zero → empty; a KPI of 0 is still a number', () => {
    expect(widgetIsEmpty(DATA({ series: [{ name: 'N', values: [0, 0], unit: 'count' }] }))).toBe(true);
    expect(widgetIsEmpty(DATA())).toBe(false);
    const zeroKpi = DATA({ categories: [], series: [], total: 0 });
    expect(widgetIsEmpty(zeroKpi, 'kpi')).toBe(false);
    expect(widgetIsEmpty({ ...zeroKpi, state: 'empty', total: null }, 'kpi')).toBe(true);
  });
});

describe('Insights builder — server shapes', () => {
  it('metrics: unknown charts / groups dropped, money unit inferred', () => {
    const m = normaliseMetrics([{ id: 'revenue', label: 'Revenue', money: true, charts: ['line', 'radar'], groupBy: ['day', 'moon'] }, { id: '' }, 'x']);
    expect(m).toEqual([{
      id: 'revenue', label: 'Revenue', description: '', money: true, unit: 'money', groupBy: ['day'], charts: ['line'],
      filters: [], supportsCompare: false, usesPeriod: true, multiSeries: false, groupByKinds: {},
    }]);
  });

  it('metrics: the real GET /metrics entry (plain array, filters, compare, live, kinds, reason/staff/status splits)', () => {
    const [rej, pend] = normaliseMetrics([
      { id: 'rejections', label: 'Sample rejections', description: 'x', money: false, unit: 'percent', groupBy: ['reason'], charts: ['kpi', 'bar'],
        defaultChart: 'kpi', defaultGroupBy: 'reason', filters: ['branchId', 'departmentId', 'colour'], supportsCompare: true, usesPeriod: true,
        multiSeries: false, groupByKinds: { reason: 'category' } },
      { id: 'pending_by_stage', label: 'Pending', money: false, unit: 'count', groupBy: ['stage'], charts: ['stacked_bar'], filters: [],
        supportsCompare: false, usesPeriod: false, multiSeries: true, groupByKinds: { stage: 'ordered' } },
    ]);
    expect(rej).toMatchObject({ unit: 'percent', groupBy: ['reason'], defaultGroupBy: 'reason', filters: ['branchId', 'departmentId'], supportsCompare: true, groupByKinds: { reason: 'category' } });
    expect(pend).toMatchObject({ usesPeriod: false, multiSeries: true, groupByKinds: { stage: 'ordered' } });
    // A recipe split by reason / staff / status keeps its split.
    expect(normaliseRecipe({ title: 't', widgets: [{ id: 'r', metric: 'rejections', chart: 'bar', groupBy: 'reason' }] })!.widgets[0].groupBy).toBe('reason');
  });

  it('options + dimensions', () => {
    expect(normaliseOptions({ charts: ['line', 'radar'], periodPresets: ['today'], sizes: [], maxWidgets: 12, maxCustomDays: 731, canSeeMoney: true, canShare: false }))
      .toEqual({ charts: ['line'], periodPresets: ['today'], sizes: ['s', 'm', 'l'], maxWidgets: 12, maxCustomDays: 731, canSeeMoney: true, canShare: false });
    expect(normaliseOptions(null)).toMatchObject({ maxWidgets: MAX_WIDGETS, canSeeMoney: false, canShare: false });
    expect(normaliseDimensions([{ id: 'd1', name: 'Biochemistry' }, { id: '', name: 'x' }, 'junk'])).toEqual([{ id: 'd1', name: 'Biochemistry' }]);
  });

  it('visibility picks: only "Just me" without sharing rights (keeping what an admin already set)', () => {
    expect(visibilityOptionsFor(true, 'private').map((o) => o.value)).toEqual(['private', 'roles', 'lab']);
    expect(visibilityOptionsFor(false, 'private').map((o) => o.value)).toEqual(['private']);
    expect(visibilityOptionsFor(false, 'lab').map((o) => o.value)).toEqual(['private', 'lab']);
  });

  it('a 409 version_conflict reads as plain words', () => {
    const e = { code: 'version_conflict', message: 'Someone saved a newer version of this dashboard. Reload it first.' };
    expect(isVersionConflict(e)).toBe(true);
    expect(saveErrorMessage(e, 'x')).toBe('Someone else changed this dashboard — reload it to see their version.');
    expect(isVersionConflict({ code: 'forbidden' })).toBe(false);
    expect(saveErrorMessage({ message: 'Http failure response for x: 0' }, 'Fallback')).toBe('Fallback');
  });

  it('dashboard + versions', () => {
    const d = normaliseDashboard({
      id: 'd1', title: 'Owner', status: 'published', visibility: 'lab', version: 3, recipe: RECIPE, roleIds: ['r1'], canEdit: true,
      ownerUserId: 'u1', ownerName: 'Latha Ramesh', mine: false, canShare: true, widgetCount: 3, notes: ['Dropped "x"'], createdAt: '2026-10-01T00:00:00Z',
    });
    expect(d).toMatchObject({ id: 'd1', status: 'published', visibility: 'lab', version: 3, roleIds: ['r1'], mine: false, canShare: true, ownerName: 'Latha Ramesh', notes: ['Dropped "x"'] });
    expect(d!.recipe).toEqual(RECIPE);
    // A summary without canShare / mine: never assumes sharing rights.
    expect(normaliseDashboard({ id: 'd2', recipe: RECIPE })!.canShare).toBe(false);
    expect(normaliseSummaries([{ id: 'd3', title: 'x', mine: true, widgetCount: 4 }])[0]).toMatchObject({ mine: true, widgetCount: 4 });
    const vs = normaliseVersions([{ version: 1, title: 'a' }, { version: 3, title: 'c', current: true }, { version: 0 }]);
    expect(vs.map((v) => v.version)).toEqual([3, 1]);
    expect(vs[0].current).toBe(true);
    expect(normaliseVersionDetail({ version: 2, title: 'Old', savedAt: '2026-10-02T00:00:00Z', recipe: RECIPE })).toMatchObject({ version: 2, title: 'Old' });
    expect(normaliseVersionDetail({ version: 2 })).toBeNull();
  });

  it('chat reply: recipe normalised, changes clipped, reply text kept as text', () => {
    const r = normaliseChatReply({ reply: '<b>hi</b>', recipe: { title: 'T', widgets: [{ id: 'z', metric: 'patients', chart: 'kpi', size: 's' }] }, changes: ['Added Patients', 42, ''] });
    expect(r.reply).toBe('<b>hi</b>');
    expect(r.recipe!.widgets[0].metric).toBe('patients');
    expect(r.changes).toEqual(['Added Patients', '42']);
    // The server omits `recipe` (and changes) when nothing was proposed; notes still come.
    const plain = normaliseChatReply({ reply: 'just words', notes: ['Dropped "Weather": not something Prefrontal can show.'], provider: 'gemini', model: 'm' });
    expect(plain.recipe).toBeNull();
    expect(plain.changes).toEqual([]);
    expect(plain.notes).toEqual(['Dropped "Weather": not something Prefrontal can show.']);
  });
});

describe('previewKey — only data-relevant changes re-preview', () => {
  const same = (a: InsightsRecipe, b: InsightsRecipe, band = null) => previewKey(a, band) === previewKey(b, band);
  const edit = (id: string, patch: Record<string, unknown>): InsightsRecipe =>
    ({ ...RECIPE, widgets: RECIPE.widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)) });

  it('title, size, dashboard title and card order do not change it', () => {
    expect(same(RECIPE, edit('a', { title: 'Renamed' }))).toBe(true);
    expect(same(RECIPE, edit('a', { size: 'l' }))).toBe(true);
    expect(same(RECIPE, { ...RECIPE, title: 'Other name' })).toBe(true);
    expect(same(RECIPE, { ...RECIPE, widgets: [...RECIPE.widgets].reverse() })).toBe(true);
    expect(same(RECIPE, moveWidget(RECIPE, 'a', 1))).toBe(true);
  });

  it('metric, chart, split, filters, period, compare, adding / removing a card and the band all change it', () => {
    expect(same(RECIPE, edit('a', { metric: 'tests' }))).toBe(false);
    expect(same(RECIPE, edit('c', { chart: 'bar' }))).toBe(false);
    expect(same(RECIPE, edit('c', { groupBy: 'week' }))).toBe(false);
    expect(same(RECIPE, edit('c', { filters: { branchId: 'b2' } }))).toBe(false);
    expect(same(RECIPE, edit('a', { period: { preset: '7d' } }))).toBe(false);
    expect(same(RECIPE, edit('a', { compare: true }))).toBe(false);
    expect(same(RECIPE, removeWidget(RECIPE, 'b'))).toBe(false);
    expect(previewKey(RECIPE, null)).not.toBe(previewKey(RECIPE, { branchId: 'b1' }));
    expect(previewKey(RECIPE, { branchId: 'b1' })).toBe(previewKey(RECIPE, { branchId: 'b1' }));
  });

  it('compare off and compare missing are the same thing', () => {
    expect(same(RECIPE, edit('a', { compare: false }))).toBe(true);
  });
});

describe('preview failures in plain words', () => {
  it('a timeout (504 / 408 / code) and too many refreshes (429) say what to do', () => {
    expect(previewFailureText({ status: 504 }, 'x')).toMatch(/took too long.*shorter period/);
    expect(previewFailureText({ status: 408 }, 'x')).toMatch(/took too long/);
    expect(previewFailureText({ error: { error: 'timeout' } }, 'x')).toMatch(/took too long/);
    expect(previewFailureText({ status: 429 }, 'x')).toMatch(/Wait a few seconds/);
    expect(previewFailureText({ status: 500 }, 'fallback')).toBe('fallback');
  });

  it('a chart that is too detailed shows the server words, and the code survives normalising', () => {
    const d = normalisePreview({ widgets: [{ id: 'w', state: 'error', code: 'too_detailed', message: 'Too detailed — pick a shorter period.', unit: 'count', categories: [], series: [] }], notes: [] }).widgets[0];
    expect(d.state).toBe('error');
    expect(d.code).toBe('too_detailed');
    expect(widgetErrorText(d)).toBe('Too detailed — pick a shorter period.');
    expect(widgetErrorText({ ...d, message: null })).toBe('Too detailed — pick a shorter period.');
    expect(widgetErrorText({ ...d, code: 'timeout', message: null })).toMatch(/took too long/);
    expect(widgetErrorText(undefined)).toBe('This chart couldn’t load.');
  });
});
