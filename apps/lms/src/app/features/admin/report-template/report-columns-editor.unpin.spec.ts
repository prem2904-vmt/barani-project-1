import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { of } from 'rxjs';
import { ReportColumnsEditorComponent } from './report-columns-editor.component';
import { ApiService } from '../../../core/services/api.service';
import { ReportLayoutService } from '../../../core/services/report-layout.service';
import { ToastService } from '../../../core/services/toast.service';
import type { ReportColumn } from '../../../shared/models/report-layout.model';

/**
 * Owner regression 2026-09-27: unpinning Result from Unit in Admin → Reports
 * (and the test editor's "Change the columns") must STAY unpinned — after
 * Save and a reload the editor shows two separate columns, and the host
 * (preview / per-test override save) receives the unpinned set.
 */
const col = (name: string, type: string, order: number, extra: Partial<ReportColumn> = {}) =>
  ({ id: 'c-' + name, name, label: name, order, width: 25, type, locked: false, ...extra }) as ReportColumn;
const LEGACY = [col('name', 'name', 1), col('result', 'result', 2), col('unit', 'unit', 3), col('range', 'range', 4)];

const resultLink = (cols: ReportColumn[]) => cols.find(c => c.type === 'result')?.linkedNext;

function makeDept() {
  let stored: ReportColumn[] = LEGACY;
  const layout = {
    getDeptColumns: vi.fn(async () => ({ departmentId: 'd1', columns: JSON.parse(JSON.stringify(stored)), configured: true })),
    saveDeptColumns: vi.fn(async (_id: string, cols: ReportColumn[]) => { stored = JSON.parse(JSON.stringify(cols)); return {}; }),
    getDeptSignatories: vi.fn(async () => []),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: { get: vi.fn(() => of([])) } },
      { provide: ReportLayoutService, useValue: layout },
      { provide: ToastService, useValue: { error: vi.fn(), success: vi.fn() } },
    ],
  });
  const c = TestBed.createComponent(ReportColumnsEditorComponent).componentInstance as any;
  c.loadSignatories = () => undefined;
  return { c, layout, stored: () => stored };
}

async function load(c: any) {
  c.selectDepartment('d1');
  await new Promise(r => setTimeout(r));
}

describe('Report columns editor — Result / Unit pin', () => {
  it('a legacy department opens with Result pinned to Unit (the default merge)', async () => {
    const { c } = makeDept();
    await load(c);
    expect(resultLink(c.columns())).toBe(true);
  });

  it('unpin → Save → reload keeps Result and Unit as separate columns', async () => {
    const { c, layout, stored } = makeDept();
    await load(c);
    const ri = c.columns().findIndex((x: ReportColumn) => x.type === 'result');
    c.toggleLinkAt(ri);
    expect(resultLink(c.columns())).toBe(false);
    await c.save();
    expect(layout.saveDeptColumns).toHaveBeenCalled();
    expect(resultLink(stored())).toBe(false);

    await load(c); // reload the department
    expect(resultLink(c.columns())).toBe(false);
    expect(c.columns().some((x: ReportColumn) => x.linkedNext)).toBe(false);
  });

  it('re-pin → Save → reload merges them again', async () => {
    const { c, stored } = makeDept();
    await load(c);
    const ri = c.columns().findIndex((x: ReportColumn) => x.type === 'result');
    c.toggleLinkAt(ri);
    await c.save();
    await load(c);
    c.toggleLinkAt(ri);
    await c.save();
    expect(resultLink(stored())).toBe(true);
    await load(c);
    expect(resultLink(c.columns())).toBe(true);
  });

  it('per-test override (host-managed): an unpinned seed stays unpinned in the emitted state', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: { get: vi.fn(() => of([])) } },
        { provide: ReportLayoutService, useValue: {} },
        { provide: ToastService, useValue: { error: vi.fn(), success: vi.fn() } },
      ],
    });
    const f = TestBed.createComponent(ReportColumnsEditorComponent);
    const emitted: any[] = [];
    f.componentInstance.stateChange.subscribe(s => emitted.push(s));
    f.componentRef.setInput('hostManaged', true);
    f.componentRef.setInput('initialColumns', LEGACY.map(x => (x.type === 'result' ? { ...x, linkedNext: false } : x)));
    f.detectChanges();
    const c = f.componentInstance as any;
    expect(resultLink(c.columns())).toBe(false);
    expect(resultLink(emitted[emitted.length - 1].columns)).toBe(false);
  });
});
