/**
 * Sample values for the Test Master chart preview (docs/REPORT-CHARTS.md §7):
 * a report snapshot's worth of tests built from the test's own definition —
 * its time points / values, units and reference groups — so the author sees
 * the chart that WILL print, before any patient has been tested.
 *
 * Each point sits inside its normal band (the band the ONE resolver picks for
 * the preview patient); exactly one point is made abnormal so the author also
 * sees the abnormal style.
 */
import { flagAgainst, selectReferenceRange, type RangeLike } from '../reference-range';
import { resolveParamEntryKind } from '../param-entry-kind';
import { parseParametersBlob, readParameters } from '../test-parameters';
import type { ChartTestLike } from './report-chart.data';

export interface ChartParamInfo {
  name: string;
  title?: string | null;
  unit?: string | null;
  referenceRanges?: RangeLike[] | null;
}

export interface ChartMemberInfo {
  testId: string;
  name: string;
  code?: string | null;
  params: ChartParamInfo[];
}

/** What the chart editor knows about the test it sits on. */
export interface ChartEditorContext {
  /** The test / profile whose layout carries the chart. */
  ownerId: string;
  /** A repetitive profile: time points are available. */
  series: boolean;
  timepoints: Array<{ offsetMin: number; members: ChartMemberInfo[] }>;
  /** Numeric values (the test's own, or its members' for a profile). */
  params: ChartParamInfo[];
}

/** The preview patient (the same one the PDF live preview uses). */
export const PREVIEW_PATIENT = { sex: 'F' as const, ageYears: 35 };

const SHAPE = [0.3, 0.72, 0.82, 0.6, 0.42, 0.55, 0.66, 0.38];

function sampleFor(p: ChartParamInfo, i: number, abnormal: boolean): Record<string, unknown> {
  const band = selectReferenceRange(p.referenceRanges ?? [], PREVIEW_PATIENT.sex, PREVIEW_PATIENT.ageYears);
  const lo = band?.min ?? null, hi = band?.max ?? null;
  const f = SHAPE[i % SHAPE.length];
  let v: number;
  if (lo != null && hi != null) v = lo + (hi - lo) * f;
  else if (hi != null) v = hi * (0.55 + f * 0.4);
  else if (lo != null) v = lo * (1.1 + f * 0.5);
  else v = 80 + f * 60;
  if (abnormal) v = hi != null ? hi * 1.18 : lo != null ? lo * 0.8 : v * 1.4;
  const value = Math.abs(v) >= 20 ? Math.round(v) : Math.round(v * 10) / 10;
  const flag = flagAgainst(band ?? null, value);
  return { value, unit: p.unit ?? null, flag: flag ?? '', low: lo, high: hi };
}

/** The sample snapshot tests for the editor preview. */
export function sampleChartTests(ctx: ChartEditorContext): ChartTestLike[] {
  if (ctx.series && ctx.timepoints.length) {
    const abnormalAt = Math.min(2, ctx.timepoints.length - 1);
    return ctx.timepoints.flatMap((tp, i) => tp.members.map(m => ({
      testId: m.testId, name: m.name, code: m.code ?? null,
      packageTestId: ctx.ownerId, profileTestId: ctx.ownerId, repeatOffsetMin: tp.offsetMin,
      result: { values: Object.fromEntries(m.params.map(p => [p.name, sampleFor(p, i, i === abnormalAt)])) },
    })));
  }
  const values: Record<string, unknown> = {};
  ctx.params.forEach((p, i) => { values[p.name] = sampleFor(p, i, i === 1); });
  return [{ testId: ctx.ownerId, name: 'Sample', result: { values } }];
}

/** Distinct units among the time points' numeric values (line pickers). */
export function seriesUnits(ctx: ChartEditorContext): string[] {
  const out: string[] = [];
  for (const tp of ctx.timepoints) for (const m of tp.members) for (const p of m.params) {
    const u = (p.unit ?? '').trim();
    if (u && !out.some(x => x.toLowerCase() === u.toLowerCase())) out.push(u);
  }
  return out;
}

/** The numeric, printing values of a TestEntity.Parameters JSON. */
export function numericParamsOf(parametersJson: string | null | undefined, fallbackUnit?: string | null): ChartParamInfo[] {
  return readParameters(parseParametersBlob(parametersJson ?? null))
    .filter(p => (p.name ?? '').trim() && resolveParamEntryKind(p as never) === 'number'
      && (p as { printOnReport?: boolean }).printOnReport !== false)
    .map(p => ({ name: p.name.trim(), title: p.title || null, unit: p.unit || fallbackUnit || null,
                 referenceRanges: (p.referenceRanges ?? []) as RangeLike[] }));
}

/** Sample values for a timed-series profile preview, keyed "testId@offset". */
export function sampleSeriesValues(ownerId: string,
  members: ReadonlyArray<{ id: string; name: string; parameters?: string | null; offsetMin?: number | null }>,
): Map<string, Record<string, unknown>> {
  const offsets = [...new Set(members.map(m => m.offsetMin).filter((o): o is number => o != null))].sort((a, b) => a - b);
  const ctx: ChartEditorContext = {
    ownerId, series: true, params: [],
    timepoints: offsets.map(o => ({ offsetMin: o, members: members.filter(m => m.offsetMin === o)
      .map(m => ({ testId: m.id, name: m.name, params: numericParamsOf(m.parameters) })) })),
  };
  const out = new Map<string, Record<string, unknown>>();
  for (const t of sampleChartTests(ctx)) {
    const vals = (t.result as { values?: Record<string, unknown> } | null)?.values ?? {};
    out.set(`${t.testId}@${t.repeatOffsetMin}`, vals);
  }
  return out;
}
