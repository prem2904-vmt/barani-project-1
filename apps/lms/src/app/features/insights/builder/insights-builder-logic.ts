/**
 * Insights dashboard builder — pure helpers (DOM-free, unit-tested).
 *
 * Everything that arrives from the server is shape-checked here: a recipe
 * proposed by PF Sense is UNTRUSTED (strings clipped, unknown chart kinds /
 * sizes / periods replaced by safe defaults, at most MAX_WIDGETS widgets),
 * and preview numbers are coerced to finite numbers. The chart options are
 * built ONLY with the shared business-chart builders (rule: one skin, one
 * set of shape builders).
 */
import type { PfSelectOption } from '../../../shared/primitives/select.component';
import {
  CHART_OTHER, buildBusinessLineOption, buildDonutOption, buildGroupedHBarOption, buildHorizontalBarOption, buildSparklineOption,
  buildStackedBarOption, rupeeAxisFormatter, rupeeFormatter,
} from '../../../shared/utils/business-chart';
import { bucketAxisLabel, formatCount, formatMinutes, formatRupee } from '../../../shared/utils/insights-view';
import type { AnalyticsPeriodPreset } from '../../../shared/utils/analytics-period';
import {
  CHART_KINDS, ChartKind, DashboardStatus, DashboardVisibility, DimensionValue, FilterKey, GROUP_BYS, GroupBy, GroupByKind,
  InsightsChatReply, InsightsDashboard, InsightsDashboardSummary, InsightsDashboardVersion, InsightsDashboardVersionDetail, InsightsMetric,
  InsightsOptions, InsightsPreview, InsightsRecipe, MetricUnit, PERIOD_PRESETS, PreviewBand, RecipePeriod, RecipePeriodPreset, RecipeWidget,
  WIDGET_SIZES, WidgetData, WidgetFilters, WidgetSeries, WidgetSize, WidgetState,
} from './insights-builder.models';

/** The server's cap (MetricRegistry.MaxWidgets); GET /options can say otherwise. */
export const MAX_WIDGETS = 12;
export const MAX_CHANGES = 20;
const MAX_CATEGORIES = 400;
const MAX_SERIES = 8;

const rec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').trim().slice(0, max);
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const numOrNull = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
/** Unwrap an `{ success, data }` envelope when one slipped through. */
const unwrap = (raw: unknown): unknown => (rec(raw) && 'data' in raw && ('success' in raw || Object.keys(raw).length === 1) ? raw['data'] : raw);
const isYmd = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

// ── Words ────────────────────────────────────────────────────────────────

export const CHART_LABELS: Record<ChartKind, string> = {
  line: 'Line', bar: 'Bars', stacked_bar: 'Stacked bars', hbar: 'Ranked bars', grouped_hbar: 'Grouped bars',
  donut: 'Donut', kpi: 'Number', table: 'Table',
};

export const PERIOD_LABELS: Record<RecipePeriodPreset, string> = {
  today: 'Today', '7d': '7 days', month: 'This month', lastMonth: 'Last month', quarter: 'Quarter', all: 'All time',
};

export const SIZE_LABELS: Record<WidgetSize, string> = { s: 'Small', m: 'Medium', l: 'Wide' };

export const GROUP_LABELS: Record<GroupBy, string> = {
  day: 'Day', week: 'Week', month: 'Month', department: 'Department', test: 'Test', referrer: 'Referrer', branch: 'Branch',
  stage: 'Stage', hour: 'Hour', weekday: 'Weekday', payment_mode: 'Payment mode', reason: 'Reason', staff: 'Person', status: 'Status',
};

export const VISIBILITY_OPTIONS: PfSelectOption<DashboardVisibility>[] = [
  { value: 'private', label: 'Just me' },
  { value: 'roles', label: 'Roles' },
  { value: 'lab', label: 'Whole lab' },
];

export function visibilityLabel(v: DashboardVisibility): string {
  return VISIBILITY_OPTIONS.find((o) => o.value === v)?.label ?? 'Just me';
}

/** "Published · Whole lab", "Draft · Just me". */
export function statusLine(status: DashboardStatus, visibility: DashboardVisibility): string {
  return `${status === 'published' ? 'Published' : 'Draft'} · ${visibilityLabel(visibility)}`;
}

export const WIDGET_PERIOD_OPTIONS: PfSelectOption<RecipePeriodPreset | 'custom'>[] =
  PERIOD_PRESETS.map((p) => ({ value: p, label: PERIOD_LABELS[p] }));

/** The band's period on a dashboard: each widget's own, or one for all. */
export type BandPeriod = 'own' | AnalyticsPeriodPreset;

export interface BandFilters {
  period: BandPeriod;
  /** Custom range (IST days) when period === 'custom'. */
  from?: string;
  to?: string;
  branchId?: string;
}

// ── Recipe normalising (untrusted input) ─────────────────────────────────

let idSeq = 0;
export function newWidgetId(): string {
  idSeq += 1;
  return `w${Date.now().toString(36)}${idSeq.toString(36)}`;
}

function normPeriod(v: unknown): RecipePeriod {
  if (rec(v)) {
    const preset = str(v['preset'], 20);
    if ((PERIOD_PRESETS as readonly string[]).includes(preset)) return { preset: preset as RecipePeriodPreset };
    if (isYmd(v['from']) && isYmd(v['to'])) {
      return (v['from'] as string) <= (v['to'] as string) ? { from: v['from'] as string, to: v['to'] as string } : { from: v['to'] as string, to: v['from'] as string };
    }
  }
  return { preset: 'month' };
}

function normFilters(v: unknown): WidgetFilters | undefined {
  if (!rec(v)) return undefined;
  const out: WidgetFilters = {};
  for (const k of ['branchId', 'departmentId', 'testId', 'refDoctorId'] as const) {
    const s = str(v[k], 64);
    if (s) out[k] = s;
  }
  return Object.keys(out).length ? out : undefined;
}

function normWidget(v: unknown, seen: Set<string>): RecipeWidget | null {
  if (!rec(v)) return null;
  const metric = str(v['metric'], 64);
  if (!metric) return null;
  let id = str(v['id'], 64);
  if (!id || seen.has(id)) id = newWidgetId();
  seen.add(id);
  const chart = str(v['chart'], 20) as ChartKind;
  const size = str(v['size'], 2) as WidgetSize;
  const groupBy = str(v['groupBy'], 20) as GroupBy;
  const w: RecipeWidget = {
    id,
    title: str(v['title'], 120) || metric,
    metric,
    chart: (CHART_KINDS as readonly string[]).includes(chart) ? chart : 'bar',
    period: normPeriod(v['period']),
    size: (WIDGET_SIZES as readonly string[]).includes(size) ? size : 'm',
  };
  if ((GROUP_BYS as readonly string[]).includes(groupBy)) w.groupBy = groupBy;
  const filters = normFilters(v['filters']);
  if (filters) w.filters = filters;
  if (v['compare'] === true) w.compare = true;
  return w;
}

/** Any recipe-ish value → a valid v1 recipe, or null when it isn't one at all. */
export function normaliseRecipe(raw: unknown): InsightsRecipe | null {
  const r = unwrap(raw);
  if (!rec(r) || !Array.isArray(r['widgets'])) return null;
  const seen = new Set<string>();
  const widgets = (r['widgets'] as unknown[]).map((w) => normWidget(w, seen)).filter((w): w is RecipeWidget => !!w).slice(0, MAX_WIDGETS);
  const out: InsightsRecipe = { version: 1, title: str(r['title'], 120) || 'Untitled dashboard', widgets };
  const description = str(r['description'], 400);
  if (description) out.description = description;
  return out;
}

export function emptyRecipe(title = 'Untitled dashboard'): InsightsRecipe {
  return { version: 1, title, widgets: [] };
}

/** Stable comparison (dirty check): key order never matters. */
export function recipesEqual(a: InsightsRecipe | null | undefined, b: InsightsRecipe | null | undefined): boolean {
  return canonical(a) === canonical(b);
}
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (rec(v)) return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

// ── Metrics ──────────────────────────────────────────────────────────────

const UNITS: readonly MetricUnit[] = ['count', 'money', 'minutes', 'percent'];
const FILTER_KEYS: readonly FilterKey[] = ['branchId', 'departmentId', 'testId', 'refDoctorId'];
const GROUP_KINDS: readonly GroupByKind[] = ['time', 'ordered', 'category'];

export function normaliseMetrics(raw: unknown): InsightsMetric[] {
  const list = unwrap(raw);
  if (!Array.isArray(list)) return [];
  const out: InsightsMetric[] = [];
  const seen = new Set<string>();
  for (const m of list) {
    if (!rec(m)) continue;
    const id = str(m['id'], 64);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const charts = (Array.isArray(m['charts']) ? m['charts'] : []).map((c) => str(c, 20)).filter((c): c is ChartKind => (CHART_KINDS as readonly string[]).includes(c));
    const groupBy = (Array.isArray(m['groupBy']) ? m['groupBy'] : []).map((g) => str(g, 20)).filter((g): g is GroupBy => (GROUP_BYS as readonly string[]).includes(g));
    const unit = str(m['unit'], 12) as MetricUnit;
    const money = m['money'] === true;
    const metric: InsightsMetric = {
      id, label: str(m['label'], 80) || id, description: str(m['description'], 300), money,
      unit: UNITS.includes(unit) ? unit : money ? 'money' : 'count',
      groupBy, charts: charts.length ? charts : ['bar', 'table'],
      filters: (Array.isArray(m['filters']) ? m['filters'] : []).map((f) => str(f, 20)).filter((f): f is FilterKey => (FILTER_KEYS as readonly string[]).includes(f)),
      supportsCompare: m['supportsCompare'] === true,
      usesPeriod: m['usesPeriod'] !== false,
      multiSeries: m['multiSeries'] === true,
      groupByKinds: {},
    };
    const kinds = rec(m['groupByKinds']) ? m['groupByKinds'] : {};
    for (const g of groupBy) {
      const k = str(kinds[g], 10) as GroupByKind;
      if (GROUP_KINDS.includes(k)) metric.groupByKinds[g] = k;
    }
    const dc = str(m['defaultChart'], 20) as ChartKind;
    if (metric.charts.includes(dc)) metric.defaultChart = dc;
    const dg = str(m['defaultGroupBy'], 20) as GroupBy;
    if (metric.groupBy.includes(dg)) metric.defaultGroupBy = dg;
    out.push(metric);
  }
  return out;
}

/** The chart kinds a widget may switch to: its metric's allowed list (the
 *  current kind kept so the control never shows a blank). */
export function chartOptions(metric: InsightsMetric | undefined, current: ChartKind): PfSelectOption<ChartKind>[] {
  const allowed = metric?.charts.length ? [...metric.charts] : [current];
  if (!allowed.includes(current)) allowed.unshift(current);
  return allowed.map((c) => ({ value: c, label: CHART_LABELS[c] }));
}

/** Compare (previous equal period) is offered for this metric on this chart. */
export function compareAllowed(metric: InsightsMetric | undefined, chart: ChartKind): boolean {
  return !!metric?.supportsCompare && (chart === 'kpi' || chart === 'line' || chart === 'bar');
}

// ── Options + dimensions ────────────────────────────────────────────────

export const DEFAULT_OPTIONS: InsightsOptions = {
  charts: [...CHART_KINDS], periodPresets: [...PERIOD_PRESETS], sizes: [...WIDGET_SIZES],
  maxWidgets: MAX_WIDGETS, maxCustomDays: 731, canSeeMoney: false, canShare: false,
};

export function normaliseOptions(raw: unknown): InsightsOptions {
  const r = unwrap(raw);
  if (!rec(r)) return { ...DEFAULT_OPTIONS };
  const pick = <T extends string>(v: unknown, known: readonly T[]): T[] => {
    const l = (Array.isArray(v) ? v : []).map((x) => str(x, 20)).filter((x): x is T => (known as readonly string[]).includes(x));
    return l.length ? l : [...known];
  };
  const maxW = Math.floor(num(r['maxWidgets']));
  const maxD = Math.floor(num(r['maxCustomDays']));
  return {
    charts: pick(r['charts'], CHART_KINDS),
    periodPresets: pick(r['periodPresets'], PERIOD_PRESETS),
    sizes: pick(r['sizes'], WIDGET_SIZES),
    maxWidgets: maxW > 0 ? Math.min(maxW, 50) : MAX_WIDGETS,
    maxCustomDays: maxD > 0 ? maxD : DEFAULT_OPTIONS.maxCustomDays,
    canSeeMoney: r['canSeeMoney'] === true,
    canShare: r['canShare'] === true,
  };
}

export function normaliseDimensions(raw: unknown): DimensionValue[] {
  const list = unwrap(raw);
  if (!Array.isArray(list)) return [];
  return list.filter(rec).map((d) => ({ id: str(d['id'], 64), name: str(d['name'], 160) })).filter((d) => d.id && d.name);
}

/** The visibility picks this person may use (sharing wider needs lab-admin access). */
export function visibilityOptionsFor(canShare: boolean, current: DashboardVisibility): PfSelectOption<DashboardVisibility>[] {
  if (canShare) return VISIBILITY_OPTIONS;
  // Keep what it already is (an admin may have shared it) so the control never shows a blank.
  return VISIBILITY_OPTIONS.filter((o) => o.value === 'private' || o.value === current);
}

/** A failed save in plain words; 409 version_conflict = someone else saved in between. */
export function saveErrorMessage(e: unknown, fallback: string): string {
  const code = String((e as { code?: unknown })?.code ?? (e as { error?: { error?: unknown } })?.error?.error ?? '').toLowerCase();
  const status = Number((e as { status?: unknown })?.status ?? 0);
  if (code === 'version_conflict' || status === 409) return 'Someone else changed this dashboard — reload it to see their version.';
  const m = (e as { message?: unknown })?.message;
  return typeof m === 'string' && m.trim() && !/^Http failure/i.test(m) ? m.slice(0, 200) : fallback;
}

export function isVersionConflict(e: unknown): boolean {
  const code = String((e as { code?: unknown })?.code ?? (e as { error?: { error?: unknown } })?.error?.error ?? '').toLowerCase();
  return code === 'version_conflict' || Number((e as { status?: unknown })?.status ?? 0) === 409;
}

// ── Preview ──────────────────────────────────────────────────────────────

const STATES: readonly WidgetState[] = ['ok', 'hidden', 'empty', 'error'];

export function normaliseWidgetData(raw: unknown): WidgetData | null {
  if (!rec(raw)) return null;
  const id = str(raw['id'], 64);
  if (!id) return null;
  const state = str(raw['state'], 10) as WidgetState;
  const unit = str(raw['unit'], 12) as MetricUnit;
  const categories = (Array.isArray(raw['categories']) ? raw['categories'] : []).slice(0, MAX_CATEGORIES).map((c) => str(c, 120));
  const headUnit: MetricUnit = UNITS.includes(unit) ? unit : 'count';
  const series = (Array.isArray(raw['series']) ? raw['series'] : []).filter(rec).slice(0, MAX_SERIES).map((s): WidgetSeries => {
    const su = str(s['unit'], 12) as MetricUnit;
    const out: WidgetSeries = {
      name: str(s['name'], 80) || 'Value',
      values: categories.map((_, i) => num((Array.isArray(s['values']) ? s['values'] : [])[i])),
      unit: UNITS.includes(su) ? su : headUnit,
    };
    if (s['previous'] === true) out.previous = true;
    return out;
  });
  const d: WidgetData = {
    id,
    state: STATES.includes(state) ? state : 'ok',
    message: str(raw['message'], 300) || null,
    unit: headUnit,
    bucketUnit: str(raw['bucketUnit'], 12) || null,
    categories,
    series,
    total: numOrNull(raw['total']),
    deltaPct: numOrNull(raw['deltaPct']),
  };
  // A hidden widget never carries numbers, whatever arrived.
  if (d.state === 'hidden') { d.categories = []; d.series = []; d.total = null; d.deltaPct = null; }
  return d;
}

export function normalisePreview(raw: unknown): InsightsPreview {
  const r = unwrap(raw);
  const src = rec(r) ? r : {};
  const widgets = (Array.isArray(src['widgets']) ? src['widgets'] : []).map(normaliseWidgetData).filter((w): w is WidgetData => !!w);
  const notes = (Array.isArray(src['notes']) ? src['notes'] : []).map((n) => str(n, 300)).filter(Boolean).slice(0, 10);
  const out: InsightsPreview = { widgets, notes };
  if (src['recipe'] != null) out.recipe = normaliseRecipe(src['recipe']);
  return out;
}

/** No numbers to draw (all zero / nothing back) → the empty state. A KPI with
 *  a number (even 0 — "0 patients today" is an answer) is not empty. */
export function widgetIsEmpty(d: WidgetData, chart?: ChartKind): boolean {
  if (chart === 'kpi' && (d.state === 'ok' || d.state === 'empty') && d.total != null) return false;
  if (d.state === 'empty') return true;
  if (d.state !== 'ok') return false;
  if (d.total != null && d.total !== 0) return false;
  return !d.series.some((s) => s.values.some((v) => v !== 0));
}

// ── Dashboards ───────────────────────────────────────────────────────────

const VIS: readonly DashboardVisibility[] = ['private', 'roles', 'lab'];

export function normaliseSummary(raw: unknown): InsightsDashboardSummary | null {
  if (!rec(raw)) return null;
  const id = str(raw['id'], 64);
  if (!id) return null;
  const vis = str(raw['visibility'], 10) as DashboardVisibility;
  return {
    id,
    title: str(raw['title'], 120) || 'Untitled dashboard',
    status: raw['status'] === 'published' ? 'published' : 'draft',
    visibility: VIS.includes(vis) ? vis : 'private',
    version: Math.max(1, Math.floor(num(raw['version'])) || 1),
    updatedAt: str(raw['updatedAt'], 40) || null,
    canEdit: raw['canEdit'] !== false,
    mine: raw['mine'] !== false,
    ownerName: str(raw['ownerName'], 120) || null,
    widgetCount: Math.max(0, Math.floor(num(raw['widgetCount']))),
  };
}

export function normaliseSummaries(raw: unknown): InsightsDashboardSummary[] {
  const list = unwrap(raw);
  return Array.isArray(list) ? list.map(normaliseSummary).filter((d): d is InsightsDashboardSummary => !!d) : [];
}

export function normaliseDashboard(raw: unknown): InsightsDashboard | null {
  const r = unwrap(raw);
  const s = normaliseSummary(r);
  if (!s || !rec(r)) return null;
  const recipe = normaliseRecipe(r['recipe']) ?? emptyRecipe(s.title);
  return {
    ...s,
    recipe,
    widgetCount: recipe.widgets.length,
    roleIds: (Array.isArray(r['roleIds']) ? r['roleIds'] : []).map((x) => str(x, 64)).filter(Boolean),
    updatedByName: str(r['updatedByName'], 120) || null,
    canShare: r['canShare'] === true,
    notes: (Array.isArray(r['notes']) ? r['notes'] : []).map((n) => str(n, 300)).filter(Boolean).slice(0, 10),
  };
}

export function normaliseVersions(raw: unknown): InsightsDashboardVersion[] {
  const list = unwrap(raw);
  if (!Array.isArray(list)) return [];
  return list.filter(rec).map((v) => ({
    version: Math.floor(num(v['version'])),
    savedAt: str(v['savedAt'], 40) || null,
    savedByName: str(v['savedByName'], 120) || null,
    title: str(v['title'], 120),
    widgetCount: Math.max(0, Math.floor(num(v['widgetCount']))),
    current: v['current'] === true,
  })).filter((v) => v.version > 0).sort((a, b) => b.version - a.version);
}

export function normaliseVersionDetail(raw: unknown): InsightsDashboardVersionDetail | null {
  const r = unwrap(raw);
  if (!rec(r)) return null;
  const version = Math.floor(num(r['version']));
  const recipe = normaliseRecipe(r['recipe']);
  if (version <= 0 || !recipe) return null;
  return { version, title: str(r['title'], 120) || recipe.title, savedAt: str(r['savedAt'], 40) || null, recipe };
}

// ── Chat reply (untrusted) ───────────────────────────────────────────────

export function normaliseChatReply(raw: unknown): InsightsChatReply {
  const r = unwrap(raw);
  const src = rec(r) ? r : {};
  return {
    reply: typeof src['reply'] === 'string' ? src['reply'].slice(0, 8000) : '',
    recipe: src['recipe'] == null ? null : normaliseRecipe(src['recipe']),
    changes: (Array.isArray(src['changes']) ? src['changes'] : []).map((c) => str(c, 240)).filter(Boolean).slice(0, MAX_CHANGES),
    notes: (Array.isArray(src['notes']) ? src['notes'] : []).map((c) => str(c, 300)).filter(Boolean).slice(0, MAX_CHANGES),
    provider: str(src['provider'], 20),
    model: str(src['model'], 80),
  };
}

// ── Recipe edits (immutable) ─────────────────────────────────────────────

export function updateWidget(r: InsightsRecipe, id: string, patch: Partial<Omit<RecipeWidget, 'id'>>): InsightsRecipe {
  return { ...r, widgets: r.widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)) };
}

export function removeWidget(r: InsightsRecipe, id: string): InsightsRecipe {
  return { ...r, widgets: r.widgets.filter((w) => w.id !== id) };
}

/** Move one place up (-1) or down (+1); no-op at the ends. */
export function moveWidget(r: InsightsRecipe, id: string, dir: -1 | 1): InsightsRecipe {
  const i = r.widgets.findIndex((w) => w.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= r.widgets.length) return r;
  const widgets = [...r.widgets];
  [widgets[i], widgets[j]] = [widgets[j], widgets[i]];
  return { ...r, widgets };
}

export function addWidget(r: InsightsRecipe, m: InsightsMetric, max = MAX_WIDGETS): InsightsRecipe {
  if (r.widgets.length >= max) return r;
  const chart = m.defaultChart ?? m.charts[0] ?? 'bar';
  const w: RecipeWidget = {
    id: newWidgetId(), title: m.label, metric: m.id, chart, period: { preset: 'month' }, size: chart === 'kpi' ? 's' : 'm',
  };
  const g = m.defaultGroupBy ?? m.groupBy[0];
  if (g) w.groupBy = g;
  return { ...r, widgets: [...r.widgets, w] };
}

export function widgetPeriodValue(w: RecipeWidget): RecipePeriodPreset | 'custom' {
  return 'preset' in w.period ? w.period.preset : 'custom';
}

/** "This month", or "1 Oct – 15 Oct" for a fixed range. */
export function widgetPeriodLabel(p: RecipePeriod): string {
  return 'preset' in p ? PERIOD_LABELS[p.preset] : `${p.from} – ${p.to}`;
}

/**
 * The band applies to EVERY widget: a band period other than "Each widget's
 * own" replaces each widget's period (live metrics keep theirs), a band
 * branch replaces each widget's branch. It goes to /preview as `band` — the
 * server applies it and checks the branch; the recipe itself is never
 * changed. Null = nothing to apply.
 */
export function previewBand(band: BandFilters): PreviewBand | null {
  let period: RecipePeriod | null = null;
  if (band.period === 'custom') period = isYmd(band.from) && isYmd(band.to) ? (band.from <= band.to ? { from: band.from, to: band.to } : { from: band.to, to: band.from }) : null;
  else if (band.period !== 'own') period = { preset: band.period };
  if (!period && !band.branchId) return null;
  return { ...(band.branchId ? { branchId: band.branchId } : {}), ...(period ? { period } : {}) };
}

// ── Drawing (shared builders only) ───────────────────────────────────────

export function formatValue(unit: MetricUnit, v: number | null | undefined, compact = false): string {
  if (v == null || !Number.isFinite(v)) return '—';
  switch (unit) {
    case 'money': return formatRupee(v, compact);
    case 'minutes': return formatMinutes(v);
    case 'percent': return `${(Math.round(v * 10) / 10).toLocaleString('en-IN')}%`;
    default: return formatCount(v);
  }
}

function labelsFor(d: WidgetData): string[] {
  return d.bucketUnit ? d.categories.map((c) => bucketAxisLabel(c, d.bucketUnit)) : d.categories;
}

/** ECharts option for a widget, or null for the non-chart kinds (kpi, table). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function widgetChartOption(chart: ChartKind, d: WidgetData, theme: 'dark' | 'light'): any {
  if (d.state !== 'ok' || !d.series.length) return null;
  const money = d.unit === 'money';
  const valueFormatter = (v: number) => formatValue(d.unit, v);
  // One axis = one unit: draw the headline unit's series (a metric like patient
  // flow or turnaround also carries minutes / % series — the table shows those).
  const drawn = d.series.filter((s) => s.unit === d.unit);
  const plot = drawn.length ? drawn : d.series.slice(0, 1);
  const current = plot.filter((s) => !s.previous);
  const prev = plot.filter((s) => s.previous);
  const muted = CHART_OTHER[theme];
  const series = [...current, ...prev].map((s) => ({ name: s.name, data: s.values, ...(s.previous ? { color: muted } : {}) }));
  const labels = labelsFor(d);
  switch (chart) {
    case 'line': {
      const opt = buildBusinessLineOption(null, {
        categories: d.categories, labels, series, theme, valueFormatter: money ? rupeeFormatter : valueFormatter,
        ...(money ? { axisFormatter: rupeeAxisFormatter } : {}),
      });
      // The previous period is a quiet dashed line under the current one.
      if (prev.length && Array.isArray(opt?.series)) {
        opt.series = opt.series.map((s: { name: string; type: string; lineStyle?: object }) => (prev.some((p) => p.name === s.name) && s.type === 'line'
          ? { ...s, areaStyle: undefined, lineStyle: { ...(s.lineStyle ?? {}), type: 'dashed', width: 1.5 }, z: 1 } : s));
      }
      return opt;
    }
    case 'bar':
    case 'stacked_bar': {
      const one = chart === 'bar';
      const opt = buildStackedBarOption(null, {
        categories: d.categories, labels, theme, valueFormatter,
        series: one ? [...series.slice(0, 1), ...series.filter((_, i) => i >= current.length).slice(0, 1)] : series,
      });
      // Bars + compare: side by side, never stacked on each other.
      if (one && prev.length && Array.isArray(opt?.series)) opt.series = opt.series.map((s: object) => ({ ...s, stack: undefined }));
      if (one && !prev.length && opt) opt.legend = undefined;
      return opt;
    }
    case 'hbar':
      return buildHorizontalBarOption(null, { categories: labels, values: current[0]?.values ?? d.series[0].values, theme, valueFormatter });
    case 'grouped_hbar':
      return buildGroupedHBarOption({ categories: labels, series, theme, valueFormatter });
    case 'donut':
      return buildDonutOption({
        items: labels.map((name, i) => ({ name, value: (current[0] ?? d.series[0]).values[i] ?? 0 })), theme, valueFormatter,
      });
    default:
      return null;
  }
}

/** Chart height that fits its rows (ranked bars grow with the list). */
export function widgetChartHeight(chart: ChartKind, d: WidgetData | undefined): string {
  const n = d?.categories.length ?? 0;
  if (chart === 'hbar') return `${Math.max(160, 36 + Math.min(n, 12) * 30)}px`;
  if (chart === 'grouped_hbar') return `${Math.max(180, 56 + Math.min(n, 12) * 34)}px`;
  if (chart === 'donut') return '240px';
  return '240px';
}

export interface KpiView {
  value: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  spark: any | null;
}

export function kpiView(d: WidgetData, theme: 'dark' | 'light'): KpiView {
  const first = (d.series.find((s) => !s.previous) ?? d.series[0])?.values ?? [];
  const total = d.total ?? first.reduce((a, b) => a + b, 0);
  const spark = first.length > 1 && first.some((v) => v !== 0)
    ? buildSparklineOption({ data: first, labels: labelsFor(d), theme, valueFormatter: (v: number) => formatValue(d.unit, v) })
    : null;
  return { value: formatValue(d.unit, total), spark };
}

export interface TableView {
  columns: { field: string; headerName: string; num: boolean }[];
  rows: Record<string, string | number>[];
}

/** A widget's numbers as a table: one row per category, one column per series. */
export function tableView(w: RecipeWidget, d: WidgetData): TableView {
  const head = w.groupBy ? GROUP_LABELS[w.groupBy] : 'Item';
  const labels = labelsFor(d);
  const columns = [{ field: 'k', headerName: head, num: false }, ...d.series.map((s, i) => ({ field: `s${i}`, headerName: s.name, num: true }))];
  const rows = labels.map((label, r) => {
    const row: Record<string, string | number> = { k: label };
    d.series.forEach((s, i) => { row[`s${i}`] = formatValue(s.unit ?? d.unit, s.values[r]); });
    return row;
  });
  return { columns, rows };
}
