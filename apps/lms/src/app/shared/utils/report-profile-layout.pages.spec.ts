import type { PageLayoutPage, ReportSection } from '../models/report-layout.model';
import {
  assignRowToBox, manualRowsByBox, readPageLayout, rowAssignmentIssues, setTableMode, tableChain, writePageLayout,
} from './report-profile-layout';

/** Custom layout (multi-page) storage + table row rules (owner 2026-10-02). */
const t = (id: string, y = 0, rows?: string[]) => ({ id, kind: 'table' as const, x: 0, y, w: 100, h: 50, ...(rows ? { rows } : {}) });
const KEYS = ['Hb', 'RBC', 'WBC', 'PLT'];

describe('Custom layout — storage', () => {
  it('a saved v1 (single-page) layout reads as page 1, unchanged — no migration', () => {
    const v1 = [{ id: 'page-layout', type: 'page_layout', order: 1, v: 1, enabled: true, boxes: [t('table')] }] as unknown as ReportSection[];
    const pl = readPageLayout(v1)!;
    expect(pl.pages).toEqual([{ id: 'page-1', boxes: [t('table')] }]);
    expect(pl.tableMode).toBe('auto');
  });
  it('writes v2 pages AND mirrors page 1 in `boxes` for any older reader; reads back the same', () => {
    const pages: PageLayoutPage[] = [{ id: 'p1', boxes: [t('a')] }, { id: 'p2', boxes: [t('b')] }];
    const secs = writePageLayout([], { enabled: true, pages, tableMode: 'manual' });
    const raw = secs[0] as unknown as Record<string, unknown>;
    expect(raw['v']).toBe(2);
    expect(raw['boxes']).toEqual([t('a')]);
    const back = readPageLayout(secs)!;
    expect(back.pages).toEqual(pages);
    expect(back.tableMode).toBe('manual');
    // The resolved (mw passthrough) shape reads the same.
    expect(readPageLayout([{ type: 'page_layout', pageLayout: raw }])!.pages!.length).toBe(2);
  });
});

describe('Custom layout — table across pages', () => {
  const pages = (): PageLayoutPage[] => [{ id: 'p1', boxes: [t('b2', 60), t('b1', 0)] }, { id: 'p2', boxes: [t('b3')] }];
  it('the table chain runs page by page, top-down', () => {
    expect(tableChain(pages()).map(x => x.box.id)).toEqual(['b1', 'b2', 'b3']);
  });
  it('switching to MANUAL puts every row in the first box (nothing missing); back to AUTO drops the lists', () => {
    const m = setTableMode(pages(), 'manual', KEYS);
    expect(tableChain(m).map(x => x.box.rows)).toEqual([KEYS, [], []]);
    expect(rowAssignmentIssues(m, KEYS)).toEqual([]);
    expect(tableChain(setTableMode(m, 'auto', KEYS)).every(x => x.box.rows === undefined)).toBe(true);
  });
  it('moving a row takes it out of every other box', () => {
    const m = assignRowToBox(setTableMode(pages(), 'manual', KEYS), 'PLT', 'b3');
    expect(tableChain(m).map(x => x.box.rows)).toEqual([['Hb', 'RBC', 'WBC'], [], ['PLT']]);
  });
  it('validation names missing and duplicated rows', () => {
    const p: PageLayoutPage[] = [{ id: 'p1', boxes: [t('a', 0, ['Hb', 'RBC']), t('b', 60, ['RBC'])] }];
    const issues = rowAssignmentIssues(p, KEYS);
    expect(issues.find(i => i.kind === 'missing')!.rows).toEqual(['WBC', 'PLT']);
    expect(issues.find(i => i.kind === 'duplicate')!.rows).toEqual(['RBC']);
  });
  it('render-side safety: a duplicate prints once (first box); an unplaced row prints in the LAST box', () => {
    const chain = [{ box: t('a', 0, ['Hb', 'RBC']) }, { box: t('b', 0, ['RBC']) }];
    const by = manualRowsByBox(chain, KEYS);
    expect([...by.get('a')!]).toEqual(['Hb', 'RBC']);
    expect([...by.get('b')!]).toEqual(['WBC', 'PLT']);
  });
});
