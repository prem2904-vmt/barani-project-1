import {
  OpdCondition, OpdFormDoc, OpdQType, OpdQuestion, answersOf, clone, conditionSources, defaultSample, slugKey,
} from './form-schema';
import { AUDIOMETRY, ParsedQuestion } from './sentence-parser';

/**
 * Form builder operations — PURE and immutable (every op returns a new list),
 * so the page keeps one signal and undo is a value. The builder edits the
 * first section's questions (the mockup's single "Findings" list); other
 * sections, when a stored form has them, are kept as they are.
 */

export type BuilderAction = 'up' | 'down' | 'dup' | 'req' | 'del';

/** Defaults per gallery type (what "Browse answer types" adds). */
const TYPE_DEFAULTS: Record<OpdQType | 'lr', Partial<OpdQuestion> & { label: string }> = {
  short: { label: 'Chief complaint' },
  long: { label: 'History of present illness' },
  yn: { label: 'Ear discharge?' },
  one: { label: 'Nasal septum', choices: ['Central', 'Deviated left', 'Deviated right'] },
  many: { label: 'Associated symptoms', choices: ['Sneezing', 'Headache', 'Loss of smell'] },
  num: { label: 'Weight', unit: 'kg' },
  lr: { label: 'Hearing', type: 'one', sides: true, choices: ['Normal', 'Reduced', 'Absent'] },
  scale: { label: 'Polyp grade', min: 0, max: 4 },
  date: { label: 'Last menstrual period' },
  media: { label: 'Nasal endoscopy' },
  diagram: { label: 'Ear drum', shape: 'ear' },
  table: { label: 'Audiometry by frequency', unit: 'dB', cols: AUDIOMETRY.cols, rows: AUDIOMETRY.rows },
  // critic §1 #6 — read-only, computed from another question (edd/pog/pta); the
  // admin picks the source question in the inspector after adding it.
  calc: { label: 'Estimated date of delivery (EDD)', formula: 'edd' },
};

/** A new question from a gallery type (keyed uniquely against `taken`). */
export function fromType(t: OpdQType | 'lr', taken: string[]): OpdQuestion {
  const d = clone(TYPE_DEFAULTS[t]);
  const type = (d.type ?? t) as OpdQType;
  const q: OpdQuestion = { ...d, type, key: slugKey(d.label, taken), sides: !!d.sides, print: true, required: false };
  if (type === 'scale') { q.min = q.min ?? 0; q.max = q.max ?? 10; }
  q.sample = defaultSample(q);
  return q;
}

/** A new question from a parsed sentence. */
export function fromParsed(p: ParsedQuestion, taken: string[]): OpdQuestion {
  const q: OpdQuestion = { key: slugKey(p.label, taken), label: p.label, type: p.type, sides: p.sides, print: true, required: false };
  if (p.type === 'one' || p.type === 'many') q.choices = p.choices.length ? p.choices : ['Normal', 'Abnormal'];
  if (p.type === 'num' || p.type === 'table') q.unit = p.unit || undefined;
  if (p.type === 'scale') { q.min = p.min; q.max = p.max; }
  if (p.type === 'diagram') q.shape = p.shape ?? 'body';
  if (p.type === 'table') { q.rows = p.rows ?? AUDIOMETRY.rows.slice(); q.cols = p.cols ?? AUDIOMETRY.cols.slice(); }
  q.sample = defaultSample(q);
  return q;
}

export function keysOf(list: OpdQuestion[]): string[] { return list.map((q) => q.key); }

export function insertAt(list: OpdQuestion[], q: OpdQuestion, at?: number | null): OpdQuestion[] {
  const i = at == null || at < 0 || at > list.length ? list.length : at;
  return [...list.slice(0, i), q, ...list.slice(i)];
}

/** Undo record for a delete: the question, where it was, and the conditions it broke. */
export interface DeleteUndo { q: OpdQuestion; index: number; deps: [string, OpdCondition][]; }

export function applyAction(list: OpdQuestion[], key: string, a: BuilderAction): { list: OpdQuestion[]; selected: string | null; undo?: DeleteUndo } {
  const i = list.findIndex((q) => q.key === key);
  if (i < 0) return { list, selected: null };
  const L = list.slice();
  switch (a) {
    case 'up':
      if (i > 0) { [L[i - 1], L[i]] = [L[i], L[i - 1]]; return { list: fixConditions(L), selected: key }; }
      return { list, selected: key };
    case 'down':
      if (i < L.length - 1) { [L[i + 1], L[i]] = [L[i], L[i + 1]]; return { list: fixConditions(L), selected: key }; }
      return { list, selected: key };
    case 'dup': {
      const f = L[i];
      const c = clone(f);
      c.label = f.label.replace(/\?$/, '') + ' (copy)' + (/\?$/.test(f.label) ? '?' : '');
      c.key = slugKey(c.label, keysOf(L));
      L.splice(i + 1, 0, c);
      return { list: L, selected: c.key };
    }
    case 'req':
      L[i] = { ...L[i], required: !L[i].required };
      return { list: L, selected: key };
    case 'del': {
      const f = L[i];
      const deps: [string, OpdCondition][] = [];
      const out = L.filter((_, k) => k !== i).map((x) => {
        if (x.when?.key === f.key) { deps.push([x.key, x.when]); return { ...x, when: null }; }
        return x;
      });
      return { list: out, selected: null, undo: { q: f, index: i, deps } };
    }
  }
}

export function undoDelete(list: OpdQuestion[], u: DeleteUndo): OpdQuestion[] {
  const restored = insertAt(list, u.q, u.index);
  const deps = new Map(u.deps);
  return restored.map((x) => (deps.has(x.key) ? { ...x, when: deps.get(x.key)! } : x));
}

/** Drop conditions that no longer point at an EARLIER valid source (after a move / type change). */
export function fixConditions(list: OpdQuestion[]): OpdQuestion[] {
  return list.map((q, i) => {
    if (!q.when) return q;
    const src = conditionSources(list, i).find((s) => s.key === q.when!.key);
    if (!src || !answersOf(src).includes(q.when.value)) return { ...q, when: null };
    return q;
  });
}

/** Change how a question is answered (keeps the wording; fills sensible defaults). */
export function changeType(q: OpdQuestion, t: OpdQType | 'lr'): OpdQuestion {
  const d = TYPE_DEFAULTS[t];
  const f: OpdQuestion = { ...clone(q) };
  f.sides = t === 'lr' ? true : t === 'media' || t === 'table' ? false : !!f.sides;
  f.type = t === 'lr' ? (['one', 'yn', 'num', 'short', 'scale', 'diagram'].includes(f.type) ? f.type : 'one') : t;
  if ((f.type === 'one' || f.type === 'many') && !f.choices?.length) f.choices = d.choices?.length ? [...d.choices] : ['Normal', 'Abnormal'];
  if (f.type === 'num' && !f.unit) f.unit = d.unit ?? '';
  if (f.type === 'scale' && f.max == null) { f.min = 0; f.max = 10; }
  if (f.type === 'table' && !f.cols?.length) { f.cols = AUDIOMETRY.cols.slice(); f.rows = AUDIOMETRY.rows.slice(); f.unit = f.unit || 'dB'; }
  if (f.type === 'diagram' && !f.shape) f.shape = 'ear';
  if (f.type !== 'one' && f.type !== 'many') delete f.choices;
  f.sample = defaultSample(f);
  return f;
}

/** Turn left & right on / off; a question that becomes sided can't drive conditions. */
export function setSides(list: OpdQuestion[], key: string, on: boolean): OpdQuestion[] {
  return list.map((x) => {
    if (x.key === key) {
      const s = x.sample as { r?: unknown } | undefined;
      return { ...x, sides: on, sample: on ? { r: clone(x.sample), l: clone(x.sample) } : clone(s?.r) };
    }
    if (on && x.when?.key === key) return { ...x, when: null };
    return x;
  });
}

export function patchQuestion(list: OpdQuestion[], key: string, patch: Partial<OpdQuestion>): OpdQuestion[] {
  const out = list.map((x) => (x.key === key ? { ...x, ...patch } : x));
  return 'choices' in patch || 'type' in patch ? fixConditions(out) : out;
}

/** The builder edits the first section; the doc is rebuilt around it. */
export function withQuestions(doc: OpdFormDoc, list: OpdQuestion[]): OpdFormDoc {
  const [first, ...rest] = doc.sections.length ? doc.sections : [{ key: 'findings', title: 'Findings', fields: [] }];
  return { ...doc, schemaVersion: 2, sections: [{ ...first, fields: list }, ...rest] };
}

// ── Versioning (the band's chip + Publish label) ─────────────────────────
export interface VersionInfo { published?: number | null; draft?: number | null; }
export interface VersionState { chip: string; draft: boolean; publishLabel: string; canPublish: boolean; }

/** "v3 · draft changes" / "v3 · published" / "New · draft"; Publish makes v(n+1). */
export function versionState(v: VersionInfo): VersionState {
  const pub = v.published ?? null;
  const draft = v.draft != null;
  if (pub == null) return { chip: 'New · draft', draft: true, publishLabel: 'Publish v1', canPublish: draft };
  if (draft) return { chip: `v${pub} · draft changes`, draft: true, publishLabel: `Publish v${v.draft}`, canPublish: true };
  return { chip: `v${pub} · published`, draft: false, publishLabel: 'Published', canPublish: false };
}
