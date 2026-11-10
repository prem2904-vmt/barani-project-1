import { FieldDef, FormDefinition, NarrativeSectionDef, OptionDef, PageDef, PlainKind, ShowWhenDef } from '../core/types';
import { kindBuild } from '../kinds/build-registry';

/**
 * Studio's edits to a form definition, as pure functions: definition in,
 * NEW definition out (the input is never changed), so the editor can keep
 * an undo trail and diff what changed. Keys are unique form-wide (the API's
 * validator says so), so a field is addressed by its key wherever it sits:
 * on a page, inside an option (a follow-up question) or in a repeating group.
 *
 * The narrative is kept where the doctor works: a field "writes into" a
 * section; Studio keeps that section's template holding `{{fieldKey}}` so
 * nobody has to open a separate narrative screen to make a field appear.
 */

export const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** Change a deep copy and return it. */
export function edit(def: FormDefinition, change: (d: FormDefinition) => void): FormDefinition {
  const copy = structuredClone(def) as FormDefinition;
  copy.pages ??= [];
  change(copy);
  return copy;
}

export function emptyDefinition(title: string): FormDefinition {
  return { schemaVersion: 2, title, pages: [], narrative: { sections: [] } };
}

// ---------------------------------------------------------------- finding

export interface FieldLocation {
  field: FieldDef;
  /** The list the field sits in (page.fields, option.subFields or field.children). */
  list: FieldDef[];
  index: number;
  page: PageDef;
  /** Set when the field is a follow-up of an option. */
  ownerField?: FieldDef;
  ownerOption?: OptionDef;
  /** Set when the field is a child of a repeating group. */
  parentGroup?: FieldDef;
}

export function locate(def: FormDefinition, key: string): FieldLocation | null {
  for (const page of def.pages ?? []) {
    const hit = findIn(page.fields, key, page);
    if (hit) return hit;
  }
  return null;
}

function findIn(list: FieldDef[], key: string, page: PageDef, owner?: Partial<FieldLocation>): FieldLocation | null {
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    if (f.key === key) return { field: f, list, index: i, page, ...owner };
    for (const o of f.options ?? []) {
      const hit = findIn((o.subFields ??= []), key, page, { ownerField: f, ownerOption: o });
      if (hit) return hit;
    }
    const hit = findIn((f.children ??= []), key, page, { parentGroup: f });
    if (hit) return hit;
  }
  return null;
}

export function findField(def: FormDefinition, key: string): FieldDef | null {
  return locate(def, key)?.field ?? null;
}

/** Every key in use (pages, fields, options are separate namespaces; this is fields + pages + sections). */
function usedKeys(def: FormDefinition): Set<string> {
  const used = new Set<string>();
  const walk = (fs: FieldDef[]) => {
    for (const f of fs) {
      used.add(f.key.toLowerCase());
      for (const o of f.options ?? []) walk(o.subFields ?? []);
      walk(f.children ?? []);
    }
  };
  for (const p of def.pages ?? []) {
    used.add(p.key.toLowerCase());
    walk(p.fields ?? []);
  }
  for (const s of def.narrative?.sections ?? []) used.add(s.key.toLowerCase());
  return used;
}

/** "Chief complaints" → "chiefComplaints" (unique in the form, valid for the API). */
export function keyFrom(label: string, taken: Set<string> | FormDefinition, fallback = 'field'): string {
  const used = taken instanceof Set ? taken : usedKeys(taken);
  const words = label
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
  let base = words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join('');
  if (!/^[A-Za-z]/.test(base)) base = fallback + base;
  base = base.slice(0, 48) || fallback;
  let key = base;
  for (let n = 2; used.has(key.toLowerCase()); n++) key = `${base}${n}`;
  return key;
}

/** Option keys are unique inside their field only. */
export function optionKeyFrom(label: string, field: FieldDef): string {
  const used = new Set((field.options ?? []).map((o) => o.key.toLowerCase()));
  return keyFrom(label, used, 'option');
}

// ---------------------------------------------------------------- sections

function sections(def: FormDefinition): NarrativeSectionDef[] {
  def.narrative ??= { sections: [] };
  def.narrative.sections ??= [];
  return def.narrative.sections;
}

export function sectionOf(def: FormDefinition, key: string): NarrativeSectionDef | null {
  return (def.narrative?.sections ?? []).find((s) => s.key === key) ?? null;
}

/** The section a page's new fields write into (created with the page). */
export function pageSection(def: FormDefinition, pageKey: string): NarrativeSectionDef | null {
  return sectionOf(def, pageKey);
}

export function addSection(def: FormDefinition, title: string, key?: string): FormDefinition {
  return edit(def, (d) => {
    const list = sections(d);
    const k = key ?? keyFrom(title, d, 'section');
    if (list.some((s) => s.key === k)) return;
    list.push({ key: k, title, order: list.length + 1, template: '' });
  });
}

const placeholder = (key: string) => `{{${key}}}`;

function removePlaceholder(template: string, key: string): string {
  return template
    .split(placeholder(key))
    .join('')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +\n/g, '\n')
    .trim();
}

function appendPlaceholder(template: string, key: string): string {
  if (template.includes(placeholder(key))) return template;
  const t = (template ?? '').trimEnd();
  return t ? `${t} ${placeholder(key)}` : placeholder(key);
}

/** Which section the field writes into (null = not in the narrative). */
export function sectionKeyOf(def: FormDefinition, field: FieldDef): string | null {
  const named = field.says?.sections?.[0]?.section;
  if (named && sectionOf(def, named)) return named;
  const holder = (def.narrative?.sections ?? []).find((s) => (s.template ?? '').includes(placeholder(field.key)));
  return holder?.key ?? null;
}

/** Put the field in a section (or take it out with null): its sentence goes to the end of that paragraph. */
export function writeInto(def: FormDefinition, fieldKey: string, sectionKey: string | null): FormDefinition {
  return edit(def, (d) => {
    const f = findField(d, fieldKey);
    if (!f) return;
    for (const s of sections(d)) s.template = removePlaceholder(s.template ?? '', fieldKey);
    f.says ??= { include: true };
    if (!sectionKey) {
      f.says.sections = [];
      return;
    }
    const s = sectionOf(d, sectionKey);
    if (!s) return;
    s.template = appendPlaceholder(s.template ?? '', fieldKey);
    f.says.include = true;
    f.says.sections = [{ section: sectionKey, order: orderIn(d, sectionKey) }];
  });
}

function orderIn(def: FormDefinition, sectionKey: string): number {
  let n = 0;
  const walk = (fs: FieldDef[]) => {
    for (const f of fs) {
      if (f.says?.sections?.some((r) => r.section === sectionKey)) n++;
      walk(f.children ?? []);
    }
  };
  for (const p of def.pages ?? []) walk(p.fields ?? []);
  return n + 1;
}

// ---------------------------------------------------------------- pages

export function addPage(def: FormDefinition, title: string, at?: number): { def: FormDefinition; key: string } {
  let key = '';
  const next = edit(def, (d) => {
    key = keyFrom(title, d, 'page');
    const page: PageDef = { key, title, fields: [] };
    const i = at === undefined ? d.pages.length : Math.max(0, Math.min(at, d.pages.length));
    d.pages.splice(i, 0, page);
    const list = sections(d);
    list.push({ key, title, order: list.length + 1, template: '' });
    renumberSections(d);
  });
  return { def: next, key };
}

/** Sections that belong to pages follow the page order; other sections keep their place after them. */
function renumberSections(d: FormDefinition): void {
  const list = sections(d);
  const pageOrder = new Map(d.pages.map((p, i) => [p.key, i]));
  list.sort((a, b) => {
    const pa = pageOrder.get(a.key);
    const pb = pageOrder.get(b.key);
    if (pa !== undefined && pb !== undefined) return pa - pb;
    return (a.order ?? 0) - (b.order ?? 0);
  });
  list.forEach((s, i) => (s.order = i + 1));
}

export function renamePage(def: FormDefinition, pageKey: string, title: string): FormDefinition {
  return edit(def, (d) => {
    const p = d.pages.find((x) => x.key === pageKey);
    if (!p) return;
    const s = sectionOf(d, pageKey);
    if (s && s.title === p.title) s.title = title;
    p.title = title;
  });
}

export function movePage(def: FormDefinition, from: number, to: number): FormDefinition {
  return edit(def, (d) => {
    if (from === to || from < 0 || from >= d.pages.length) return;
    const [p] = d.pages.splice(from, 1);
    d.pages.splice(Math.max(0, Math.min(to, d.pages.length)), 0, p);
    renumberSections(d);
  });
}

export function removePage(def: FormDefinition, pageKey: string): FormDefinition {
  return edit(def, (d) => {
    const p = d.pages.find((x) => x.key === pageKey);
    if (!p) return;
    const gone = keysUnder(p.fields);
    d.pages = d.pages.filter((x) => x !== p);
    const s = sectionOf(d, pageKey);
    if (s && !(s.template ?? '').replace(/\{\{[^}]+\}\}/g, '').trim()) {
      d.narrative!.sections = sections(d).filter((x) => x !== s);
    }
    forget(d, gone);
    renumberSections(d);
  });
}

// ---------------------------------------------------------------- fields

/** Where a new field goes: a page (index), or the follow-ups of one option. */
export interface FieldSlot {
  pageKey?: string;
  at?: number;
  option?: { fieldKey: string; optionKey: string };
  group?: string;
}

/** A new field of `kind`, with the catalogue's default settings and the kind's starter options and sentence. */
export function newField(def: FormDefinition, kind: PlainKind | string, defaults?: Record<string, unknown>, label?: string): FieldDef {
  const b = kindBuild(kind);
  const name = label ?? b.name;
  const field: FieldDef = {
    key: keyFrom(name, def),
    kind,
    label: name,
    required: false,
    config: structuredClone({ ...(b.starterConfig ?? {}), ...(defaults ?? {}) }),
    options: structuredClone(b.starterOptions ?? []),
    children: [],
    says: { include: true, sections: [], sentence: b.sentence(name) || undefined },
  };
  if (kind === 'multi') field.says!.negativeHistory = { enabled: false, prefix: 'Denies' };
  if (!field.says!.sentence) delete field.says!.sentence;
  return field;
}

export function addField(
  def: FormDefinition,
  slot: FieldSlot,
  kind: PlainKind | string,
  defaults?: Record<string, unknown>,
): { def: FormDefinition; key: string } {
  const field = newField(def, kind, defaults);
  return insertField(def, slot, field);
}

/** Insert a ready field (a template, a copy). It writes into the page's own section when on a page. */
export function insertField(def: FormDefinition, slot: FieldSlot, field: FieldDef): { def: FormDefinition; key: string } {
  let next = edit(def, (d) => {
    const list = slotList(d, slot);
    if (!list) return;
    const i = slot.at === undefined ? list.length : Math.max(0, Math.min(slot.at, list.length));
    list.splice(i, 0, field);
  });
  if (slot.pageKey && !slot.option && !slot.group && pageSection(next, slot.pageKey)) {
    next = writeInto(next, field.key, slot.pageKey);
  }
  return { def: next, key: field.key };
}

function slotList(d: FormDefinition, slot: FieldSlot): FieldDef[] | null {
  if (slot.option) {
    const owner = findField(d, slot.option.fieldKey);
    const o = owner?.options?.find((x) => x.key === slot.option!.optionKey);
    return o ? (o.subFields ??= []) : null;
  }
  if (slot.group) {
    const g = findField(d, slot.group);
    return g ? (g.children ??= []) : null;
  }
  const p = d.pages.find((x) => x.key === slot.pageKey);
  return p ? (p.fields ??= []) : null;
}

export function updateField(def: FormDefinition, key: string, change: (f: FieldDef) => void): FormDefinition {
  return edit(def, (d) => {
    const f = findField(d, key);
    if (f) change(f);
  });
}

/** Rename keeps the key (answers and conditions stay valid). A sentence still at its starter words follows the new name. */
export function setLabel(def: FormDefinition, key: string, label: string): FormDefinition {
  return updateField(def, key, (f) => {
    const b = kindBuild(f.kind);
    if (f.says?.sentence && f.says.sentence === b.sentence(f.label)) f.says.sentence = b.sentence(label);
    f.label = label;
  });
}

/** Move a field inside the list it sits in (a page, an option's follow-ups, a group). */
export function moveField(def: FormDefinition, key: string, to: number): FormDefinition {
  return edit(def, (d) => {
    const loc = locate(d, key);
    if (!loc) return;
    const target = Math.max(0, Math.min(to, loc.list.length - 1));
    if (target === loc.index) return;
    loc.list.splice(loc.index, 1);
    loc.list.splice(target, 0, loc.field);
  });
}

/** Move a field to another page (end of it). */
export function moveFieldToPage(def: FormDefinition, key: string, pageKey: string): FormDefinition {
  let next = edit(def, (d) => {
    const loc = locate(d, key);
    const page = d.pages.find((p) => p.key === pageKey);
    if (!loc || !page || loc.page === page) return;
    loc.list.splice(loc.index, 1);
    page.fields.push(loc.field);
  });
  const f = findField(next, key);
  const current = f ? sectionKeyOf(next, f) : null;
  if (f && current && current !== pageKey && pageSection(next, pageKey) && pageSection(next, current)) {
    // it wrote into its old page's paragraph: follow the field to the new page
    next = writeInto(next, key, pageKey);
  }
  return next;
}

export function duplicateField(def: FormDefinition, key: string): { def: FormDefinition; key: string } {
  const loc = locate(def, key);
  if (!loc) return { def, key };
  const copy = rekey(structuredClone(loc.field), def);
  copy.label = `${loc.field.label} (copy)`;
  let next = edit(def, (d) => {
    const l = locate(d, key)!;
    l.list.splice(l.index + 1, 0, copy);
  });
  const section = sectionKeyOf(def, loc.field);
  if (section && !loc.ownerOption && !loc.parentGroup) next = writeInto(next, copy.key, section);
  return { def: next, key: copy.key };
}

/** Give a field (and everything under it) fresh keys that are free in `def`. */
export function rekey(field: FieldDef, def: FormDefinition): FieldDef {
  return rekeyAll([field], def)[0];
}

/** Fresh keys for several fields at once; conditions and templates between them follow the new keys. */
export function rekeyAll(fields: FieldDef[], def: FormDefinition): FieldDef[] {
  const used = usedKeys(def);
  const map = new Map<string, string>();
  const walk = (f: FieldDef) => {
    const k = keyFrom(f.label || f.key, used, 'field');
    used.add(k.toLowerCase());
    map.set(f.key, k);
    f.key = k;
    for (const o of f.options ?? []) for (const s of o.subFields ?? []) walk(s);
    for (const c of f.children ?? []) walk(c);
  };
  fields.forEach(walk);
  const fix = (f: FieldDef) => {
    for (const c of f.showWhen?.conditions ?? []) if (map.has(c.field)) c.field = map.get(c.field)!;
    if (f.says) f.says.sections = [];
    const tpl = f.config?.['narrativeTemplate'];
    if (typeof tpl === 'string' && f.config) {
      f.config['narrativeTemplate'] = tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (map.has(k) ? `{{${map.get(k)}}}` : m));
    }
    for (const o of f.options ?? []) for (const s of o.subFields ?? []) fix(s);
    for (const c of f.children ?? []) fix(c);
  };
  fields.forEach(fix);
  return fields;
}

export function removeField(def: FormDefinition, key: string): FormDefinition {
  return edit(def, (d) => {
    const loc = locate(d, key);
    if (!loc) return;
    loc.list.splice(loc.index, 1);
    forget(d, keysUnder([loc.field]));
  });
}

function keysUnder(fields: FieldDef[]): Set<string> {
  const out = new Set<string>();
  const walk = (fs: FieldDef[]) => {
    for (const f of fs) {
      out.add(f.key);
      for (const o of f.options ?? []) walk(o.subFields ?? []);
      walk(f.children ?? []);
    }
  };
  walk(fields);
  return out;
}

/** Drop everything that pointed at removed fields: conditions, placeholders, links, triggers. */
function forget(d: FormDefinition, gone: Set<string>): void {
  if (!gone.size) return;
  const cleanSw = (sw: ShowWhenDef | null | undefined): ShowWhenDef | null | undefined => {
    if (!sw) return sw;
    sw.conditions = (sw.conditions ?? []).filter((c) => !gone.has(c.field));
    return sw.conditions.length ? sw : null;
  };
  const walk = (fs: FieldDef[]) => {
    for (const f of fs) {
      f.showWhen = cleanSw(f.showWhen);
      for (const o of f.options ?? []) walk(o.subFields ?? []);
      walk(f.children ?? []);
    }
  };
  for (const p of d.pages) {
    p.showWhen = cleanSw(p.showWhen);
    walk(p.fields ?? []);
  }
  for (const s of d.narrative?.sections ?? []) {
    let t = s.template ?? '';
    for (const k of gone) t = removePlaceholder(t, k);
    s.template = t;
  }
  d.links = (d.links ?? [])
    .map((l) => ({ ...l, fields: l.fields.filter((f) => !gone.has(f.split('::')[0])) }))
    .filter((l) => l.fields.length > 1);
  d.triggers = (d.triggers ?? []).filter(
    (t) =>
      !t.conditions.some((c) => gone.has(c.source.split('::')[0])) &&
      !t.actions.some((a) => gone.has(a.target.split('::')[0])),
  );
}

// ---------------------------------------------------------------- options

export function addOption(def: FormDefinition, fieldKey: string, label: string): { def: FormDefinition; key: string } {
  let key = '';
  const next = updateField(def, fieldKey, (f) => {
    key = optionKeyFrom(label, f);
    (f.options ??= []).push({ key, label, subFields: [] });
  });
  return { def: next, key };
}

export function updateOption(
  def: FormDefinition,
  fieldKey: string,
  optionKey: string,
  change: (o: OptionDef) => void,
): FormDefinition {
  return updateField(def, fieldKey, (f) => {
    const o = f.options?.find((x) => x.key === optionKey);
    if (o) change(o);
  });
}

export function moveOption(def: FormDefinition, fieldKey: string, from: number, to: number): FormDefinition {
  return updateField(def, fieldKey, (f) => {
    const list = f.options ?? [];
    if (from < 0 || from >= list.length) return;
    const [o] = list.splice(from, 1);
    list.splice(Math.max(0, Math.min(to, list.length)), 0, o);
  });
}

export function removeOption(def: FormDefinition, fieldKey: string, optionKey: string): FormDefinition {
  const f = findField(def, fieldKey);
  const o = f?.options?.find((x) => x.key === optionKey);
  if (!f || !o) return def;
  const gone = keysUnder(o.subFields ?? []);
  return edit(def, (d) => {
    const ff = findField(d, fieldKey)!;
    ff.options = (ff.options ?? []).filter((x) => x.key !== optionKey);
    // a condition that compared with this option no longer can
    const walk = (fs: FieldDef[]) => {
      for (const x of fs) {
        if (x.showWhen)
          x.showWhen.conditions = x.showWhen.conditions.filter((c) => !(c.field === fieldKey && c.value === optionKey));
        if (x.showWhen && !x.showWhen.conditions.length) x.showWhen = null;
        for (const oo of x.options ?? []) walk(oo.subFields ?? []);
        walk(x.children ?? []);
      }
    };
    for (const p of d.pages) walk(p.fields);
    forget(d, gone);
  });
}

// ---------------------------------------------------------------- templates

/** Put a saved page (from the templates list) into the form with fresh keys, after `at`. */
export function insertPageTemplate(def: FormDefinition, page: PageDef, at?: number): { def: FormDefinition; key: string } {
  const added = addPage(def, page.title, at);
  let next = added.def;
  for (const copy of rekeyAll(structuredClone(page.fields ?? []), next)) {
    next = insertField(next, { pageKey: added.key }, copy).def;
  }
  return { def: next, key: added.key };
}

/** Put saved fields (a field template) on a page with fresh keys. */
export function insertFieldTemplate(def: FormDefinition, slot: FieldSlot, fields: FieldDef[]): { def: FormDefinition; keys: string[] } {
  let next = def;
  const keys: string[] = [];
  let at = slot.at;
  for (const copy of rekeyAll(structuredClone(fields), def)) {
    next = insertField(next, { ...slot, at }, copy).def;
    keys.push(copy.key);
    if (at !== undefined) at++;
  }
  return { def: next, keys };
}
