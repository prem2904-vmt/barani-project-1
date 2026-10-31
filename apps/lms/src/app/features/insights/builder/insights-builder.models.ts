/**
 * Insights dashboard builder (BETA `assistant`, dev only) — the recipe format
 * and the wire shapes the UI codes against. ONE home for these shapes: the
 * API service (`insights-builder-api.service.ts`) and the pure helpers
 * (`insights-builder-logic.ts`) read only this file, so aligning with the
 * backend later is a change here + in the normalisers.
 *
 * Principle: PF Sense writes the RECIPE only (it sees the metric menu and the
 * current recipe, never data). The server validates the recipe, runs the
 * queries with the viewer's own permissions (money only with
 * view_financial_analytics) and returns numbers; the UI draws them with the
 * existing business-chart builders.
 *
 *   GET    /api/insights/metrics                      → InsightsMetric[] (a plain array)
 *   GET    /api/insights/options                      → InsightsOptions (pickers + limits + canSeeMoney / canShare)
 *   GET    /api/insights/dimensions/{kind}?q=         → DimensionValue[] (department | test | referrer | branch, ≤ 25)
 *   POST   /api/insights/preview { recipe, band? }    → InsightsPreview (band = branch / period over every widget)
 *   GET    /api/insights/dashboards                   → InsightsDashboardSummary[]
 *   GET    /api/insights/dashboards/{id}              → InsightsDashboard
 *   POST   /api/insights/dashboards                   → InsightsDashboard (draft)
 *   PUT    /api/insights/dashboards/{id}              → InsightsDashboard
 *   DELETE /api/insights/dashboards/{id}
 *   POST   /api/insights/dashboards/{id}/publish      → InsightsDashboard
 *   POST   /api/insights/dashboards/{id}/unpublish    → InsightsDashboard (back to a private draft)
 *   GET    /api/insights/dashboards/{id}/versions     → InsightsDashboardVersion[]
 *   GET    /api/insights/dashboards/{id}/versions/{n} → InsightsDashboardVersionDetail
 *   POST   /api/insights/dashboards/{id}/restore { version } → InsightsDashboard
 *   POST   /api/assistant/insights/chat { provider, recipe?, messages } → InsightsChatReply
 *
 * A save whose `version` is stale answers 409 `version_conflict`.
 */
import type { AssistantProviderId, AssistantTurn } from '../../../shared/assistant/assistant.models';

export const CHART_KINDS = ['line', 'bar', 'stacked_bar', 'hbar', 'grouped_hbar', 'donut', 'kpi', 'table'] as const;
export type ChartKind = typeof CHART_KINDS[number];

export const GROUP_BYS = [
  'day', 'week', 'month', 'department', 'test', 'referrer', 'branch', 'stage', 'hour', 'weekday', 'payment_mode', 'reason', 'staff', 'status',
] as const;
export type GroupBy = typeof GROUP_BYS[number];

export const PERIOD_PRESETS = ['today', '7d', 'month', 'lastMonth', 'quarter', 'all'] as const;
export type RecipePeriodPreset = typeof PERIOD_PRESETS[number];

export type RecipePeriod = { preset: RecipePeriodPreset } | { from: string; to: string };

export const WIDGET_SIZES = ['s', 'm', 'l'] as const;
export type WidgetSize = typeof WIDGET_SIZES[number];

export interface WidgetFilters {
  branchId?: string;
  departmentId?: string;
  testId?: string;
  refDoctorId?: string;
}

export interface RecipeWidget {
  id: string;
  title: string;
  metric: string;
  chart: ChartKind;
  groupBy?: GroupBy;
  filters?: WidgetFilters;
  period: RecipePeriod;
  compare?: boolean;
  size: WidgetSize;
}

/** Recipe v1 — widget order = layout order. */
export interface InsightsRecipe {
  version: 1;
  title: string;
  description?: string;
  widgets: RecipeWidget[];
}

export type MetricUnit = 'count' | 'money' | 'minutes' | 'percent';

export type FilterKey = keyof WidgetFilters;
/** time = day/week/month buckets; ordered = hour, weekday, stage (fits a line); category = names. */
export type GroupByKind = 'time' | 'ordered' | 'category';

/** One entry of the metric menu (already filtered by the viewer's permissions). */
export interface InsightsMetric {
  id: string;
  label: string;
  description: string;
  money: boolean;
  unit: MetricUnit;
  groupBy: GroupBy[];
  charts: ChartKind[];
  defaultChart?: ChartKind;
  defaultGroupBy?: GroupBy;
  /** Which widget filters this metric can be narrowed by. */
  filters: FilterKey[];
  /** "Compare with the previous period" is offered (kpi / line / bar only). */
  supportsCompare: boolean;
  /** False = live (ignores the period, e.g. pending work right now). */
  usesPeriod: boolean;
  /** Several series (some may carry their own unit). */
  multiSeries: boolean;
  groupByKinds: Partial<Record<GroupBy, GroupByKind>>;
}

/** GET /api/insights/options — the editor's pickers and limits. */
export interface InsightsOptions {
  charts: ChartKind[];
  periodPresets: RecipePeriodPreset[];
  sizes: WidgetSize[];
  maxWidgets: number;
  maxCustomDays: number;
  canSeeMoney: boolean;
  /** May share wider than "just me" (roles / whole lab). */
  canShare: boolean;
}

export type DimensionKind = 'department' | 'test' | 'referrer' | 'branch';
export interface DimensionValue { id: string; name: string; }

export type WidgetState = 'ok' | 'hidden' | 'empty' | 'error';

export interface WidgetSeries {
  name: string;
  /** Index-aligned with the categories; a missing value is 0. */
  values: number[];
  /** This series' own unit (a multi-series metric can mix counts and minutes). */
  unit: MetricUnit;
  /** The same series for the previous equal period (compare on). */
  previous?: boolean;
}

/** One widget's numbers from /preview. Money widgets the viewer may not see
 *  come back `state: 'hidden'` with no numbers at all. */
export interface WidgetData {
  id: string;
  state: WidgetState;
  message?: string | null;
  /** Why a chart is in the error state: `too_detailed` | `timeout` | `failed` … */
  code?: string | null;
  unit: MetricUnit;
  /** Time buckets (day/week/month/quarter) when grouped by time, else null. */
  bucketUnit?: string | null;
  /** X labels: bucket keys (YYYY-MM-DD…) or category names. */
  categories: string[];
  series: WidgetSeries[];
  /** KPI: the headline number and its change vs the previous window. */
  total?: number | null;
  deltaPct?: number | null;
}

export interface InsightsPreview {
  widgets: WidgetData[];
  /** Plain notes about parts of the recipe the server dropped. */
  notes: string[];
  /** The recipe as the server cleaned it (what was actually run), when sent. */
  recipe?: InsightsRecipe | null;
}

/** What the band applies over every widget at /preview (the saved recipe is untouched). */
export interface PreviewBand {
  branchId?: string;
  period?: RecipePeriod;
}

export type DashboardVisibility = 'private' | 'roles' | 'lab';
export type DashboardStatus = 'draft' | 'published';

export interface InsightsDashboardSummary {
  id: string;
  title: string;
  status: DashboardStatus;
  visibility: DashboardVisibility;
  version: number;
  updatedAt: string | null;
  /** False for a lab-wide / role dashboard someone else owns. */
  canEdit: boolean;
  /** The caller owns it. */
  mine: boolean;
  ownerName?: string | null;
  widgetCount: number;
}

export interface InsightsDashboard extends InsightsDashboardSummary {
  recipe: InsightsRecipe;
  roleIds: string[];
  updatedByName?: string | null;
  /** May share wider than "just me" (roles / whole lab). */
  canShare: boolean;
  /** Plain notes from the server about parts of the saved recipe it dropped. */
  notes: string[];
}

export interface InsightsDashboardVersion {
  version: number;
  savedAt: string | null;
  savedByName?: string | null;
  title: string;
  widgetCount: number;
  /** The version the dashboard is on now. */
  current: boolean;
}

export interface InsightsDashboardVersionDetail {
  version: number;
  title: string;
  savedAt: string | null;
  recipe: InsightsRecipe;
}

export interface SaveDashboardRequest {
  title: string;
  recipe: InsightsRecipe;
  visibility: DashboardVisibility;
  roleIds: string[];
  /** The version this edit started from (the server may refuse a stale one). */
  version?: number;
}

export interface PublishDashboardRequest {
  visibility: DashboardVisibility;
  roleIds: string[];
}

export interface InsightsChatRequest {
  provider: AssistantProviderId;
  recipe?: InsightsRecipe | null;
  messages: AssistantTurn[];
}

export interface InsightsChatReply {
  reply: string;
  /** The proposed recipe (validated by the server); null = just an answer. */
  recipe: InsightsRecipe | null;
  /** What changed, in plain words ("Added Patient flow by hour"). */
  changes: string[];
  /** Plain notes: parts of the proposal the server dropped or adjusted. */
  notes: string[];
  provider: string;
  model: string;
}
