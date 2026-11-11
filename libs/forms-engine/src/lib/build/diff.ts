import { FieldDef, FormDefinition, OptionDef, PageDef } from '../core/types';
import { describeShowWhen } from './conditions';
import { kindBuild } from '../kinds/build-registry';

/**
 * A readable difference between two versions of a case sheet, in doctor words:
 * "Added the question "Pain" on History", "Changed what "Fever" says", not a
 * JSON diff. Grouped by page so history reads like a change note.
 */

export type ChangeKind = 'added' | 'removed' | 'changed' | 'moved';

export interface FormChange {
  kind: ChangeKind;
  /** The page the change belongs to (its title), or "Whole case sheet". */
  where: string;
  text: string;
  /** Before / after words when a sentence or condition changed. */
  before?: string;
  after?: string;
  fieldKey?: string;
}

interface Placed {
  field: FieldDef;
  page: PageDef;
  path: string;
}

function placed(def: FormDefinition): Map<string, Placed> {
  const out = new Map<string, Placed>();
  const walk = (fs: FieldDef[], page: PageDef, path: string) => {
    for (const f of fs) {
      out.set(f.key, { field: f, page, path });
      for (const o of f.options ?? []) walk(o.subFields ?? [], page, `${path}${f.label} → ${o.label} → `);
      walk(f.children ?? [], page, `${path}${f.label} → `);
    }
  };
  for (const p of def.pages ?? []) walk(p.fields ?? [], p, '');
  return out;
}

const q = (s: string) => `“${s}”`;
const norm = (s: string | null | undefined) => (s ?? '').trim();

export function diffDefinitions(before: FormDefinition, after: FormDefinition): FormChange[] {
  const out: FormChange[] = [];
  if (norm(before.title) !== norm(after.title))
    out.push({ kind: 'changed', where: 'Whole case sheet', text: 'Renamed the case sheet', before: norm(before.title), after: norm(after.title) });

  // pages
  const bPages = new Map((before.pages ?? []).map((p, i) => [p.key, { p, i }]));
  const aPages = new Map((after.pages ?? []).map((p, i) => [p.key, { p, i }]));
  for (const [k, { p }] of aPages)
    if (!bPages.has(k)) out.push({ kind: 'added', where: p.title, text: `Added the page ${q(p.title)}` });
  for (const [k, { p }] of bPages)
    if (!aPages.has(k)) out.push({ kind: 'removed', where: p.title, text: `Removed the page ${q(p.title)}` });
  const bOrder = (before.pages ?? []).map((p) => p.key).filter((k) => aPages.has(k));
  const aOrder = (after.pages ?? []).map((p) => p.key).filter((k) => bPages.has(k));
  if (bOrder.join('|') !== aOrder.join('|')) out.push({ kind: 'moved', where: 'Whole case sheet', text: 'Changed the order of the pages' });
  for (const [k, { p }] of aPages) {
    const b = bPages.get(k)?.p;
    if (!b) continue;
    if (norm(b.title) !== norm(p.title))
      out.push({ kind: 'changed', where: p.title, text: 'Renamed the page', before: b.title, after: p.title });
    const bsw = describeShowWhen(before, b.showWhen);
    const asw = describeShowWhen(after, p.showWhen);
    if (bsw !== asw) out.push({ kind: 'changed', where: p.title, text: 'Changed when the page shows', before: bsw, after: asw });
  }

  // fields
  const bf = placed(before);
  const af = placed(after);
  for (const [k, a] of af) {
    const b = bf.get(k);
    if (!b) {
      out.push({ kind: 'added', where: a.page.title, text: `Added the question ${q(a.path + a.field.label)}`, fieldKey: k });
      continue;
    }
    fieldChanges(before, after, b, a, out);
  }
  for (const [k, b] of bf)
    if (!af.has(k) && aPages.has(b.page.key))
      out.push({ kind: 'removed', where: b.page.title, text: `Removed the question ${q(b.path + b.field.label)}`, fieldKey: k });

  // order of questions on a page
  for (const [k, { p }] of aPages) {
    const b = bPages.get(k)?.p;
    if (!b) continue;
    const keep = new Set(p.fields.map((f) => f.key));
    const was = b.fields.map((f) => f.key).filter((x) => keep.has(x));
    const now = p.fields.map((f) => f.key).filter((x) => was.includes(x));
    if (was.join('|') !== now.join('|')) out.push({ kind: 'moved', where: p.title, text: 'Changed the order of the questions' });
  }

  // narrative paragraphs (the words around the answers)
  const bs = new Map((before.narrative?.sections ?? []).map((s) => [s.key, s]));
  for (const s of after.narrative?.sections ?? []) {
    const b = bs.get(s.key);
    if (!b) continue;
    if (norm(b.title) !== norm(s.title))
      out.push({ kind: 'changed', where: 'Narrative', text: 'Renamed a paragraph heading', before: b.title, after: s.title });
    if (norm(stripPlaceholders(b.template)) !== norm(stripPlaceholders(s.template)))
      out.push({ kind: 'changed', where: 'Narrative', text: `Changed the wording of ${q(s.title)}`, before: b.template, after: s.template });
  }
  return out;
}

function stripPlaceholders(t: string | undefined): string {
  return (t ?? '').replace(/\{\{\w+\}\}/g, '').replace(/\s+/g, ' ');
}

function fieldChanges(bd: FormDefinition, ad: FormDefinition, b: Placed, a: Placed, out: FormChange[]): void {
  const name = q(a.path + a.field.label);
  const where = a.page.title;
  const fieldKey = a.field.key;
  const push = (text: string, before?: string, after?: string) =>
    out.push({ kind: 'changed', where, text, before, after, fieldKey });
  if (b.page.key !== a.page.key) out.push({ kind: 'moved', where, text: `Moved ${name} from ${q(b.page.title)}`, fieldKey });
  if (norm(b.field.label) !== norm(a.field.label)) push(`Renamed ${q(b.field.label)}`, b.field.label, a.field.label);
  if (b.field.kind !== a.field.kind) push(`Changed the kind of ${name}`, kindBuild(b.field.kind).name, kindBuild(a.field.kind).name);
  if (!!b.field.required !== !!a.field.required) push(a.field.required ? `${name} must now be answered` : `${name} no longer has to be answered`);
  if (norm(b.field.says?.sentence) !== norm(a.field.says?.sentence))
    push(`Changed what ${name} says`, norm(b.field.says?.sentence) || '(nothing)', norm(a.field.says?.sentence) || '(nothing)');
  const bn = b.field.says?.negativeHistory;
  const an = a.field.says?.negativeHistory;
  if (!!bn?.enabled !== !!an?.enabled || (an?.enabled && norm(bn?.prefix) !== norm(an?.prefix)))
    push(`Changed what ${name} says when nothing is chosen`, bn?.enabled ? `${bn.prefix} …` : '(nothing)', an?.enabled ? `${an.prefix} …` : '(nothing)');
  if (norm(b.field.says?.whenTrue) !== norm(a.field.says?.whenTrue) || norm(b.field.says?.whenFalse) !== norm(a.field.says?.whenFalse))
    push(`Changed what ${name} says when ticked or not`);
  const bsw = describeShowWhen(bd, b.field.showWhen);
  const asw = describeShowWhen(ad, a.field.showWhen);
  if (bsw !== asw) push(`Changed when ${name} shows`, bsw, asw);
  optionChanges(b.field.options ?? [], a.field.options ?? [], name, push);
  if (JSON.stringify(b.field.config ?? {}) !== JSON.stringify(a.field.config ?? {})) push(`Changed the settings of ${name}`);
}

function optionChanges(
  b: OptionDef[],
  a: OptionDef[],
  name: string,
  push: (text: string, before?: string, after?: string) => void,
): void {
  const bm = new Map(b.map((o) => [o.key, o]));
  const am = new Map(a.map((o) => [o.key, o]));
  for (const o of a) {
    const was = bm.get(o.key);
    if (!was) {
      push(`Added the choice ${q(o.label)} to ${name}`);
      continue;
    }
    if (norm(was.label) !== norm(o.label)) push(`Renamed the choice ${q(was.label)} in ${name}`, was.label, o.label);
    if (norm(was.says) !== norm(o.says))
      push(`Changed what ${q(o.label)} says in ${name}`, norm(was.says) || '(its name)', norm(o.says) || '(its name)');
  }
  for (const o of b) if (!am.has(o.key)) push(`Removed the choice ${q(o.label)} from ${name}`);
}

/** "3 added · 1 removed · 4 changed" for a version row. */
export function summariseChanges(changes: FormChange[]): string {
  const n = (k: ChangeKind) => changes.filter((c) => c.kind === k).length;
  const parts = [
    n('added') && `${n('added')} added`,
    n('removed') && `${n('removed')} removed`,
    n('changed') + n('moved') && `${n('changed') + n('moved')} changed`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No changes';
}
