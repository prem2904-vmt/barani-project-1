import { FormDefinition } from '../core/types';
import {
  addField,
  addOption,
  addPage,
  duplicateField,
  emptyDefinition,
  findField,
  insertPageTemplate,
  keyFrom,
  locate,
  moveField,
  movePage,
  moveFieldToPage,
  removeField,
  removeOption,
  removePage,
  renamePage,
  sectionKeyOf,
  sectionOf,
  updateField,
  writeInto,
  KEY_PATTERN,
} from './doc';

function twoPages(): FormDefinition {
  let d = emptyDefinition('ENT');
  d = addPage(d, 'Complaints').def;
  d = addPage(d, 'History').def;
  return d;
}

describe('Studio definition edits', () => {
  it('never changes the definition it was given', () => {
    const d = twoPages();
    const before = JSON.stringify(d);
    addField(d, { pageKey: 'complaints' }, 'multi');
    renamePage(d, 'complaints', 'Chief complaints');
    expect(JSON.stringify(d)).toBe(before);
  });

  it('keys come from labels, are unique and valid for the API', () => {
    const d = twoPages();
    expect(keyFrom('Chief complaints', d)).toBe('chiefComplaints');
    expect(keyFrom('History', d)).toBe('history2');
    expect(keyFrom('2nd visit!', d)).toMatch(KEY_PATTERN);
    expect(keyFrom('', d)).toBe('field');
  });

  it('a new page gets its own narrative paragraph; a new field writes into it', () => {
    let d = twoPages();
    expect(sectionOf(d, 'complaints')?.title).toBe('Complaints');
    const r = addField(d, { pageKey: 'complaints' }, 'multi', { display: 'chips' });
    d = r.def;
    const f = findField(d, r.key)!;
    expect(f.kind).toBe('multi');
    expect(f.label).toBe('Multiple choice');
    expect(f.options?.length).toBe(3);
    expect(f.config).toEqual({ display: 'chips' });
    expect(f.says?.sentence).toBe('The patient reports {value}.');
    expect(sectionKeyOf(d, f)).toBe('complaints');
    expect(sectionOf(d, 'complaints')?.template).toBe(`{{${r.key}}}`);
  });

  it('"writes into" moves the placeholder between paragraphs, or takes it out', () => {
    let d = twoPages();
    const { def, key } = addField(d, { pageKey: 'complaints' }, 'text');
    d = writeInto(def, key, 'history');
    expect(sectionOf(d, 'complaints')?.template).toBe('');
    expect(sectionOf(d, 'history')?.template).toBe(`{{${key}}}`);
    expect(findField(d, key)?.says?.sections).toEqual([{ section: 'history', order: 1 }]);
    d = writeInto(d, key, null);
    expect(sectionOf(d, 'history')?.template).toBe('');
    expect(sectionKeyOf(d, findField(d, key)!)).toBeNull();
  });

  it('reorders fields and pages; section order follows the pages', () => {
    let d = twoPages();
    const a = addField(d, { pageKey: 'complaints' }, 'text');
    const b = addField(a.def, { pageKey: 'complaints' }, 'number');
    d = moveField(b.def, b.key, 0);
    expect(d.pages[0].fields.map((f) => f.key)).toEqual([b.key, a.key]);
    d = movePage(d, 1, 0);
    expect(d.pages.map((p) => p.key)).toEqual(['history', 'complaints']);
    expect(d.narrative!.sections.map((s) => [s.key, s.order])).toEqual([
      ['history', 1],
      ['complaints', 2],
    ]);
  });

  it('a field moved to another page follows into that page’s paragraph', () => {
    const a = addField(twoPages(), { pageKey: 'complaints' }, 'text');
    const d = moveFieldToPage(a.def, a.key, 'history');
    expect(locate(d, a.key)?.page.key).toBe('history');
    expect(sectionKeyOf(d, findField(d, a.key)!)).toBe('history');
  });

  it('renaming a page renames its own paragraph heading', () => {
    const d = renamePage(twoPages(), 'history', 'History of present illness');
    expect(sectionOf(d, 'history')?.title).toBe('History of present illness');
  });

  it('removing a field removes the conditions and placeholders that used it', () => {
    let d = twoPages();
    const pain = addField(d, { pageKey: 'complaints' }, 'yesno');
    const where = addField(pain.def, { pageKey: 'complaints' }, 'text');
    d = updateField(where.def, where.key, (f) => (f.showWhen = { conditions: [{ field: pain.key, op: 'equals', value: 'yes' }] }));
    d = removeField(d, pain.key);
    expect(findField(d, where.key)?.showWhen).toBeNull();
    expect(sectionOf(d, 'complaints')?.template).toBe(`{{${where.key}}}`);
  });

  it('follow-up questions live under an option; removing the option removes them', () => {
    const c = addField(twoPages(), { pageKey: 'complaints' }, 'multi');
    const opt = addOption(c.def, c.key, 'Nasal block');
    const side = addField(opt.def, { option: { fieldKey: c.key, optionKey: opt.key } }, 'choice');
    expect(locate(side.def, side.key)?.ownerOption?.label).toBe('Nasal block');
    // a follow-up does not write into a paragraph by itself
    expect(sectionKeyOf(side.def, findField(side.def, side.key)!)).toBeNull();
    const d = removeOption(side.def, c.key, opt.key);
    expect(findField(d, side.key)).toBeNull();
  });

  it('duplicate gives fresh keys, the same paragraph, right after the original', () => {
    const c = addField(twoPages(), { pageKey: 'complaints' }, 'yesno');
    const dup = duplicateField(c.def, c.key);
    expect(dup.key).not.toBe(c.key);
    expect(dup.def.pages[0].fields.map((f) => f.key)).toEqual([c.key, dup.key]);
    expect(sectionOf(dup.def, 'complaints')?.template).toBe(`{{${c.key}}} {{${dup.key}}}`);
  });

  it('a page template comes in with fresh keys and conditions that still point inside it', () => {
    const tpl = {
      key: 'vitals',
      title: 'Vitals',
      fields: [
        { key: 'fever', kind: 'yesno', label: 'Fever', options: [] },
        { key: 'temp', kind: 'number', label: 'Temperature', showWhen: { conditions: [{ field: 'fever', op: 'equals', value: 'yes' }] } },
      ],
    };
    let d = twoPages();
    d = addField(d, { pageKey: 'complaints' }, 'yesno').def; // takes no keys from the template
    const r = insertPageTemplate(d, tpl, 1);
    const page = r.def.pages[1];
    expect(page.title).toBe('Vitals');
    const [fever, temp] = page.fields;
    expect(temp.showWhen?.conditions[0].field).toBe(fever.key);
    expect(sectionOf(r.def, r.key)?.template).toBe(`{{${fever.key}}} {{${temp.key}}}`);
  });

  it('removing a page drops its empty paragraph', () => {
    const d = removePage(twoPages(), 'history');
    expect(d.pages.map((p) => p.key)).toEqual(['complaints']);
    expect(sectionOf(d, 'history')).toBeNull();
  });
});
