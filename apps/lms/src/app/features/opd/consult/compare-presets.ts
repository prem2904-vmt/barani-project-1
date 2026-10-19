/**
 * Compare presets (the band's Compare ▾) — PURE. Built only on what the
 * consult already loads: today's draft + the past consults (history), the
 * patient journey's lab reports / documents, and the lab trends. No new
 * endpoints. A preset fills the compare picks in one tap; the counts show
 * what each would pick (0 = nothing to compare, shown disabled).
 */

export type ComparePresetId = 'last3' | 'allVisits' | 'reports' | 'images' | 'last6img' | 'trends' | 'rx' | `proc:${string}`;
/** Which consult sections the side-by-side table shows. */
export type CompareSection = 'findings' | 'dx' | 'rx' | 'tests';

export interface PresetConsult { visitId: string; date: string; hasRx: boolean; }
export interface PresetFile { fileId: string; date: string; title: string; }
export interface PresetTrend { key: string; title: string; unit?: string | null; points: { date: string; value: number; flag?: string | null }[]; }

export interface PresetInput {
  /** Today's consult + the past ones. */
  consults: readonly PresetConsult[];
  /** Lab reports and non-image documents ('rep:…' / 'doc:…'). */
  reports: readonly PresetFile[];
  images: readonly PresetFile[];
  /** Lab parameters with their dated values. */
  trends: readonly PresetTrend[];
  /** Procedures the patient has had (with how many sessions) — one "readings" preset each. */
  procedures?: readonly { serviceId: string; name: string; sessions: number }[];
}

export type PresetPick =
  | { kind: 'consult'; visitId: string }
  | { kind: 'file'; fileId: string; date: string; title: string; image: boolean }
  | { kind: 'trend'; trend: PresetTrend };

export interface ComparePreset {
  id: ComparePresetId;
  label: string;
  count: number;
  picks: PresetPick[];
  /** The consult table's sections (all when absent). */
  sections?: CompareSection[];
  /** A "procedure readings" preset: the host shows that procedure's sessions table. */
  procedureServiceId?: string;
}

const newestFirst = <T extends { date: string }>(xs: readonly T[]) => [...xs].sort((a, b) => b.date.localeCompare(a.date));

/** Every preset with its picks and count, in menu order. Pure. */
export function comparePresets(inp: PresetInput): ComparePreset[] {
  const consults = newestFirst(inp.consults);
  const consult = (c: PresetConsult): PresetPick => ({ kind: 'consult', visitId: c.visitId });
  const file = (f: PresetFile, image: boolean): PresetPick => ({ kind: 'file', fileId: f.fileId, date: f.date, title: f.title, image });
  const images = newestFirst(inp.images);
  const trends = inp.trends.filter(t => t.points.length >= 2);
  const rx = consults.filter(c => c.hasRx);
  const mk = (id: ComparePresetId, label: string, picks: PresetPick[], sections?: CompareSection[]): ComparePreset =>
    ({ id, label, count: picks.length, picks, ...(sections ? { sections } : {}) });
  return [
    mk('last3', 'Last 3 visits', consults.slice(0, 3).map(consult)),
    mk('allVisits', 'All visits', consults.map(consult)),
    mk('reports', 'All reports', newestFirst(inp.reports).map(f => file(f, false))),
    mk('images', 'All images', images.map(f => file(f, true))),
    mk('last6img', 'Last 6 images', images.slice(0, 6).map(f => file(f, true))),
    mk('trends', 'Lab trends', trends.map(t => ({ kind: 'trend', trend: t }))),
    mk('rx', 'Prescriptions', rx.map(consult), ['rx']),
    ...(inp.procedures ?? []).map(p => ({ id: `proc:${p.serviceId}` as const, label: `${p.name} readings`, count: p.sessions, picks: [], procedureServiceId: p.serviceId })),
  ];
}

/** The compare header: "Comparing: last 6 images". Pure. */
export function presetTitle(label: string): string {
  return 'Comparing: ' + label.charAt(0).toLowerCase() + label.slice(1);
}
