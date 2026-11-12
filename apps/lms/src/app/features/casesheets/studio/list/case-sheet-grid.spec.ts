import { FormRow } from '../data/studio-models';
import { deptCode, filterSheets, railRows, sheetColumns, statusLabel, statusOf } from './case-sheet-grid';

const row = (o: Partial<FormRow>): FormRow => ({
  id: 'f', key: 'k', title: 'T', specialty: null, status: 'active', origin: 'local', departmentKey: null, departmentName: null, catalogKey: null,
  readOnly: false, forkedFromVersionId: null, pinned: false, newerMaster: false, published: null, draft: null, ...o,
});
const pub = { id: 'v', versionNo: 2, publishedAt: '2026-11-01T00:00:00Z' };
const depts = [{ key: 'ent', name: 'ENT', sortOrder: 1 }, { key: 'gm', name: 'General Medicine', sortOrder: 2, isActive: false }];

describe('case-sheet list (Test Master pattern)', () => {
  it('codes: initials, ENT stays ENT, & ignored', () => {
    expect(deptCode('ENT')).toBe('ENT');
    expect(deptCode('General Medicine')).toBe('GM');
    expect(deptCode('Obstetrics & Gynaecology')).toBe('OG');
  });

  it('status: published wins; draft otherwise; wording', () => {
    expect(statusOf(row({ published: pub }))).toBe('published');
    expect(statusLabel(row({ published: pub }))).toBe('Published');
    expect(statusLabel(row({}))).toBe('Draft');
  });

  it('rail: department order, counts, off flag, Other for unknown departments', () => {
    const r = railRows([row({ id: '1', departmentKey: 'ent' }), row({ id: '2', departmentKey: 'ENT' }), row({ id: '3', departmentKey: 'zzz' })], depts);
    expect(r.map((x) => [x.key, x.count, x.isActive])).toEqual([['ent', 2, true], ['gm', 0, false], ['other', 1, true]]);
  });

  it('filters: department, status pill, origin pill and the search all narrow together', () => {
    const forms = [
      row({ id: '1', title: 'Ear', departmentKey: 'ent', departmentName: 'ENT', origin: 'master', published: pub }),
      row({ id: '2', title: 'Nose', departmentKey: 'ent', departmentName: 'ENT', origin: 'override' }),
      row({ id: '3', title: 'CVS', departmentKey: 'gm', departmentName: 'General Medicine' }),
    ];
    const all = { query: '', dept: null, status: 'all', origin: 'all' } as const;
    expect(filterSheets(forms, depts, all)).toHaveLength(3);
    expect(filterSheets(forms, depts, { ...all, dept: 'ent' }).map((f) => f.title)).toEqual(['Ear', 'Nose']);
    expect(filterSheets(forms, depts, { ...all, status: 'draft' }).map((f) => f.title)).toEqual(['Nose', 'CVS']);
    expect(filterSheets(forms, depts, { ...all, origin: 'copy' }).map((f) => f.title)).toEqual(['Nose']);
    expect(filterSheets(forms, depts, { ...all, query: 'medicine' }).map((f) => f.title)).toEqual(['CVS']);
    expect(filterSheets(forms, depts, { ...all, dept: 'other' })).toHaveLength(0);
  });

  it('columns: Name pinned, Origin chip, an actions column pinned right; a phone keeps the essentials', () => {
    const cols = sheetColumns(true, false);
    expect(cols.map((c) => c.headerName)).toEqual(['Name', 'Department', 'Origin', 'Version', 'Status', 'Pending', 'Updated', '']);
    expect(cols[0].pinned).toBe('left');
    expect(cols[cols.length - 1].pinned).toBe('right');
    expect(sheetColumns(false, true).map((c) => c.headerName)).toEqual(['Name', 'Origin', 'Status', '']);
  });
});
