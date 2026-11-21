import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { CriticalResultsComponent, istStamp, searchEvents } from './critical-results.component';
import { CriticalResultsService } from '../../../core/services/critical-results.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { AuthService } from '../../../core/auth/auth.service';
import { CriticalRegisterFilter, CriticalResultEvent } from '../../../shared/models/critical-result.model';
import { sortsAndFilters } from '../../../shared/utils/work-grid';
import { labDaysAgo, labToday } from '../../../shared/utils/lab-clock';
import { BusyDirective } from '../../../shared/directives/busy.directive';

/**
 * /lab/critical-results — the NABL register on the ND pattern: band (search
 * pill; quiet Refresh + Export CSV, NO primary), FILTERS companion on the
 * LEFT (status radiogroup, IST range with quick picks, branch pf-select only
 * for multi-branch users), the register grid as the MAIN card with the count
 * in its header. Filters reload from the server (status / from / to /
 * branch); the search narrows the loaded page; Acknowledge posts via
 * 'register'; Export downloads the server's CSV for the same filter.
 * Child components (AG-Grid, band, date, select) are unknown elements here.
 */
const ev = (over: Partial<CriticalResultEvent> = {}): CriticalResultEvent => ({
  id: 'e1', status: 'open', source: 'live', orderTestId: 'ot1', orderId: 'o1', orderNumber: 'LAB-2609-000123', resultVersion: 1,
  patientId: 'p1', patientName: 'Ms. Paravai Munusamy Ramalingam', patientMrn: 'AA0007', testId: 't1', testName: 'Potassium',
  summary: 'Potassium 7.2 mmol/L CH', values: [], detectedAt: '2026-09-29T06:00:00Z', alertedCount: 3, acknowledgements: [], ...over,
});
const ROWS = [ev(), ev({ id: 'e2', patientName: 'Mr. Arun Kumar', patientMrn: 'AA0008', testName: 'Haemoglobin', summary: 'Hb 3.1 g/dL CL', status: 'acknowledged',
  acknowledgedByName: 'Dr A', acknowledgedAt: '2026-09-29T06:05:00Z', acknowledgements: [{ userId: 'u2', name: 'Dr A', at: '2026-09-29T06:05:00Z', via: 'bell' }] })];

describe('CriticalResultsComponent (register)', () => {
  let svc: { list: ReturnType<typeof vi.fn>; acknowledge: ReturnType<typeof vi.fn>; exportCsv: ReturnType<typeof vi.fn> };

  function render(opts: { branches?: Array<{ id: string; name: string }>; narrow?: boolean; perms?: boolean } = {}) {
    (window as any).matchMedia = (q: string) => ({
      matches: q.includes('900px') ? !!opts.narrow : false,
      addEventListener() {}, removeEventListener() {},
    });
    svc = {
      list: vi.fn((f: CriticalRegisterFilter) => of({ items: f.status === 'all' ? ROWS : ROWS.filter(r => r.status === f.status), total: 2, page: 1, pageSize: 200, openCount: 1 })),
      acknowledge: vi.fn((id: string) => of(ev({ id, status: 'acknowledged', acknowledgedByName: 'Me', acknowledgements: [{ userId: 'me', name: 'Me', at: '2026-09-29T07:00:00Z', via: 'register' }] }))),
      exportCsv: vi.fn(() => of(new Blob(['a,b'], { type: 'text/csv' }))),
    };
    TestBed.configureTestingModule({
      imports: [CriticalResultsComponent],
      providers: [
        { provide: CriticalResultsService, useValue: svc },
        { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => true } },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
        { provide: AuthService, useValue: {
          user: () => ({ id: 'me', branches: opts.branches ?? [{ id: 'b1', name: 'Salem' }] }),
          hasAnyPermission: () => opts.perms !== false, hasPermission: () => opts.perms !== false,
        } },
      ],
    });
    TestBed.overrideComponent(CriticalResultsComponent, { set: { imports: [NgTemplateOutlet, BusyDirective], schemas: [CUSTOM_ELEMENTS_SCHEMA] } });
    const f = TestBed.createComponent(CriticalResultsComponent);
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance as any };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('opens on the last 30 IST days of unacknowledged records, filters LEFT, grid MAIN, count in the header, no primary', () => {
    const { el, c } = render();
    expect(svc.list).toHaveBeenCalledWith({ status: 'open', from: labDaysAgo(30), to: labToday(), branchId: null, page: 1, pageSize: 200 });
    const panels = el.querySelector('.pf-cr__panels')!;
    expect(panels.children[0].classList.contains('pf-cr__side')).toBe(true);
    expect(panels.children[1].classList.contains('pf-cr__main')).toBe(true);
    expect(el.querySelector('.pf-cr__main ag-grid-angular')).not.toBeNull();
    expect(el.querySelector('.pf-cr__count')?.textContent).toContain('1 record');
    expect(el.querySelector('.pf-cr__count')?.textContent).toContain('1 not acknowledged');
    expect(el.querySelectorAll('.pf-btn--primary, .pf-hb-btn--primary').length).toBe(0);
    // Kit filters: a radiogroup for the status, another for the quick range, two kit dates, no native controls.
    expect(el.querySelectorAll('.pf-cr__side [role="radiogroup"]').length).toBe(2);
    expect(el.querySelectorAll('.pf-cr__side pf-date').length).toBe(2);
    expect(el.querySelectorAll('select, datalist, input[type="date"]').length).toBe(0);
    // Single branch → no branch filter.
    expect(el.querySelector('#pf-cr-branch')).toBeNull();
    expect(c.rows().length).toBe(1);
  });

  it('status / quick range / branch reload from the server; the search narrows the loaded rows', () => {
    const { f, el, c } = render({ branches: [{ id: 'b1', name: 'Salem' }, { id: 'b2', name: 'Trichy' }] });
    expect(el.querySelector('#pf-cr-branch')).not.toBeNull();
    svc.list.mockClear();

    const all = [...el.querySelectorAll('.pf-cr__side [role="radio"]')].find(b => b.textContent?.trim() === 'All') as HTMLButtonElement;
    all.click();
    f.detectChanges();
    expect(svc.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'all' }));
    expect(c.rows().length).toBe(2);
    expect(all.getAttribute('aria-checked')).toBe('true');

    const today = [...el.querySelectorAll('.pf-cr__side [role="radio"]')].find(b => b.textContent?.trim() === 'Today') as HTMLButtonElement;
    today.click();
    f.detectChanges();
    expect(svc.list).toHaveBeenLastCalledWith(expect.objectContaining({ from: labToday(), to: labToday() }));

    c.setBranch('b2');
    f.detectChanges();
    expect(svc.list).toHaveBeenLastCalledWith(expect.objectContaining({ branchId: 'b2' }));

    c.q.set('arun');
    f.detectChanges();
    expect(c.visibleRows().map((r: CriticalResultEvent) => r.id)).toEqual(['e2']);
    expect(searchEvents(ROWS, 'AA0007').map(r => r.id)).toEqual(['e1']);
    expect(searchEvents(ROWS, 'potassium').map(r => r.id)).toEqual(['e1']);
  });

  it('a typed custom date switches the quick pick to Custom and reloads', () => {
    const { f, c } = render();
    svc.list.mockClear();
    // Never a literal date: on 1 Oct the literal '2026-09-01' WAS the default
    // 30-day From (labDaysAgo(30)), so "typing" it changed nothing (test-clock bug).
    const typed = labDaysAgo(45);
    c.setFrom(typed);
    f.detectChanges();
    expect(c.quick()).toBe('custom');
    expect(svc.list).toHaveBeenLastCalledWith(expect.objectContaining({ from: typed, to: labToday() }));
  });

  it('Acknowledge from a row posts via "register", updates the row and the open count', () => {
    const { f, c } = render();
    c.acknowledge(c.rows()[0]);
    f.detectChanges();
    expect(svc.acknowledge).toHaveBeenCalledWith('e1', 'register');
    expect(c.rows()[0].status).toBe('acknowledged');
    expect(c.openCount()).toBe(0);
    // The grid's action cell: a click on [data-act] resolves to the row action.
    const btn = document.createElement('button');
    btn.dataset['act'] = 'comm';
    c.onCellClicked({ event: { target: btn }, data: c.rows()[0] });
    expect(c.dialogFor()?.id).toBe('e1');
  });

  it('every data column sorts and filters; the actions column is exempt', () => {
    const { c } = render();
    for (const col of c.colDefs() as Array<{ colId?: string; sortable?: boolean; filter?: unknown }>) {
      if (col.colId === 'actions') expect([col.sortable, col.filter]).toEqual([false, false]);
      else expect(sortsAndFilters(col as never), String(col.colId)).toBe(true);
    }
  });

  it('row actions need the result permissions; the register itself still reads', () => {
    const { c } = render({ perms: false });
    expect(c.colDefs().some((col: { colId?: string }) => col.colId === 'actions')).toBe(false);
    expect(c.rows().length).toBe(1);
  });

  it('Export CSV asks the server for the same filter (no page) and downloads it', () => {
    const { f, el } = render();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    (globalThis as any).URL.createObjectURL ??= () => 'blob:x';
    (globalThis as any).URL.revokeObjectURL ??= () => undefined;
    (el.querySelector('.pf-cr__export') as HTMLButtonElement).click();
    f.detectChanges();
    expect(svc.exportCsv).toHaveBeenCalledWith({ status: 'open', from: labDaysAgo(30), to: labToday(), branchId: null, page: 1, pageSize: 200 });
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('narrow widths: the filters become a sheet opened from the band', () => {
    const { f, el } = render({ narrow: true });
    expect(el.querySelector('.pf-cr__side')).toBeNull();
    const open = [...el.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Filters') as HTMLButtonElement;
    open.click();
    f.detectChanges();
    const sheet = el.querySelector('.pf-cr__side--sheet');
    expect(sheet?.getAttribute('role')).toBe('dialog');
    expect(sheet?.querySelectorAll('[role="radiogroup"]').length).toBe(2);
  });

  it('stamps times in the lab day (IST), never the device zone', () => {
    expect(istStamp('2026-09-29T06:00:00Z')).toBe('29 Sep, 11:30 AM');
    expect(istStamp(null)).toBe('');
  });
});

describe('CriticalResultsComponent — loading feedback', () => {
  it('Acknowledge from a row: the pressed button is busy at once and a second press sends nothing', async () => {
    const { Subject } = await import('rxjs');
    const res$ = new Subject<CriticalResultEvent>();
    const c: any = Object.create(CriticalResultsComponent.prototype);
    c.acking = new Set<string>();
    c.svc = { acknowledge: vi.fn(() => res$) };
    c.toasts = { success: vi.fn(), error: vi.fn() };
    c.replace = vi.fn();
    const btn = document.createElement('button');
    const e = { id: 'e9' } as CriticalResultEvent;
    c.acknowledge(e, btn);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.hasAttribute('disabled')).toBe(true);
    c.acknowledge(e, btn);
    expect(c.svc.acknowledge).toHaveBeenCalledTimes(1);
    res$.error(new Error('offline'));
    expect(btn.getAttribute('aria-busy')).toBeNull();
    expect(btn.hasAttribute('disabled')).toBe(false);
  });
});
