import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { vi } from 'vitest';
import { OutsourcedListComponent } from './outsourced-list.component';
import { OutsourcingService } from '../../../core/services/outsourcing.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { UploadsService } from '../../../core/services/uploads.service';
import { OutsourcedTube, countByStatus, filterOutsourced, partnerOptions } from './outsourced-view';

const row = (o: Partial<OutsourcedTube> = {}): OutsourcedTube => ({
  sampleId: 's1', barcode: 'OUT-0001', sampleStatus: 'dispatched', orderId: 'o1', orderNumber: 'LAB-2609-000001',
  patientId: 'p1', patientName: 'Ms. Paravai Munusamy', partnerLabId: 'a', partnerLabName: 'Apollo Diagnostics',
  createdAt: '2026-09-25T00:00:00Z', dispatchedAt: '2026-09-25T02:00:00Z', status: 'outsourced', hasReport: false,
  tests: [{ orderTestId: 't1', testId: 'x', testName: 'Vitamin D', status: 'outsourced', completed: false }],
  ...o,
});

function setup(rows: OutsourcedTube[], confirm = true) {
  const rowsSig = signal(rows);
  const status = signal<'all' | 'outsourced' | 'completed'>('all');
  const partnerId = signal<string | null>(null);
  const query = signal('');
  const svc = {
    rows: rowsSig, loading: signal(false), loadingMore: signal(false), status, partnerId, query,
    visible: computed(() => filterOutsourced(rowsSig(), { status: status(), partnerId: partnerId(), query: query() })),
    partners: computed(() => partnerOptions(rowsSig())),
    counts: computed(() => countByStatus(rowsSig())),
    // Server paging (release 2026-10-01) — overridden per-test below.
    hasMore: signal(false),
    nextCount: signal(0),
    apiBase: 'https://api.test',
    load: vi.fn(async () => {}),
    loadMore: vi.fn(async () => {}),
    upload: vi.fn(async () => '/uploads/t/p.pdf'),
    complete: vi.fn(async (): Promise<OutsourcedTube[]> => []),
    setAttachToReport: vi.fn(async (): Promise<OutsourcedTube[]> => []),
    reopen: vi.fn(async () => {}),
  };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  const dialog = {
    confirm: vi.fn(async () => confirm),
    actions: vi.fn(async (): Promise<{ action: string | null; checked: boolean }> => ({ action: 'upload', checked: true })),
  };
  TestBed.configureTestingModule({
    imports: [OutsourcedListComponent],
    providers: [
      { provide: OutsourcingService, useValue: svc },
      { provide: ToastService, useValue: toasts },
      { provide: DialogService, useValue: dialog },
    ],
  });
  const f = TestBed.createComponent(OutsourcedListComponent);
  f.detectChanges();
  return { f, c: f.componentInstance, el: f.nativeElement as HTMLElement, svc, toasts, dialog };
}

describe('Frontdesk Outsourced tab', () => {
  it('lists each outsourced tube: sample, full patient name, order, tests, partner, dispatched date, status chip', () => {
    const { el, svc } = setup([row()]);
    expect(svc.load).toHaveBeenCalled();
    const r = el.querySelector('.pf-out__row') as HTMLElement;
    expect(r.querySelector('.pf-out__sample')?.textContent).toContain('OUT-0001');
    expect(r.querySelector('.pf-out__who')?.textContent).toContain('Ms. Paravai Munusamy');
    expect(r.querySelector('.pf-out__who')?.textContent).toContain('LAB-2609-000001');
    expect(r.querySelector('.pf-out__tests')?.textContent).toContain('Vitamin D');
    expect(r.querySelector('.pf-out__partner')?.textContent).toContain('Apollo Diagnostics');
    expect(r.querySelector('.pf-out__date')?.textContent).toContain('Dispatched');
    const chip = r.querySelector('.pf-out__status') as HTMLElement;
    expect(chip.classList).toContain('nd-chip');
    expect(chip.textContent?.trim()).toBe('Outsourced');
    expect(chip.querySelector('.pf-out__check')).toBeNull();
    expect([...r.querySelectorAll('.nd-rowact')].map(b => b.textContent?.trim())).toContain('Upload report');
  });

  it('Completed = neutral chip with a violet check (no green)', () => {
    const { el } = setup([row({ status: 'completed', hasReport: true, tests: [
      { orderTestId: 't1', testId: 'x', testName: 'Vitamin D', status: 'completed', completed: true,
        report: { orderTestId: 't1', testName: 'Vitamin D', url: '/uploads/t/p.pdf' } }] })]);
    const chip = el.querySelector('.pf-out__status') as HTMLElement;
    expect(chip.textContent?.trim()).toBe('Completed');
    expect(chip.querySelector('.pf-out__check')).not.toBeNull();
    expect(chip.getAttribute('style') ?? '').not.toMatch(/green|#10b981|#22c55e/i);
    const labels = [...el.querySelectorAll('.nd-rowact')].map(b => b.textContent?.trim());
    expect(labels).toEqual(expect.arrayContaining(['View', 'Undo', 'Replace report']));
  });

  it('a partner file the server no longer has (410) is flagged on the row with "upload it again"', () => {
    const tube = () => row({ status: 'completed', hasReport: true, tests: [
      { orderTestId: 't1', testId: 'x', testName: 'Vitamin D', status: 'completed', completed: true,
        report: { orderTestId: 't1', testName: 'Vitamin D', url: '/uploads/t/p.pdf' } }] });
    expect(setup([tube()]).el.querySelector('[data-testid="out-file-missing"]')).toBeNull();

    TestBed.resetTestingModule();
    const spy = vi.spyOn(UploadsService.prototype, 'isMissing').mockImplementation(u => u === '/uploads/t/p.pdf');
    try {
      const { el } = setup([tube()]);
      expect(el.querySelector('[data-testid="out-file-missing"]')?.textContent).toContain('upload it again');
      expect([...el.querySelectorAll('.nd-rowact')].map(b => b.textContent?.trim())).toContain('Replace report');
    } finally {
      spy.mockRestore();
    }
  });

  it('upload → complete: uploads the file then marks the open lines Completed', async () => {
    const { c, svc, toasts } = setup([row()]);
    const file = new File(['%PDF'], 'vitd.pdf', { type: 'application/pdf' });
    await c.uploadAndComplete(row(), file);
    expect(svc.upload).toHaveBeenCalledWith(file);
    expect(svc.complete).toHaveBeenCalledWith(['t1'], { url: '/uploads/t/p.pdf', name: 'vitd.pdf', type: 'application/pdf' }, true);
    expect(toasts.success).toHaveBeenCalled();
  });

  it('upload asks "Attach to our report" (default ON) and passes the choice; cancel uploads nothing', async () => {
    const { c, svc, dialog } = setup([row()]);
    const file = new File(['%PDF'], 'vitd.pdf', { type: 'application/pdf' });
    const input = { files: [file], value: 'x' } as unknown as HTMLInputElement;
    c.pick(row());
    dialog.actions.mockResolvedValueOnce({ action: 'upload', checked: false });
    await c.onFile({ target: input } as unknown as Event);
    const req = dialog.actions.mock.calls[0] as unknown as [{ checkbox: { initial: boolean; label: string } }];
    expect(req[0].checkbox.initial).toBe(true);
    expect(req[0].checkbox.label).toContain('Attach to our report');
    expect(svc.complete).toHaveBeenCalledWith(['t1'], expect.objectContaining({ url: '/uploads/t/p.pdf' }), false);

    svc.upload.mockClear();
    c.pick(row());
    dialog.actions.mockResolvedValueOnce({ action: null, checked: true });
    await c.onFile({ target: { files: [file], value: 'x' } } as unknown as Event);
    expect(svc.upload).not.toHaveBeenCalled();
  });

  it('a partner file that can\'t be joined is flagged with a dialog (no window.confirm) and a chip', async () => {
    const problem = 'This PDF is password-protected, so it can’t be joined to our report. It will be sent as a separate file.';
    const locked = row({ status: 'completed', hasReport: true, tests: [
      { orderTestId: 't1', testId: 'x', testName: 'Vitamin D', status: 'completed', completed: true,
        report: { orderTestId: 't1', testName: 'Vitamin D', url: '/u/r.pdf', attachToReport: true, attachProblem: problem, inReport: false } },
    ] });
    const { c, el, svc, dialog } = setup([locked]);
    svc.complete.mockResolvedValueOnce([locked]);
    await c.uploadAndComplete(row(), new File(['%PDF'], 'v.pdf', { type: 'application/pdf' }));
    expect(dialog.actions).toHaveBeenCalledWith(expect.objectContaining({ message: problem }));
    const chip = el.querySelector('.pf-out__attach') as HTMLElement;
    expect(chip.textContent?.trim()).toBe('Separate file');
    expect(chip.getAttribute('data-attach')).toBe('problem');
  });

  it('attach / detach later from the row', async () => {
    const withReport = (attach: boolean) => row({ status: 'completed', hasReport: true, tests: [
      { orderTestId: 't1', testId: 'x', testName: 'Vitamin D', status: 'completed', completed: true,
        report: { orderTestId: 't1', testName: 'Vitamin D', url: '/u/r.pdf', attachToReport: attach, inReport: attach } },
    ] });
    const a = setup([withReport(true)]);
    expect(a.el.querySelector('.pf-out__attach')?.textContent?.trim()).toBe('In our report');
    expect(a.el.querySelector('.pf-out__attach-btn')?.textContent).toContain('Detach from report');
    await a.c.toggleAttach(withReport(true));
    expect(a.svc.setAttachToReport).toHaveBeenCalledWith(['t1'], false);
    expect(a.toasts.success).toHaveBeenCalled();
    TestBed.resetTestingModule();
    const b = setup([withReport(false)]);
    expect(b.el.querySelector('.pf-out__attach-btn')?.textContent).toContain('Attach to report');
    await b.c.toggleAttach(withReport(false));
    expect(b.svc.setAttachToReport).toHaveBeenCalledWith(['t1'], true);
  });

  it('rejects a non-PDF / non-image file before uploading', async () => {
    const { c, svc, toasts } = setup([row()]);
    await c.uploadAndComplete(row(), new File(['x'], 'x.txt', { type: 'text/plain' }));
    expect(svc.upload).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalled();
  });

  it('undo Completed asks for confirmation first (DialogService), and respects cancel', async () => {
    const done = row({ status: 'completed', hasReport: true });
    const a = setup([done], false);
    await a.c.undo(done);
    expect(a.dialog.confirm).toHaveBeenCalled();
    expect(a.svc.reopen).not.toHaveBeenCalled();
    TestBed.resetTestingModule();
    const b = setup([done], true);
    await b.c.undo(done);
    expect(b.svc.reopen).toHaveBeenCalledWith(['t1']);
  });

  it('classic design shows status + partner filters; the search narrows the list', () => {
    const { f, el, svc } = setup([row(), row({ sampleId: 's2', patientName: 'Mr. Arun Kumar', barcode: 'OUT-0002' })]);
    f.componentRef.setInput('showFilters', true);
    f.detectChanges();
    expect(el.querySelector('pf-segmented')).not.toBeNull();
    expect(el.querySelector('pf-select')).not.toBeNull();
    expect(el.querySelector('select, datalist')).toBeNull();
    svc.query.set('arun');
    f.detectChanges();
    expect(el.querySelectorAll('.pf-out__row').length).toBe(1);
  });

  it('new design: no filter bar, every status listed (open first), the header search narrows it', () => {
    const done = row({ sampleId: 's2', barcode: 'OUT-0002', patientName: 'Mr. Arun Kumar', status: 'completed', hasReport: true });
    const { f, el, svc } = setup([done, row()]);
    expect(el.querySelector('pf-segmented')).toBeNull();
    expect(el.querySelector('pf-select')).toBeNull();
    expect(el.querySelector('input[type="search"]')).toBeNull();
    const samples = [...el.querySelectorAll('.pf-out__sample')].map(n => n.textContent?.trim());
    expect(samples).toEqual(['OUT-0001', 'OUT-0002']);
    expect([...el.querySelectorAll('.pf-out__status')].map(n => n.textContent?.trim())).toEqual(['Outsourced', 'Completed']);
    svc.query.set('arun');
    f.detectChanges();
    expect(el.querySelectorAll('.pf-out__row').length).toBe(1);
  });

  it('new design pins the fetch to "all" on init — Completed tubes are never left unloaded just because there\'s no status control to pick them', () => {
    const rowsSig = signal<OutsourcedTube[]>([]);
    const status = signal<'all' | 'outsourced' | 'completed'>('outsourced'); // NOT 'all' — the server paging default
    const svc = {
      rows: rowsSig, loading: signal(false), loadingMore: signal(false), status, partnerId: signal<string | null>(null),
      query: signal(''), visible: computed(() => rowsSig()), partners: computed(() => []),
      counts: computed(() => ({ outsourced: 0, completed: 0 })), hasMore: signal(false), nextCount: signal(0),
      apiBase: 'https://api.test', load: vi.fn(async () => {}), loadMore: vi.fn(async () => {}),
      upload: vi.fn(async () => ''), complete: vi.fn(async (): Promise<OutsourcedTube[]> => []),
      setAttachToReport: vi.fn(async (): Promise<OutsourcedTube[]> => []), reopen: vi.fn(async () => {}),
    };
    TestBed.configureTestingModule({
      imports: [OutsourcedListComponent],
      providers: [
        { provide: OutsourcingService, useValue: svc },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn() } },
        { provide: DialogService, useValue: { confirm: vi.fn(), actions: vi.fn() } },
      ],
    });
    const f = TestBed.createComponent(OutsourcedListComponent);
    // showFilters defaults false (new design) — never set true, unlike the
    // classic-design test above, so ngOnInit sees the real new-design value.
    f.detectChanges();
    expect(status()).toBe('all');
    expect(svc.load).toHaveBeenCalled();
  });

  it('classic design leaves the status alone on init (its own segmented control owns it)', () => {
    const rowsSig = signal<OutsourcedTube[]>([]);
    const status = signal<'all' | 'outsourced' | 'completed'>('completed');
    const svc = {
      rows: rowsSig, loading: signal(false), loadingMore: signal(false), status, partnerId: signal<string | null>(null),
      query: signal(''), visible: computed(() => rowsSig()), partners: computed(() => []),
      counts: computed(() => ({ outsourced: 0, completed: 0 })), hasMore: signal(false), nextCount: signal(0),
      apiBase: 'https://api.test', load: vi.fn(async () => {}), loadMore: vi.fn(async () => {}),
      upload: vi.fn(async () => ''), complete: vi.fn(async (): Promise<OutsourcedTube[]> => []),
      setAttachToReport: vi.fn(async (): Promise<OutsourcedTube[]> => []), reopen: vi.fn(async () => {}),
    };
    TestBed.configureTestingModule({
      imports: [OutsourcedListComponent],
      providers: [
        { provide: OutsourcingService, useValue: svc },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn() } },
        { provide: DialogService, useValue: { confirm: vi.fn(), actions: vi.fn() } },
      ],
    });
    const f = TestBed.createComponent(OutsourcedListComponent);
    f.componentRef.setInput('showFilters', true); // bound from the start, like the real template
    f.detectChanges();
    expect(status()).toBe('completed'); // untouched
  });

  it('no more pages: no "Load more" button', () => {
    const { el } = setup([row()]);
    expect(el.querySelector('.pf-out__more')).toBeNull();
  });

  it('server paging: "Load more" appears with the next page\'s count and calls svc.loadMore()', () => {
    const { f, el, svc } = setup([row()]);
    (svc.hasMore as ReturnType<typeof signal<boolean>>).set(true);
    (svc.nextCount as ReturnType<typeof signal<number>>).set(23);
    f.detectChanges();
    const btn = el.querySelector('.pf-out__more-btn') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent?.trim()).toBe('Load 23 more');
    expect(btn.disabled).toBe(false);
    btn.click();
    expect(svc.loadMore).toHaveBeenCalled();
  });

  it('"Load more" shows a busy state and disables while loadingMore', () => {
    const { f, el, svc } = setup([row()]);
    (svc.hasMore as ReturnType<typeof signal<boolean>>).set(true);
    (svc.loadingMore as ReturnType<typeof signal<boolean>>).set(true);
    f.detectChanges();
    const btn = el.querySelector('.pf-out__more-btn') as HTMLButtonElement;
    expect(btn.textContent?.trim()).toBe('Loading…');
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
  });
});
