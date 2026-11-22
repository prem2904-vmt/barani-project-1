import { FormRow } from '../data/studio-models';
import { sortsAndFilters } from '../../../../shared/utils/work-grid';
import { deptCode, filterSheets, railRows, sheetColumns, statusLabel, statusOf, statusWordsOf } from './case-sheet-grid';

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
    // Phone: Name (wraps, not pinned) + Origin + the actions - everything fits a 390px screen, no sideways scroll.
    const phone = sheetColumns(false, true);
    expect(phone.map((c) => c.headerName)).toEqual(['Name', 'Origin', '']);
    expect(phone[0].pinned).toBeNull();
    const fixed = phone.reduce((n, c) => n + (c.flex ? 0 : (c.width ?? 0)), 0);
    expect(fixed + (phone[0].minWidth ?? 0)).toBeLessThanOrEqual(390 - 32 - 2);
  });

  it('columns: every data column sorts and filters; only the actions column is exempt', () => {
    for (const c of sheetColumns(true, false)) {
      if (c.colId === 'actions') expect([c.sortable, c.filter]).toEqual([false, false]);
      else expect(sortsAndFilters(c as never), String(c.colId)).toBe(true);
    }
  });

  it('columns: Pending sorts on the injected count, Updated on the epoch', () => {
    const cols = sheetColumns(true, false, () => 3);
    const get = (id: string, r: FormRow) => (cols.find((c) => c.colId === id)!.valueGetter as (p: { data: FormRow }) => unknown)({ data: r });
    expect(get('pending', row({}))).toBe(3);
    expect(get('updated', row({ published: pub }))).toBe(Date.parse('2026-11-01T00:00:00Z'));
  });

  it('columns: every desktop column fits the card at 1440 with the department rail open (about 1000px)', () => {
    const need = sheetColumns(true, false).reduce((n, c) => n + (c.minWidth ?? c.width ?? 0), 0);
    expect(need).toBeLessThanOrEqual(1000);
  });
});

describe('statusWordsOf', () => {
  it('published is done; a waiting draft shows as the quiet line', () => {
    expect(statusWordsOf(row({ published: pub }))).toEqual({ now: 'Published', detail: null, tone: 'done' });
    expect(statusWordsOf(row({ published: pub, draft: { state: 'editing' } as unknown as FormRow['draft'] }))).toEqual({ now: 'Published', detail: 'Changes in draft', tone: 'done' });
  });
  it('draft and in review are normal text', () => {
    expect(statusWordsOf(row({}))).toEqual({ now: 'Draft', detail: null, tone: 'normal' });
    expect(statusWordsOf(row({ draft: { state: 'in_review' } as unknown as FormRow['draft'] }))).toEqual({ now: 'In review', detail: null, tone: 'normal' });
  });
});
