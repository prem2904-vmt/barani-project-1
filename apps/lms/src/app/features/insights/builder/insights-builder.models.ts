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
 *   GET    /api/insights/metrics                      → InsightsMetric[]
 *   POST   /api/insights/preview { recipe }           → InsightsPreview
 *   GET    /api/insights/dashboards                   → InsightsDashboardSummary[]
 *   GET    /api/insights/dashboards/{id}              → InsightsDashboard
 *   POST   /api/insights/dashboards                   → InsightsDashboard (draft)
 *   PUT    /api/insights/dashboards/{id}              → InsightsDashboard
 *   DELETE /api/insights/dashboards/{id}
 *   POST   /api/insights/dashboards/{id}/publish      → InsightsDashboard
 *   GET    /api/insights/dashboards/{id}/versions     → InsightsDashboardVersion[]
 *   POST   /api/insights/dashboards/{id}/restore { version } → InsightsDashboard
 *   POST   /api/assistant/insights/chat { provider, recipe?, messages } → InsightsChatReply
 */
import type { AssistantProviderId, AssistantTurn } from '../../../shared/assistant/assistant.models';

export const CHART_KINDS = ['line', 'bar', 'stacked_bar', 'hbar', 'grouped_hbar', 'donut', 'kpi', 'table'] as const;
export type ChartKind = typeof CHART_KINDS[number];

export const GROUP_BYS = ['day', 'week', 'month', 'department', 'test', 'referrer', 'branch', 'stage', 'hour', 'weekday', 'payment_mode'] as const;
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

export type MetricUnit = 'count' | 'money' | 'minutes' | 'percent' | 'ratio';

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
}

export type WidgetState = 'ok' | 'hidden' | 'empty' | 'error';

export interface WidgetSeries { name: string; values: number[]; }

/** One widget's numbers from /preview. Money widgets the viewer may not see
 *  come back `state: 'hidden'` with no numbers at all. */
export interface WidgetData {
  id: string;
  state: WidgetState;
  message?: string | null;
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
}

export interface InsightsDashboard extends InsightsDashboardSummary {
  recipe: InsightsRecipe;
  roleIds: string[];
  ownerName?: string | null;
  updatedByName?: string | null;
}

export interface InsightsDashboardVersion {
  version: number;
  savedAt: string | null;
  savedByName?: string | null;
  title: string;
  widgetCount: number;
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
  provider: string;
  model: string;
}
