import { Lookup, isShown, lookupIn } from './rules';
import { Answers, FieldDef, FormDefinition, KNOWN_KINDS, OptionDef, PageDef, RepeatPagesValue, allFields, cfg } from './types';

/**
 * The page wizard's model: which pages the doctor walks through, in order.
 * Pages owned by a "repeating pages" field leave the normal flow and come
 * back once per repetition ("Pregnancy 1", "Pregnancy 2"), right after the
 * page holding that field.
 */
export interface WizardPage {
  /** Stable id: the page key, or `field#page#index` for a repetition. */
  id: string;
  page: PageDef;
  title: string;
  /** Set on a repetition: whose instance it is. Values live in answers[fieldKey].instances[i].values. */
  instance?: { fieldKey: string; page: string; index: number };
}

/** Is a value an answer? Empty strings, empty lists and objects with nothing filled are not. */
export function isAnswered(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'boolean') return true;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o['instances'])) return (o['instances'] as unknown[]).length > 0;
    if (Array.isArray(o['dimensions'])) return (o['dimensions'] as unknown[]).some((d) => typeof d === 'number');
    if ('height' in o || 'weight' in o) return typeof o['height'] === 'number' || typeof o['weight'] === 'number';
    if ('amount' in o || 'value' in o) return typeof (o['amount'] ?? o['value']) === 'number';
    // a picture (API canvas value): a description, a photo, or something drawn, pinned, written or marked
    const canvasKeys = ['strokes', 'pins', 'labels', 'regions', 'markers', 'photos'];
    if (canvasKeys.some((k) => k in o) || 'description' in o || 'photo' in o)
      return (
        (typeof o['description'] === 'string' && o['description'].trim() !== '') ||
        (typeof o['photo'] === 'string' && o['photo'] !== '') ||
        canvasKeys.some((k) => Array.isArray(o[k]) && (o[k] as unknown[]).length > 0)
      );
    return Object.keys(o).length > 0;
  }
  return true;
}

/** Page keys owned by repeatPages fields (they appear only as repetitions). */
export function ownedPages(def: FormDefinition): Set<string> {
  const out = new Set<string>();
  for (const f of allFields(def))
    if (f.kind === 'repeatPages') for (const p of cfg<string[]>(f, 'pages', [])) out.add(p);
  return out;
}

export function instancesOf(v: unknown): RepeatPagesValue['instances'] {
  return ((v as RepeatPagesValue | null)?.instances ?? []).filter((i) => i && typeof i.page === 'string');
}

function instanceTitle(f: FieldDef, page: PageDef, index: number, pageCount: number): string {
  const prefix = cfg<string>(f, 'labelPrefix', '').trim();
  const suffix = (cfg<string | null>(f, 'labelSuffix', null) ?? '').trim();
  const showIndex = cfg<boolean>(f, 'showIndex', true);
  const prefixInUi = cfg<string>(f, 'prefixVisibility', 'all') !== 'narrativeOnly';
  const parts = [prefixInUi ? prefix : '', page.title, showIndex || pageCount === 1 ? String(index + 1) : '', suffix];
  return parts.filter(Boolean).join(' ');
}

/** The pages the doctor walks through for these answers. */
export function wizardPages(def: FormDefinition, answers: Answers): WizardPage[] {
  const owned = ownedPages(def);
  const byKey = new Map(def.pages.map((p) => [p.key, p]));
  const get = lookupIn(answers);
  const out: WizardPage[] = [];
  for (const page of def.pages) {
    if (owned.has(page.key)) continue;
    if (!isShown(page.showWhen, get)) continue;
    out.push({ id: page.key, page, title: page.title });
    for (const f of page.fields) {
      if (f.kind !== 'repeatPages' || !isShown(f.showWhen, get)) continue;
      const insts = instancesOf(answers[f.key]);
      const counts = new Map<string, number>();
      for (const i of insts) counts.set(i.page, (counts.get(i.page) ?? 0) + 1);
      // custom / instance order: the doctor arranged the repetitions (Move earlier / later); the list order is the order
      const arranged = cfg<string>(f, 'orderMode', 'static') !== 'static';
      const ordered = arranged ? insts : [...insts].sort((a, b) =>
        cfg<string>(f, 'mode', 'uniform') === 'individual'
          ? pageOrder(f, a.page) - pageOrder(f, b.page) || a.index - b.index
          : a.index - b.index || pageOrder(f, a.page) - pageOrder(f, b.page),
      );
      for (const inst of ordered) {
        const p = byKey.get(inst.page);
        if (!p) continue;
        const scoped = lookupIn(inst.values ?? {}, answers);
        if (!isShown(p.showWhen, scoped)) continue;
        out.push({
          id: `${f.key}#${inst.page}#${inst.index}`,
          page: p,
          title: instanceTitle(f, p, inst.index, counts.get(inst.page) ?? 1),
          instance: { fieldKey: f.key, page: inst.page, index: inst.index },
        });
      }
    }
  }
  return chronological(def, answers, out);
}

const SECONDS: Record<string, number> = {
  second: 1,
  minute: 60,
  hour: 3600,
  day: 86400,
  week: 7 * 86400,
  month: 30 * 86400,
  year: 365 * 86400,
};
const PERIOD: Record<string, number> = { morning: 1, afternoon: 2, evening: 3, night: 4 };

/**
 * How long ago / how long, as one comparable number (legacy NarrativeHelpers: month = 30 days, year = 365;
 * periods of the day morning 1 … night 4). null = no duration in this value.
 */
export function durationWeight(v: unknown): number | null {
  if (typeof v === 'string') return PERIOD[v.toLowerCase()] ?? null;
  if (!v || typeof v !== 'object') return null;
  const o = v as { amount?: unknown; value?: unknown; unit?: unknown };
  const n = typeof o.amount === 'number' ? o.amount : typeof o.value === 'number' ? o.value : null;
  if (n === null) return null;
  const unit = String(o.unit ?? 'days')
    .toLowerCase()
    .replace(/s$/, '');
  return n * (SECONDS[unit] ?? SECONDS['day']);
}

/**
 * Chronological page order (legacy `chronological`, resident-fe dynamic-form.ts:1801-2198): when a
 * choice's options link to pages ("Nasal block" → the Nasal block page) and each chosen option has a
 * duration follow-up, those pages are walked in the order of the durations — longest first (desc,
 * the default) or shortest first (asc). On when the field says so, or by itself when its options have
 * duration follow-ups and linked pages (legacy auto-detect). Pages without a duration keep their
 * place after the timed ones; everything else stays where it is. A nested rule (C13, `chronological.nested`
 * = {sortBy: severity | order}) on the field's own list orders the pages by severity (least → most in
 * `severityOrder`, most severe first unless asc) or by the options' own order instead.
 */
interface ChronoRule {
  enabled?: boolean;
  sortOrder?: string;
  nested?: boolean | { enabled?: boolean; trigger?: string; sortBy?: 'duration' | 'severity' | 'order'; sortOrder?: string; severityOrder?: string[] };
}

/** The API's default severity words, least to most severe. */
const SEVERITY = ['mild', 'moderate', 'severe'];

/** An option's severity: the first of its follow-up answers (key or label), else its own key / label, found in the list. */
function severityWeight(o: OptionDef, answers: Answers, order: string[]): number | null {
  const words: string[] = [];
  for (const sf of o.subFields ?? []) {
    const v = answers[sf.key];
    for (const x of Array.isArray(v) ? v : [v]) {
      if (typeof x !== 'string') continue;
      words.push(x);
      const opt = (sf.options ?? []).find((so) => so.key.toLowerCase() === x.toLowerCase());
      if (opt) words.push(opt.label);
    }
  }
  words.push(o.key, o.label);
  for (const w of words) {
    const i = order.indexOf(String(w).trim().toLowerCase());
    if (i >= 0) return i;
  }
  return null;
}

export function chronological(def: FormDefinition, answers: Answers, pages: WizardPage[]): WizardPage[] {
  let out = pages;
  for (const f of allFields(def)) {
    const opts = (f.options ?? []).filter((o) => o.linkedPage);
    if (opts.length < 2) continue;
    const chrono = cfg<ChronoRule | null>(f, 'chronological', null);
    const timed = (o: (typeof opts)[number]) => (o.subFields ?? []).find((sf) => sf.kind === 'duration');
    const auto = opts.some((o) => timed(o));
    if (!(chrono?.enabled || (auto && chrono?.enabled !== false))) continue;
    const chosen = opts.filter((o) => optionChosen(answers[f.key], o.key));
    if (chosen.length < 2) continue;
    // C13: a nested rule on this field's own list may order its pages by severity or by the options' own order
    const nested = typeof chrono?.nested === 'object' && chrono.nested && chrono.nested.enabled !== false ? chrono.nested : null;
    const by = nested && (!nested.trigger || nested.trigger === f.key) ? (nested.sortBy ?? 'duration') : 'duration';
    // durations: longest first unless asc (legacy); the options' order: as defined unless desc; severity: most severe first unless asc
    const asc = by === 'duration' ? chrono?.sortOrder === 'asc' : by === 'order' ? nested?.sortOrder !== 'desc' : nested?.sortOrder === 'asc';
    const severity = (nested?.severityOrder?.length ? nested.severityOrder : SEVERITY).map((w) => w.toLowerCase());
    const weightOf = (o: (typeof opts)[number]): number | null => {
      if (by === 'order') return opts.indexOf(o);
      if (by === 'severity') return severityWeight(o, answers, severity);
      const d = timed(o);
      return d ? durationWeight(answers[d.key]) : null;
    };
    const ranked = chosen
      .map((o, i) => ({ page: o.linkedPage as string, w: weightOf(o), i }))
      .sort((a, b) => {
        if (a.w === null || b.w === null) return a.w === null && b.w === null ? a.i - b.i : a.w === null ? 1 : -1;
        return (asc ? a.w - b.w : b.w - a.w) || a.i - b.i;
      })
      .map((r) => r.page);
    const keys = new Set(ranked);
    const slots = out.map((p, i) => (!p.instance && keys.has(p.page.key) ? i : -1)).filter((i) => i >= 0);
    if (slots.length < 2) continue;
    const byKey = new Map(slots.map((i) => [out[i].page.key, out[i]]));
    const inOrder = ranked.filter((k) => byKey.has(k)).map((k) => byKey.get(k)!);
    out = [...out];
    slots.forEach((slot, n) => (out[slot] = inOrder[n]));
  }
  return out;
}

function pageOrder(f: FieldDef, page: string): number {
  return cfg<string[]>(f, 'pages', []).indexOf(page);
}

/** The answers a page reads and writes: an instance's own values, or the top-level answers. */
export function pageScope(wp: WizardPage, answers: Answers): Answers {
  if (!wp.instance) return answers;
  const inst = instancesOf(answers[wp.instance.fieldKey]).find(
    (i) => i.page === wp.instance!.page && i.index === wp.instance!.index,
  );
  return inst?.values ?? {};
}

/** Lookup for conditions on a page: its own scope first, then the whole sheet. */
export function pageLookup(wp: WizardPage, answers: Answers): Lookup {
  return wp.instance ? lookupIn(pageScope(wp, answers), answers) : lookupIn(answers);
}

/** Write `key = value` in a page's scope; returns new top-level answers (immutable). */
export function setInScope(wp: WizardPage, answers: Answers, key: string, value: unknown): Answers {
  if (!wp.instance) return withValue(answers, key, value);
  const { fieldKey, page, index } = wp.instance;
  const insts = instancesOf(answers[fieldKey]).map((i) =>
    i.page === page && i.index === index ? { ...i, values: withValue(i.values ?? {}, key, value) } : i,
  );
  return { ...answers, [fieldKey]: { instances: insts } };
}

export function withValue(a: Answers, key: string, value: unknown): Answers {
  const out = { ...a };
  if (value === undefined) delete out[key];
  else out[key] = value;
  return out;
}

/**
 * Visible fields of a page, in order: top-level fields and the sub-fields of chosen options (repeat children are the repeat's own business).
 * A kind Prepare does not fill yet (kept from a legacy form, Phases 4–5) is not a question here: it never blocks Finish,
 * progress or auto-advance.
 */
export function visibleFields(page: PageDef, get: Lookup): FieldDef[] {
  const out: FieldDef[] = [];
  const walk = (f: FieldDef) => {
    if (!isShown(f.showWhen, get)) return;
    if (!(KNOWN_KINDS as readonly string[]).includes(f.kind)) return;
    out.push(f);
    const v = get(f.key);
    for (const o of f.options ?? []) {
      if (!o.subFields?.length || !optionChosen(v, o.key)) continue;
      for (const s of o.subFields) walk(s);
    }
  };
  for (const f of page.fields) walk(f);
  return out;
}

/** Is option `key` picked in this value (choice / yesno string, multi list, tick-box boolean)? */
export function optionChosen(v: unknown, key: string): boolean {
  // a body map's tapped markers are its chosen options ({ markers: [...] }, API "Image kinds")
  if (v && typeof v === 'object' && !Array.isArray(v) && Array.isArray((v as { markers?: unknown }).markers))
    return optionChosen((v as { markers: unknown[] }).markers, key);
  if (Array.isArray(v)) return v.some((x) => String(x).toLowerCase() === key.toLowerCase());
  if (v === true) return key.toLowerCase() === 'yes';
  if (v === false) return key.toLowerCase() === 'no';
  return typeof v === 'string' && v.toLowerCase() === key.toLowerCase();
}

export interface MissingItem {
  pageId: string;
  pageTitle: string;
  fieldKey: string;
  label: string;
}

/** What Finish refuses on: required fields the doctor can see and has not answered, page by page. */
export function missingRequired(def: FormDefinition, answers: Answers): MissingItem[] {
  const out: MissingItem[] = [];
  for (const wp of wizardPages(def, answers)) {
    const get = pageLookup(wp, answers);
    for (const f of visibleFields(wp.page, get)) {
      if (f.required && !isAnswered(get(f.key)))
        out.push({ pageId: wp.id, pageTitle: wp.title, fieldKey: f.key, label: f.label });
      if (f.kind === 'repeat') {
        const rows = Array.isArray(get(f.key)) ? (get(f.key) as Answers[]) : [];
        rows.forEach((row, i) => {
          for (const c of f.children ?? [])
            if (c.required && isShown(c.showWhen, lookupIn(row, answers)) && !isAnswered(row?.[c.key]))
              out.push({
                pageId: wp.id,
                pageTitle: wp.title,
                fieldKey: f.key,
                label: `${f.label} ${i + 1}: ${c.label}`,
              });
        });
      }
    }
  }
  return out;
}

/** How far along a page is: answered visible fields / visible fields. */
export function pageProgress(wp: WizardPage, answers: Answers): { answered: number; total: number } {
  const get = pageLookup(wp, answers);
  const fs = visibleFields(wp.page, get);
  return { answered: fs.filter((f) => isAnswered(get(f.key))).length, total: fs.length };
}

/** The patient's name as typed, for the case list: a field called "patient name" / "name" on the sheet. */
export function patientLabelOf(def: FormDefinition, answers: Answers): string | null {
  const fs = allFields(def).filter((f) => f.kind === 'text');
  const hit =
    fs.find((f) => /^patient[\s_-]?name$/i.test(f.key) || /^patient('?s)? name$/i.test(f.label.trim())) ??
    fs.find((f) => /^(full[\s_-]?)?name$/i.test(f.key) || /^name$/i.test(f.label.trim()));
  const v = hit ? answers[hit.key] : null;
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null;
}
