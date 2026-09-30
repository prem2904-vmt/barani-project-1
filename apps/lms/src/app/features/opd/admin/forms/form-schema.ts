/**
 * OPD consult-form schema v2 (Agent A) — the TS side of
 * prefrontal-mw Services/Opd/Admin/OpdFormSchemaRules.cs (validation lives on
 * the server; this file is types + pure helpers the builder and the renderer
 * share). One shared, versioned library: a published version is immutable and
 * a consult keeps the version it was filled with.
 *
 * Built-in consult sections (vitals, diagnosis, Rx, investigations, follow-up)
 * are NEVER questions here — the consult screen owns them.
 *
 * CONTRACT NOTE (integrator): this supersedes `OpdFormSchema` / `OpdFormField`
 * in features/opd/shared/opd.models.ts (foundation v1: text | textarea | number
 * | select | multiselect | boolean | date | scale). `normalizeSchema` reads v1
 * too, and the server normalises v1 → v2 on save.
 */

export type OpdQType = 'short' | 'long' | 'yn' | 'one' | 'many' | 'num' | 'scale' | 'date' | 'media' | 'diagram' | 'table';
export type DiagramShape = 'ear' | 'nose' | 'body';
export type Side = 'r' | 'l';

export interface OpdCondition { key: string; value: string; }

/** One question on a form (a "field" on the wire). */
export interface OpdQuestion {
  key: string;
  label: string;
  type: OpdQType;
  /** Ask right and left separately (not for media / table). */
  sides?: boolean;
  required?: boolean;
  /** Prints on the consult summary / prescription (default true). */
  print?: boolean;
  choices?: string[];
  unit?: string;
  min?: number;
  max?: number;
  shape?: DiagramShape;
  rows?: string[];
  cols?: string[];
  /** Show only when an EARLIER Yes/No or pick question has this answer. */
  when?: OpdCondition | null;
  hint?: string;
  /** Layout override: full row. */
  wide?: boolean;
  /** Sample answer for the builder's sample patient. */
  sample?: unknown;
}

export interface OpdFormDocSection { key: string; title: string; fields: OpdQuestion[]; }
export interface OpdFormDoc {
  schemaVersion: 2;
  /** Doctors may add their own questions on top (add-only). */
  allowAddons?: boolean;
  sections: OpdFormDocSection[];
}

// ── Answers ──────────────────────────────────────────────────────────────
/** A captured image / video / file (the consult owns the upload; the form
 *  only stores references). Any format. */
export interface OpdMediaRef { id?: string; name: string; url?: string; kind?: 'image' | 'video' | 'file'; }
/** A body-diagram mark (0–100 coordinates on the outline). */
export interface OpdMark { x: number; y: number; note: string; }
export type OpdScalar = string | number | string[] | OpdMediaRef[] | OpdMark[] | string[][] | null | undefined;
export interface OpdSided<T = OpdScalar> { r?: T; l?: T; }
/** Answers keyed by question key; a left & right question holds `{ r, l }`. */
export type OpdAnswers = Record<string, unknown>;

export const YES_NO = ['Yes', 'No', 'Not examined'] as const;

/** The answer types in the order the gallery shows them — [title, what it is, example]. */
export const Q_TYPES: Record<OpdQType | 'lr', [string, string, string]> = {
  short: ['Short note', 'A line of text', 'Chief complaint'],
  long: ['Longer notes', 'A paragraph or two', 'History of present illness'],
  yn: ['Yes / No / Not examined', 'Three quick taps', 'Ear discharge?'],
  one: ['Pick one', 'One answer from a short list', 'Nasal septum'],
  many: ['Pick several', 'Tick all that apply', 'Associated symptoms'],
  num: ['Number with unit', 'A measurement — kg, mm, days', 'Weight in kg'],
  lr: ['Left & right', 'Ears, eyes, nostrils, limbs — R | L side by side', 'Hearing, both ears'],
  scale: ['Scale 0–10 / grade', 'Pain score, polyp grade', 'Polyp grade 0–4'],
  date: ['Date', 'A day on the calendar', 'Last menstrual period'],
  media: ['Images & video', 'Endoscope, camera or upload — any format', 'Nasal endoscopy'],
  diagram: ['Body diagram marker', 'Tap an outline to mark a spot', 'Ear drum'],
  table: ['Table', 'Rows × columns of values', 'Audiometry by frequency'],
};
export const Q_TYPE_ORDER: (OpdQType | 'lr')[] = ['short', 'long', 'yn', 'one', 'many', 'num', 'lr', 'scale', 'date', 'media', 'diagram', 'table'];

/** The consult's built-in sections, shown LOCKED in the builder. */
export const BUILT_INS: { key: string; title: string; hint: string; icon: string }[] = [
  { key: 'vitals', title: 'Vitals', hint: 'Filled at the vitals station — set in Workflow', icon: 'M3 12h4l3-7 4 14 3-7h4' },
  { key: 'diagnosis', title: 'Diagnosis', hint: "With the doctor's usual prescription sets", icon: 'M11 2v2M5 2v2M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1M8 15a6 6 0 0 0 12 0v-3' },
  { key: 'rx', title: 'Prescription', hint: 'One line per medicine', icon: 'M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7ZM7 7l7 7' },
  { key: 'investigations', title: 'Investigations', hint: 'Lab tests, billed at the desk', icon: 'M9 3h6M10 3v6L4 19a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-6-10V3' },
  { key: 'follow_up', title: 'Follow-up', hint: 'Review date and reminder', icon: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z' },
];
export const BUILT_IN_KEYS = ['vitals', 'diagnosis', 'diagnoses', 'rx', 'prescription', 'investigations', 'follow_up', 'followup'];

// ── Schema reading ───────────────────────────────────────────────────────
const LEGACY: Record<string, OpdQType> = { text: 'short', textarea: 'long', number: 'num', select: 'one', multiselect: 'many', boolean: 'yn' };
const TYPES = new Set<string>(['short', 'long', 'yn', 'one', 'many', 'num', 'scale', 'date', 'media', 'diagram', 'table']);

export function emptyDoc(): OpdFormDoc {
  return { schemaVersion: 2, allowAddons: true, sections: [{ key: 'findings', title: 'Findings', fields: [] }] };
}

/** Read any stored schema (v2, or the foundation's v1) into a v2 doc. Never throws. */
export function normalizeSchema(raw: unknown): OpdFormDoc {
  const src = (raw && typeof raw === 'object' ? raw : {}) as { sections?: unknown; allowAddons?: unknown };
  const secs = Array.isArray(src.sections) ? src.sections : [];
  const sections: OpdFormDocSection[] = secs.map((s, i) => {
    const so = (s ?? {}) as { key?: string; title?: string; fields?: unknown };
    return {
      key: so.key || (i === 0 ? 'findings' : `section_${i + 1}`),
      title: so.title || (i === 0 ? 'Findings' : `Section ${i + 1}`),
      fields: (Array.isArray(so.fields) ? so.fields : []).map(normalizeQuestion).filter((q): q is OpdQuestion => !!q),
    };
  });
  return { schemaVersion: 2, allowAddons: src.allowAddons !== false, sections: sections.length ? sections : emptyDoc().sections };
}

export function normalizeQuestion(raw: unknown): OpdQuestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Record<string, unknown>;
  const label = String(f['label'] ?? f['q'] ?? '').trim();
  if (!label) return null;
  let type = String(f['type'] ?? f['t'] ?? 'short');
  type = LEGACY[type] ?? type;
  if (!TYPES.has(type)) type = 'short';
  const q: OpdQuestion = {
    key: String(f['key'] || slugKey(label)),
    label, type: type as OpdQType,
    sides: !!f['sides'], required: !!(f['required'] ?? f['req']), print: f['print'] !== false,
  };
  const choices = (f['choices'] ?? f['options'] ?? f['ch']) as unknown;
  if (q.type === 'one' || q.type === 'many') q.choices = Array.isArray(choices) ? choices.map(String) : [];
  if (typeof f['unit'] === 'string') q.unit = f['unit'] as string;
  if (q.type === 'scale') { q.min = num(f['min'], 0); q.max = num(f['max'], 10); }
  if (q.type === 'diagram') q.shape = (['ear', 'nose', 'body'].includes(String(f['shape'])) ? f['shape'] : 'body') as DiagramShape;
  if (q.type === 'table') { q.rows = strs(f['rows']); q.cols = strs(f['cols']); }
  const w = f['when'] as { key?: string; value?: string; id?: string; v?: string } | null | undefined;
  if (w && (w.key || w.id)) q.when = { key: String(w.key ?? w.id), value: String(w.value ?? w.v ?? '') };
  if (typeof f['hint'] === 'string') q.hint = f['hint'] as string;
  if (typeof f['wide'] === 'boolean') q.wide = f['wide'] as boolean;
  if ('sample' in f) q.sample = f['sample'];
  if (q.type === 'media' || q.type === 'table') q.sides = false;
  return q;
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : d);
const strs = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

/** Every question in form order. */
export function allQuestions(doc: OpdFormDoc): OpdQuestion[] {
  return doc.sections.flatMap((s) => s.fields);
}

/** A stable key from the wording, unique among `taken` ("Ear discharge?" → "ear_discharge"). */
export function slugKey(label: string, taken: Iterable<string> = []): string {
  let s = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!s || !/^[a-z]/.test(s)) s = 'q_' + s;
  s = s.slice(0, 44).replace(/_+$/, '');
  if (BUILT_IN_KEYS.includes(s)) s = s + '_notes';
  const set = new Set(taken);
  let k = s, n = 2;
  while (set.has(k)) k = `${s}_${n++}`;
  return k;
}

// ── Display ──────────────────────────────────────────────────────────────
export function typeName(q: Pick<OpdQuestion, 'type' | 'sides' | 'choices' | 'unit' | 'min' | 'max'>): string {
  let b = q.type === 'scale' ? `Scale ${q.min ?? 0}–${q.max ?? 10}` : Q_TYPES[q.type][0];
  if (q.type === 'one' || q.type === 'many') { const n = q.choices?.length ?? 0; b += ` · ${n} ${n === 1 ? 'choice' : 'choices'}`; }
  if (q.type === 'num' && q.unit) b += ` · ${q.unit}`;
  return q.sides ? `Left & right · ${b}` : b;
}

/** Full-row question (else it sits in the 2-column grid). */
export function isWide(q: OpdQuestion): boolean {
  if (q.wide != null) return q.wide;
  if (q.sides) return true;
  if (['short', 'long', 'many', 'media', 'diagram', 'table'].includes(q.type)) return true;
  if (q.type === 'one' && (q.choices?.length ?? 0) > 4) return true;
  if (q.type === 'scale' && (q.max ?? 10) - (q.min ?? 0) > 5) return true;
  return false;
}

// ── Conditions ───────────────────────────────────────────────────────────
/** Questions ABOVE `index` a condition may depend on (Yes/No or pick, not left & right). */
export function conditionSources(list: OpdQuestion[], index: number): OpdQuestion[] {
  return list.slice(0, Math.max(0, index)).filter((x) => !x.sides && (x.type === 'yn' || x.type === 'one' || x.type === 'many'));
}

export function answersOf(q: OpdQuestion): string[] {
  return q.type === 'yn' ? [...YES_NO] : q.choices ?? [];
}

/** Is `q` shown for these answers? (A missing source never hides a question.) */
export function conditionMet(q: OpdQuestion, byKey: Map<string, OpdQuestion>, answers: OpdAnswers): boolean {
  if (!q.when) return true;
  const src = byKey.get(q.when.key);
  if (!src) return true;
  const v = answers[src.key];
  return Array.isArray(v) ? v.includes(q.when.value) : v === q.when.value;
}

/** The questions a doctor sees now (hidden conditional ones dropped). */
export function visibleQuestions(list: OpdQuestion[], answers: OpdAnswers): OpdQuestion[] {
  const byKey = new Map(list.map((q) => [q.key, q] as const));
  return list.filter((q) => conditionMet(q, byKey, answers));
}

// ── Values ───────────────────────────────────────────────────────────────
export function hasValue(v: unknown): boolean {
  if (v == null || v === '') return false;
  if (Array.isArray(v)) return v.length > 0 && !(v.every((r) => Array.isArray(r) && r.every((c) => c == null || c === '')));
  return true;
}
export function isAnswered(q: OpdQuestion, v: unknown): boolean {
  if (q.sides) { const s = (v ?? {}) as OpdSided; return hasValue(s.r) || hasValue(s.l); }
  return hasValue(v);
}

/** Required questions still unanswered (visible ones only) — labels. */
export function missingRequired(list: OpdQuestion[], answers: OpdAnswers): string[] {
  return visibleQuestions(list, answers).filter((q) => q.required && !isAnswered(q, answers[q.key])).map((q) => q.label);
}

/** One answer in plain words (a side of a left & right question is passed in on its own). */
export function answerText(q: OpdQuestion, v: unknown): string {
  if (!hasValue(v)) return '';
  switch (q.type) {
    case 'many': return (v as string[]).join(', ');
    case 'num': return `${v}${q.unit ? ' ' + q.unit : ''}`;
    case 'scale': return `${v} / ${q.max ?? 10}`;
    case 'date': return formatDate(String(v));
    case 'media': { const n = (v as unknown[]).length; return `${n} ${n === 1 ? 'file' : 'files'} · in the visit files`; }
    case 'diagram': return (v as OpdMark[]).map((m, i) => `${i + 1}. ${m.note || 'marked'}`).join('; ');
    case 'table': return '';
    default: return String(v);
  }
}

export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${+m[3]} ${months[+m[2] - 1] ?? m[2]} ${m[1]}`;
}

/** A printed row of the consult summary. */
export interface PrintRow { key: string; label: string; text?: string; sides?: { r: string; l: string }; table?: { rows: string[]; cols: string[]; cells: string[][]; unit?: string }; files?: number; }

/** What prints: visible, print-on questions — answered ones only unless `blanks`. */
export function printRows(list: OpdQuestion[], answers: OpdAnswers, blanks = false): PrintRow[] {
  const out: PrintRow[] = [];
  for (const q of visibleQuestions(list, answers)) {
    if (q.print === false) continue;
    const v = answers[q.key];
    if (!blanks && !isAnswered(q, v)) continue;
    const label = q.label.replace(/\?$/, '');
    if (q.type === 'table') {
      const cells = (Array.isArray(v) ? v : []) as string[][];
      out.push({ key: q.key, label, table: { rows: q.rows ?? [], cols: q.cols ?? [], unit: q.unit,
        cells: (q.rows ?? []).map((_, r) => (q.cols ?? []).map((_, c) => String(cells[r]?.[c] ?? ''))) } });
    } else if (q.sides) {
      const s = (v ?? {}) as OpdSided;
      out.push({ key: q.key, label, sides: { r: answerText(q, s.r), l: answerText(q, s.l) } });
    } else out.push({ key: q.key, label, text: answerText(q, v), files: q.type === 'media' && Array.isArray(v) ? v.length : undefined });
  }
  return out;
}

// ── Samples (the builder's sample patient) ───────────────────────────────
export function defaultSample(q: OpdQuestion): unknown {
  const one = (): unknown => {
    switch (q.type) {
      case 'yn': return 'No';
      case 'one': return q.choices?.[0] ?? null;
      case 'many': return (q.choices ?? []).slice(0, 1);
      case 'scale': return (q.min ?? 0) + 1;
      case 'media': return [{ name: 'Image 1', kind: 'image' }];
      case 'diagram': return [];
      case 'table': return (q.rows ?? []).map(() => (q.cols ?? []).map(() => ''));
      case 'num': return '';
      default: return '';
    }
  };
  return q.sides ? { r: one(), l: one() } : one();
}

/** Stored samples read into renderer answers (media counts become file refs). */
export function sampleAnswers(list: OpdQuestion[]): OpdAnswers {
  const out: OpdAnswers = {};
  for (const q of list) {
    let s = q.sample !== undefined ? q.sample : defaultSample(q);
    if (q.type === 'media' && !Array.isArray(s)) s = mediaSample(typeof s === 'number' ? s : 1);
    out[q.key] = s;
  }
  return out;
}
function mediaSample(n: number): OpdMediaRef[] {
  return Array.from({ length: Math.max(0, Math.min(n, 6)) }, (_, i) => ({ name: `Image ${i + 1}`, kind: 'image' as const }));
}

/** A deep copy (answers / schema are plain JSON). */
export function clone<T>(x: T): T { return x == null ? x : JSON.parse(JSON.stringify(x)); }
