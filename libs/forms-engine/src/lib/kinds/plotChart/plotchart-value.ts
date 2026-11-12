import {
  GROWTH_MEASURES,
  GrowthMeasure,
  PartoReading,
  REF,
  Sex,
  Thresholds,
} from './chart-math';
import { GrowthPoint } from './chart-model';

/** The `plotChart` answer (API shape): one object; the preset decides which parts are used. */
export interface PlotChartValue {
  sex?: Sex;
  points?: GrowthPoint[];
  right?: EarValue;
  left?: EarValue;
  readings?: PartoReading[];
}
export interface EarValue {
  air?: Record<string, number | null>;
  bone?: Record<string, number | null>;
}
export type Preset = 'growth' | 'audiogram' | 'partograph';
export type Ear = 'right' | 'left';
export type Conduction = 'air' | 'bone';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function presetOf(config: Record<string, unknown> | undefined): Preset {
  const p = config?.['preset'];
  return p === 'audiogram' || p === 'partograph' ? p : 'growth';
}

/** The measures a growth chart plots (config order; all three when none are chosen). */
export function measuresOf(config: Record<string, unknown> | undefined): GrowthMeasure[] {
  const m = Array.isArray(config?.['measures']) ? (config!['measures'] as unknown[]) : [];
  const chosen = GROWTH_MEASURES.filter((x) => m.includes(x));
  const ordered = m.filter((x): x is GrowthMeasure => GROWTH_MEASURES.includes(x as GrowthMeasure));
  return chosen.length ? [...new Set(ordered)] : [...GROWTH_MEASURES];
}

export function sexOf(v: unknown): Sex | null {
  const s = obj(v)['sex'];
  return s === 'boy' || s === 'girl' ? s : null;
}

export function pointsOf(v: unknown): GrowthPoint[] {
  const a = obj(v)['points'];
  if (!Array.isArray(a)) return [];
  return a.flatMap((p) => {
    const o = obj(p);
    return GROWTH_MEASURES.includes(o['measure'] as GrowthMeasure) && isNum(o['age']) && isNum(o['value']) && o['value'] > 0
      ? [{ measure: o['measure'] as GrowthMeasure, age: o['age'], value: o['value'] }]
      : [];
  });
}

export function thresholdsOf(v: unknown, ear: Ear, kind: Conduction): Thresholds {
  const e = obj(obj(v)[ear])[kind];
  const out: Thresholds = {};
  for (const f of REF.audiogram.frequencies) {
    const d = obj(e)[String(f)];
    if (isNum(d)) out[f] = d;
  }
  return out;
}

export function readingsOf(v: unknown): PartoReading[] {
  const a = obj(v)['readings'];
  if (!Array.isArray(a)) return [];
  return a.flatMap((r) => {
    const o = obj(r);
    if (!isNum(o['hour'])) return [];
    const num = (k: string) => (isNum(o[k]) ? (o[k] as number) : undefined);
    return [{ hour: o['hour'], dilatation: num('dilatation'), descent: num('descent'), fhr: num('fhr'), contractions: num('contractions') }];
  });
}

/** Drop empty parts so a cleared chart is "no answer" (undefined). */
export function tidy(v: PlotChartValue): PlotChartValue | undefined {
  const out: PlotChartValue = {};
  if (v.sex) out.sex = v.sex;
  if (v.points?.length) out.points = v.points;
  for (const ear of ['right', 'left'] as const) {
    const e = v[ear];
    const air = Object.fromEntries(Object.entries(e?.air ?? {}).filter(([, d]) => isNum(d)));
    const bone = Object.fromEntries(Object.entries(e?.bone ?? {}).filter(([, d]) => isNum(d)));
    if (Object.keys(air).length || Object.keys(bone).length)
      out[ear] = { ...(Object.keys(air).length ? { air } : {}), ...(Object.keys(bone).length ? { bone } : {}) };
  }
  if (v.readings?.length) out.readings = v.readings;
  // a sex alone is kept (the doctor picks it before adding a reading); the server counts only plotted values as an answer
  return Object.keys(out).length ? out : undefined;
}
