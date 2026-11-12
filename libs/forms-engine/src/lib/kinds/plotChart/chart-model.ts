import {
  GrowthMeasure,
  PartoReading,
  REF,
  Sex,
  Thresholds,
  actionLine,
  alertLine,
  growthLabel,
  growthRange,
  growthUnit,
  lmsAt,
  valueAt,
} from './chart-math';

/**
 * A chart as plain data, the twin of the C# `ChartSpec` (panels stacked on one shared x axis, each with its own y axis, bands and series).
 * The fill draws it with `fe-chart` (real text, theme colours); the printout draws the C# twin as vector strokes.
 */
export interface ChartTick {
  v: number;
  label: string;
}
export interface ChartBand {
  from: number;
  to: number;
  /** A translucent colour, so it reads on a light and on a dark card. */
  color: string;
}
export type ChartMarker = 'circle' | 'cross' | 'less' | 'greater' | 'dot' | 'bar' | 'none';
export interface ChartSeries {
  name: string;
  color: string;
  line: boolean;
  dashed?: boolean;
  width?: number;
  marker: ChartMarker;
  points: { x: number; y: number }[];
}
export interface ChartPanel {
  weight: number;
  yMin: number;
  yMax: number;
  inverted?: boolean;
  yTicks: ChartTick[];
  bands: ChartBand[];
  series: ChartSeries[];
}
export interface ChartSpec {
  xMin: number;
  xMax: number;
  xTicks: ChartTick[];
  panels: ChartPanel[];
  aspect: number;
}

const label = (v: number) => String(Math.round(v * 1e4) / 1e4 || 0);

/** Round axis scales: ticks at round numbers covering [min, max], and the padded range they span. */
export function niceScale(min: number, max: number, target = 4): { ticks: ChartTick[]; min: number; max: number } {
  if (max - min < 1e-9) {
    min -= 1;
    max += 1;
  }
  const raw = (max - min) / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw - 1e-12)!;
  const lo = Math.floor(min / step + 1e-9) * step;
  const hi = Math.ceil(max / step - 1e-9) * step;
  const ticks: ChartTick[] = [];
  for (let v = lo; v <= hi + step / 1000; v += step) {
    const r = Math.round(v * 1e6) / 1e6;
    ticks.push({ v: r, label: label(r) });
  }
  return { ticks, min: lo, max: hi };
}

const CURVE_COLORS = ['#94a3b8', '#94a3b8', '#94a3b8', '#64748b', '#94a3b8', '#94a3b8', '#94a3b8'];
const PATIENT = '#e11d48';

export interface GrowthPoint {
  measure: GrowthMeasure;
  age: number;
  value: number;
}

/** WHO centile curves (3rd to 97th) for a measure and sex with the patient's points on them; null when nothing is plotted. */
export function growthChart(measure: GrowthMeasure, sex: Sex, points: GrowthPoint[]): ChartSpec | null {
  const pts = points.filter((p) => p.measure === measure && Number.isFinite(p.age) && Number.isFinite(p.value) && p.value > 0);
  const range = growthRange(measure);
  if (!pts.length) return null;
  const maxAge = Math.max(...pts.map((p) => p.age));
  let window = [24, 60, 120, 228].find((w) => w >= maxAge) ?? 228;
  window = Math.min(window, range.to);
  const shown = pts.filter((p) => p.age <= window);
  if (!shown.length) return null;
  const step = window > 60 ? 3 : 1;
  const ages: number[] = [];
  for (let a = 0; a <= window; a += step) ages.push(a);
  if (ages[ages.length - 1] !== window) ages.push(window);
  const usable = ages.filter((a) => a >= range.from);

  const zs = REF.growth.centileZ;
  const lines = REF.growth.centileLines;
  const curves: ChartSeries[] = zs.map((z, i) => ({
    name: `P${lines[i]}`,
    color: CURVE_COLORS[i],
    line: true,
    width: i === 3 ? 2.2 : 1,
    marker: 'none',
    points: usable.map((a) => ({ x: a, y: valueAt(z, lmsAt(measure, sex, a)!) })),
  }));
  const lo = Math.min(...curves[0].points.map((p) => p.y), ...shown.map((p) => p.value));
  const hi = Math.max(...curves[curves.length - 1].points.map((p) => p.y), ...shown.map((p) => p.value));
  const y = niceScale(lo, hi, 5);
  const years = window > 24;
  const tickStep = window <= 24 ? 3 : window <= 120 ? 12 : 24;
  const xTicks: ChartTick[] = [];
  for (let m = 0; m <= window; m += tickStep) xTicks.push({ v: m, label: label(years ? m / 12 : m) });
  curves.push({
    name: 'Patient',
    color: PATIENT,
    line: true,
    width: 1.8,
    marker: 'dot',
    points: [...shown].sort((a, b) => a.age - b.age).map((p) => ({ x: p.age, y: p.value })),
  });
  return { xMin: 0, xMax: window, xTicks, aspect: 1.7, panels: [{ weight: 1, yMin: y.min, yMax: y.max, yTicks: y.ticks, bands: [], series: curves }] };
}

/** "Weight for age, girl (kg)" and the axis note under it. */
export function growthCaption(measure: GrowthMeasure, sex: Sex, spec: ChartSpec): { title: string; note: string } {
  return {
    title: `${growthLabel(measure)} for age, ${sex} (${growthUnit(measure)})`,
    note: `Lines: 3rd, 10th, 25th, 50th, 75th, 90th and 97th centiles, WHO. Age in ${spec.xMax > 24 ? 'years' : 'months'}.`,
  };
}

const GRADE_TINTS = [
  'rgba(34,197,94,0.10)',
  'rgba(234,179,8,0.10)',
  'rgba(245,158,11,0.13)',
  'rgba(249,115,22,0.15)',
  'rgba(239,68,68,0.15)',
  'rgba(220,38,38,0.19)',
  'rgba(185,28,28,0.23)',
];

/** One ear's audiogram: dB HL against frequency, air (solid) and bone (dashed), standard symbols, WHO grade bands behind. */
export function audiogramChart(ear: 'right' | 'left', air: Thresholds, bone: Thresholds): ChartSpec {
  const a = REF.audiogram;
  const right = ear === 'right';
  const color = right ? '#dc2626' : '#2563eb';
  const series = (name: string, d: Thresholds, marker: ChartMarker, dashed: boolean): ChartSeries => ({
    name,
    color,
    line: true,
    dashed,
    width: 1.4,
    marker,
    points: a.frequencies.flatMap((f, i) => (d[f] !== undefined ? [{ x: i, y: d[f] }] : [])),
  });
  const ticks: ChartTick[] = [];
  for (let v = a.minDb; v <= a.maxDb; v += 10) ticks.push({ v, label: label(v) });
  return {
    xMin: -0.5,
    xMax: a.frequencies.length - 0.5,
    aspect: 1.25,
    xTicks: a.frequencies.map((f, i) => ({ v: i, label: f >= 1000 ? `${f / 1000}k` : String(f) })),
    panels: [
      {
        weight: 1,
        yMin: a.minDb,
        yMax: a.maxDb,
        inverted: true,
        yTicks: ticks,
        bands: a.grades.map((g, i) => ({
          from: i === 0 ? a.minDb : g.from,
          to: i + 1 < a.grades.length ? a.grades[i + 1].from : a.maxDb,
          color: GRADE_TINTS[Math.min(i, GRADE_TINTS.length - 1)],
        })),
        series: [series('Air', air, right ? 'circle' : 'cross', false), series('Bone', bone, right ? 'less' : 'greater', true)],
      },
    ],
  };
}

/** The partograph: cervix (X) with the alert and action lines, descent (O), fetal heart rate and contractions, over the hours. */
export function partographChart(readings: PartoReading[]): ChartSpec {
  const p = REF.partograph;
  const maxHour = readings.length ? Math.max(...readings.map((r) => r.hour)) : 0;
  const xMax = Math.min(24, Math.max(p.maxHours, Math.ceil(maxHour / 2) * 2));
  const ticks = (from: number, to: number, step: number): ChartTick[] => {
    const t: ChartTick[] = [];
    for (let v = from; v <= to + 1e-9; v += step) t.push({ v, label: label(v) });
    return t;
  };
  const of = (pick: (r: PartoReading) => number | null | undefined) =>
    [...readings].sort((a, b) => a.hour - b.hour).flatMap((r) => (typeof pick(r) === 'number' ? [{ x: r.hour, y: pick(r) as number }] : []));
  const alertEnd = Math.min(xMax, (p.endCm - p.startCm) / p.alertCmPerHour);
  const actionEnd = Math.min(xMax, p.actionOffsetHours + (p.endCm - p.startCm) / p.alertCmPerHour);
  return {
    xMin: 0,
    xMax,
    aspect: 1.05,
    xTicks: ticks(0, xMax, 1),
    panels: [
      {
        weight: 3,
        yMin: p.startCm,
        yMax: p.endCm,
        yTicks: ticks(p.startCm, p.endCm, 1),
        bands: [],
        series: [
          { name: 'Alert line', color: '#d97706', line: true, dashed: true, width: 1.6, marker: 'none', points: [{ x: 0, y: p.startCm }, { x: alertEnd, y: alertLine(alertEnd) }] },
          { name: 'Action line', color: '#dc2626', line: true, width: 1.6, marker: 'none', points: [{ x: p.actionOffsetHours, y: p.startCm }, { x: actionEnd, y: actionLine(actionEnd) }] },
          { name: 'Cervix', color: '#3b82f6', line: true, marker: 'cross', points: of((r) => r.dilatation) },
        ],
      },
      { weight: 1.3, yMin: 0, yMax: 5, yTicks: ticks(0, 5, 1), bands: [], series: [{ name: 'Head', color: '#14b8a6', line: true, marker: 'circle', points: of((r) => r.descent) }] },
      {
        weight: 1.5,
        yMin: 80,
        yMax: 200,
        yTicks: ticks(80, 200, 40),
        bands: [{ from: p.fhrLow, to: p.fhrHigh, color: 'rgba(34,197,94,0.12)' }],
        series: [{ name: 'Fetal heart rate', color: '#e11d48', line: true, marker: 'dot', points: of((r) => r.fhr) }],
      },
      { weight: 1, yMin: 0, yMax: 5, yTicks: ticks(0, 5, 1), bands: [], series: [{ name: 'Contractions', color: '#8b5cf6', line: false, marker: 'bar', points: of((r) => r.contractions) }] },
    ],
  };
}

// ---------------------------------------------------------------- layout: primitives for the template
export interface Laid {
  w: number;
  h: number;
  panels: LaidPanel[];
  xTicks: { x: number; y: number; label: string }[];
}
export interface LaidPanel {
  x: number;
  y: number;
  width: number;
  height: number;
  bands: { y: number; height: number; color: string }[];
  vgrid: number[];
  hgrid: { y: number; label: string }[];
  series: { name: string; color: string; dashed: boolean; width: number; line: string | null; marks: { x: number; y: number; d: string | null; bar: number | null; marker: ChartMarker }[] }[];
}

const LEFT = 38;
const RIGHT = 12;
const TOP = 8;
const BOTTOM = 22;
const GAP = 18; // two 11px number labels meet at a panel boundary: the gap must hold both without touching
export const CHART_W = 600;

/** Where everything goes in a 600-wide box. Pure; the component draws what this returns. */
export function layoutChart(c: ChartSpec): Laid {
  const w = CHART_W;
  const h = w / Math.min(4, Math.max(0.5, c.aspect));
  const x0 = LEFT;
  const x1 = w - RIGHT;
  const X = (x: number) => x0 + (c.xMax <= c.xMin ? 0.5 : (x - c.xMin) / (c.xMax - c.xMin)) * (x1 - x0);
  const total = c.panels.reduce((s, p) => s + Math.max(0.1, p.weight), 0);
  const avail = h - TOP - BOTTOM - GAP * Math.max(0, c.panels.length - 1);
  let y0 = TOP;
  const panels: LaidPanel[] = c.panels.map((p) => {
    const ph = (avail * Math.max(0.1, p.weight)) / total;
    const top = y0;
    const bottom = top + ph;
    y0 = bottom + GAP;
    const Y = (v: number) => {
      const f = p.yMax <= p.yMin ? 0.5 : (Math.min(p.yMax, Math.max(p.yMin, v)) - p.yMin) / (p.yMax - p.yMin);
      return p.inverted ? top + f * ph : bottom - f * ph;
    };
    return {
      x: x0,
      y: top,
      width: x1 - x0,
      height: ph,
      bands: p.bands.flatMap((b) => {
        const a = Y(Math.max(b.from, p.yMin));
        const z = Y(Math.min(b.to, p.yMax));
        return Math.abs(a - z) > 0.01 ? [{ y: Math.min(a, z), height: Math.abs(a - z), color: b.color }] : [];
      }),
      vgrid: c.xTicks.map((t) => X(t.v)),
      hgrid: p.yTicks.map((t) => ({ y: Y(t.v), label: t.label })),
      series: p.series
        .filter((s) => s.points.length)
        .map((s) => {
          const pts = [...s.points].sort((a, b) => a.x - b.x).map((q) => ({ x: X(q.x), y: Y(q.y) }));
          return {
            name: s.name,
            color: s.color,
            dashed: !!s.dashed,
            width: s.width ?? 1.6,
            line: s.line && pts.length > 1 ? pts.map((q) => `${r2(q.x)},${r2(q.y)}`).join(' ') : null,
            marks: pts.map((q) => ({ ...q, d: markerPath(s.marker, q.x, q.y), bar: s.marker === 'bar' ? Math.max(0, bottom - q.y) : null, marker: s.marker })),
          };
        }),
    };
  });
  const bottomY = y0 - GAP;
  return { w, h, panels, xTicks: c.xTicks.map((t) => ({ x: X(t.v), y: bottomY + 12, label: t.label })) };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function markerPath(m: ChartMarker, x: number, y: number): string | null {
  switch (m) {
    case 'cross':
      return `M${r2(x - 4)},${r2(y - 4)} L${r2(x + 4)},${r2(y + 4)} M${r2(x - 4)},${r2(y + 4)} L${r2(x + 4)},${r2(y - 4)}`;
    case 'less':
      return `M${r2(x + 3.5)},${r2(y - 4.5)} L${r2(x - 3.5)},${r2(y)} L${r2(x + 3.5)},${r2(y + 4.5)}`;
    case 'greater':
      return `M${r2(x - 3.5)},${r2(y - 4.5)} L${r2(x + 3.5)},${r2(y)} L${r2(x - 3.5)},${r2(y + 4.5)}`;
    default:
      return null;
  }
}
