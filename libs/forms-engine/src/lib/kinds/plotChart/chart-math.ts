import reference from './reference.json';

/**
 * Clinical reference maths for the `plotChart` kind: the TypeScript twin of the C# engine's `ChartReference` / `ChartMath`
 * (prefrontal-mw `Prefrontal/CaseSheets/Engine/Components/Common/Charts`). The data is ONE json (`reference.json`, sources written inside it),
 * byte-identical in both repos; `charts.spec.ts` runs the shared vectors (`testing/casesheet-charts.vectors.json`) against both.
 */
interface LmsTable {
  from: number;
  L: number[];
  M: number[];
  S: number[];
}
interface Reference {
  growth: {
    centileLines: number[];
    centileZ: number[];
    measures: Record<string, { unit: string; label: string; sex: Record<string, LmsTable> }>;
  };
  audiogram: {
    frequencies: number[];
    ptaFrequencies: number[];
    minDb: number;
    maxDb: number;
    stepDb: number;
    normalBelowDb: number;
    gapDb: number;
    grades: { from: number; name: string }[];
  };
  partograph: {
    startCm: number;
    endCm: number;
    alertCmPerHour: number;
    actionOffsetHours: number;
    maxHours: number;
    fhrLow: number;
    fhrHigh: number;
  };
}
export const REF = reference as unknown as Reference;

export type Sex = 'boy' | 'girl';
export type GrowthMeasure = 'weight' | 'height' | 'head';
export const GROWTH_MEASURES: readonly GrowthMeasure[] = ['weight', 'height', 'head'];

export interface Lms {
  L: number;
  M: number;
  S: number;
}

export function growthUnit(m: GrowthMeasure): string {
  return REF.growth.measures[m].unit;
}
export function growthLabel(m: GrowthMeasure): string {
  return REF.growth.measures[m].label;
}

/** First and last whole month the reference covers for a measure (the sexes share them). */
export function growthRange(m: GrowthMeasure): { from: number; to: number } {
  const t = REF.growth.measures[m].sex['boys'];
  return { from: t.from, to: t.from + t.L.length - 1 };
}

/** L, M and S at an age in months, read linearly between the two whole months around it; null outside the table. */
export function lmsAt(m: GrowthMeasure, sex: Sex, ageMonths: number): Lms | null {
  const t = REF.growth.measures[m]?.sex[sex === 'boy' ? 'boys' : 'girls'];
  if (!t || !Number.isFinite(ageMonths)) return null;
  const to = t.from + t.L.length - 1;
  if (ageMonths < t.from || ageMonths > to) return null;
  const i = Math.floor(ageMonths - t.from);
  if (i >= t.L.length - 1) return { L: t.L[t.L.length - 1], M: t.M[t.M.length - 1], S: t.S[t.S.length - 1] };
  const f = ageMonths - t.from - i;
  const at = (a: number[]) => a[i] + (a[i + 1] - a[i]) * f;
  return { L: at(t.L), M: at(t.M), S: at(t.S) };
}

/** The LMS method (Cole and Green): z = ((x / M)^L - 1) / (L S), or ln(x / M) / S when L is 0. */
export function zScore(x: number, p: Lms): number {
  return Math.abs(p.L) < 1e-9 ? Math.log(x / p.M) / p.S : (Math.pow(x / p.M, p.L) - 1) / (p.L * p.S);
}

/** The value at a z-score: how the centile curves are drawn. */
export function valueAt(z: number, p: Lms): number {
  return Math.abs(p.L) < 1e-9 ? p.M * Math.exp(p.S * z) : p.M * Math.pow(1 + p.L * p.S * z, 1 / p.L);
}

/** z-score of a reading, or null when the sex is unknown or the age is outside the reference for that measure. */
export function growthZ(m: GrowthMeasure, sex: Sex | null | undefined, ageMonths: number, value: number): number | null {
  if (!sex || !(value > 0)) return null;
  const p = lmsAt(m, sex, ageMonths);
  return p ? zScore(value, p) : null;
}

/** 0 = below the 3rd centile line ... 7 = above the 97th. A value exactly on a line belongs to the band above it. */
export function band(z: number): number {
  let b = 0;
  REF.growth.centileZ.forEach((line, i) => {
    if (z >= line) b = i + 1;
  });
  return b;
}

const ORDINALS = ['3rd', '10th', '25th', '50th', '75th', '90th', '97th'];
export function bandWords(b: number): string {
  if (b <= 0) return 'below the 3rd centile';
  if (b >= ORDINALS.length) return 'above the 97th centile';
  return `${ORDINALS[b - 1]}-${ORDINALS[b]} centile`;
}

const g = (n: number) => String(Number(n.toPrecision(12)));

/** "birth", "7 months", "3 years 4 months". */
export function ageWords(months: number): string {
  if (months <= 0) return 'birth';
  if (months < 24) {
    const m = Math.round(months * 10) / 10;
    return m === 1 ? '1 month' : `${g(m)} months`;
  }
  const total = Math.round(months);
  const years = Math.floor(total / 12);
  const rest = total % 12;
  return rest === 0 ? `${years} years` : `${years} years ${rest} month${rest === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------- audiogram
export type Thresholds = Record<number, number>;
export interface EarResult {
  pta: number | null;
  grade: string | null;
  type: string | null;
  hasAir: boolean;
}

/** "moderate sensorineural hearing loss", "normal hearing"; null when no average could be worked out. */
export function earWords(r: EarResult): string | null {
  if (!r.grade) return null;
  return r.grade === 'normal hearing' ? r.grade : `${r.grade}${r.type ? ' ' + r.type : ''} hearing loss`;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Pure-tone average (air, 500-4000 Hz, whole dB half up), WHO grade, and the type from the air-bone gap. */
export function analyseEar(air: Thresholds, bone: Thresholds): EarResult {
  const a = REF.audiogram;
  if (Object.keys(air).length === 0) return { pta: null, grade: null, type: null, hasAir: false };
  if (a.ptaFrequencies.some((f) => air[f] === undefined)) return { pta: null, grade: null, type: null, hasAir: true };
  const pta = Math.floor(mean(a.ptaFrequencies.map((f) => air[f])) + 0.5);
  const grade = [...a.grades].reverse().find((x) => pta >= x.from)!.name;
  if (grade === 'normal hearing') return { pta, grade, type: null, hasAir: true };
  const common = a.ptaFrequencies.filter((f) => bone[f] !== undefined);
  if (common.length < 2) return { pta, grade, type: null, hasAir: true };
  const gap = mean(common.map((f) => air[f] - bone[f]));
  const boneAvg = mean(common.map((f) => bone[f]));
  const type = gap < a.gapDb ? 'sensorineural' : boneAvg < a.normalBelowDb ? 'conductive' : 'mixed';
  return { pta, grade, type, hasAir: true };
}

// ---------------------------------------------------------------- partograph
export interface PartoReading {
  hour: number;
  dilatation?: number | null;
  descent?: number | null;
  fhr?: number | null;
  contractions?: number | null;
}
const P = REF.partograph;
/** Cervical dilatation (cm) the alert line is at, at this hour after the active phase began. */
export const alertLine = (hour: number) => P.startCm + P.alertCmPerHour * hour;
/** The action line: the alert line four hours later. */
export const actionLine = (hour: number) => P.startCm + P.alertCmPerHour * (hour - P.actionOffsetHours);

const byHour = (rs: PartoReading[]) => [...rs].sort((a, b) => a.hour - b.hour);
/** The first reading (in time order) whose dilatation is to the right of (below) the alert line; null when none. */
export function alertCrossedAt(rs: PartoReading[]): number | null {
  return byHour(rs).find((r) => typeof r.dilatation === 'number' && r.hour > 0 && r.dilatation < alertLine(r.hour))?.hour ?? null;
}
export function actionCrossedAt(rs: PartoReading[]): number | null {
  return byHour(rs).find((r) => typeof r.dilatation === 'number' && r.hour >= P.actionOffsetHours && r.dilatation < actionLine(r.hour))?.hour ?? null;
}
