import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { OutsourcedActionsComponent, outsourcedCompactActs } from './outsourced-actions.component';
import { OutsourcingService } from '../../../core/services/outsourcing.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { UploadsService } from '../../../core/services/uploads.service';
import { OutsourcedTube } from './outsourced-view';

/**
 * ONE home for the outsourced tube's actions (owner, 2026-10-01: moved out
 * of OutsourcedListComponent so the frontdesk merged list can show the SAME
 * buttons inline, never a duplicate implementation). These specs pin the
 * extracted component's own behaviour directly; outsourced-list.component.spec.ts
 * keeps the list-level rendering / filter / paging checks.
 */
const row = (o: Partial<OutsourcedTube> = {}): OutsourcedTube => ({
  sampleId: 's1', barcode: 'OUT-0001', sampleStatus: 'dispatched', orderId: 'o1', orderNumber: 'LAB-2609-000001',
  patientId: 'p1', patientName: 'Ms. Paravai Munusamy', partnerLabId: 'a', partnerLabName: 'Apollo Diagnostics',
  createdAt: '2026-09-25T00:00:00Z', dispatchedAt: '2026-09-25T02:00:00Z', status: 'outsourced', hasReport: false,
  tests: [{ orderTestId: 't1', testId: 'x', testName: 'Vitamin D', status: 'outsourced', completed: false }],
  ...o,
});

function setup(tube: OutsourcedTube, confirm = true, compact = false) {
  const svc = {
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
  const uploads = { open: vi.fn(), isMissing: vi.fn(() => false) };
  TestBed.configureTestingModule({
    imports: [OutsourcedActionsComponent],
    providers: [
      { provide: OutsourcingService, useValue: svc },
      { provide: ToastService, useValue: toasts },
      { provide: DialogService, useValue: dialog },
      { provide: UploadsService, useValue: uploads },
    ],
  });
  const f = TestBed.createComponent(OutsourcedActionsComponent);
  f.componentRef.setInput('tube', tube);
  if (compact) f.componentRef.setInput('compact', true);
  f.detectChanges();
  return { f, c: f.componentInstance, el: f.nativeElement as HTMLElement, svc, toasts, dialog, uploads };
}

describe('OutsourcedActionsComponent — row actions (shared by the list and the merged work list)', () => {
  it('outsourced, no report: only Upload report', () => {
    const { el } = setup(row());
    const labels = [...el.querySelectorAll('.pf-rowact')].map(b => b.textContent?.trim());
    expect(labels).toEqual(['Upload report']);
  });

  it('completed, has report: View · Undo · Replace report (no Mark completed)', () => {
    const done = row({ status: 'completed', hasReport: true, tests: [
      { orderTestId: 't1', testId: 'x', testName: 'Vitamin D', status: 'completed', completed: true,
        report: { orderTestId: 't1', testName: 'Vitamin D', url: '/uploads/t/p.pdf' } }] });
    const { el } = setup(done);
    const labels = [...el.querySelectorAll('.pf-rowact')].map(b => b.textContent?.trim());
    expect(labels).toEqual(expect.arrayContaining(['View', 'Undo', 'Replace report']));
    expect(labels).not.toContain('Mark completed');
  });

  it('outsourced with a report already attached (not yet marked complete): Mark completed offered', () => {
    const withReport = row({ hasReport: true, tests: [
      { orderTestId: 't1', testId: 'x', testName: 'Vitamin D', status: 'outsourced', completed: false,
        report: { orderTestId: 't1', testName: 'Vitamin D', url: '/u/r.pdf' } }] });
    const { el } = setup(withReport);
    const labels = [...el.querySelectorAll('.pf-rowact')].map(b => b.textContent?.trim());
    expect(labels).toEqual(expect.arrayContaining(['Mark completed', 'Replace report']));
  });

  it('upload → complete: uploads the file then marks the open lines Completed', async () => {
    const { c, svc, toasts } = setup(row());
    const file = new File(['%PDF'], 'vitd.pdf', { type: 'application/pdf' });
    await (c as unknown as { uploadAndComplete(f: File, attach?: boolean): Promise<void> }).uploadAndComplete(file);
    expect(svc.upload).toHaveBeenCalledWith(file);
    expect(svc.complete).toHaveBeenCalledWith(['t1'], { url: '/uploads/t/p.pdf', name: 'vitd.pdf', type: 'application/pdf' }, true);
    expect(toasts.success).toHaveBeenCalled();
  });

  it('upload asks "Attach to our report" (default ON) and passes the choice; cancel uploads nothing', async () => {
    const { c, svc, dialog } = setup(row());
    const file = new File(['%PDF'], 'vitd.pdf', { type: 'application/pdf' });
    c.pick();
    dialog.actions.mockResolvedValueOnce({ action: 'upload', checked: false });
    await c.onFile({ target: { files: [file], value: 'x' } } as unknown as Event);
    const req = dialog.actions.mock.calls[0] as unknown as [{ checkbox: { initial: boolean; label: string } }];
    expect(req[0].checkbox.initial).toBe(true);
    expect(req[0].checkbox.label).toContain('Attach to our report');
    expect(svc.complete).toHaveBeenCalledWith(['t1'], expect.objectContaining({ url: '/uploads/t/p.pdf' }), false);

    svc.upload.mockClear();
    dialog.actions.mockResolvedValueOnce({ action: null, checked: true });
    await c.onFile({ target: { files: [file], value: 'x' } } as unknown as Event);
    expect(svc.upload).not.toHaveBeenCalled();
  });

  it('a partner file that can\'t be joined is flagged with a dialog (no window.confirm)', async () => {
    const problem = 'This PDF is password-protected, so it can’t be joined to our report. It will be sent as a separate file.';
    const locked = row({ status: 'completed', hasReport: true, tests: [
      { orderTestId: 't1', testId: 'x', testName: 'Vitamin D', status: 'completed', completed: true,
        report: { orderTestId: 't1', testName: 'Vitamin D', url: '/u/r.pdf', attachToReport: true, attachProblem: problem, inReport: false } },
    ] });
    const { c, svc, dialog } = setup(row());
    svc.complete.mockResolvedValueOnce([locked]);
    await (c as unknown as { uploadAndComplete(f: File, attach?: boolean): Promise<void> })
      .uploadAndComplete(new File(['%PDF'], 'v.pdf', { type: 'application/pdf' }));
    expect(dialog.actions).toHaveBeenCalledWith(expect.objectContaining({ message: problem }));
  });

  it('attach / detach later, from the row', async () => {
    const withReport = (attach: boolean) => row({ status: 'completed', hasReport: true, tests: [
      { orderTestId: 't1', testId: 'x', testName: 'Vitamin D', status: 'completed', completed: true,
        report: { orderTestId: 't1', testName: 'Vitamin D', url: '/u/r.pdf', attachToReport: attach, inReport: attach } },
    ] });
    const a = setup(withReport(true));
    expect(a.el.textContent).toContain('Detach from report');
    await a.c.toggleAttach();
    expect(a.svc.setAttachToReport).toHaveBeenCalledWith(['t1'], false);
    expect(a.toasts.success).toHaveBeenCalled();

    TestBed.resetTestingModule();
    const b = setup(withReport(false));
    expect(b.el.textContent).toContain('Attach to report');
    await b.c.toggleAttach();
    expect(b.svc.setAttachToReport).toHaveBeenCalledWith(['t1'], true);
  });

  it('rejects a non-PDF / non-image file before uploading', async () => {
    const { c, svc, toasts } = setup(row());
    const file = new File(['x'], 'x.txt', { type: 'text/plain' });
    await c.onFile({ target: { files: [file], value: 'x' } } as unknown as Event);
    expect(svc.upload).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalled();
  });

  it('undo Completed asks for confirmation first (DialogService), and respects cancel', async () => {
    const done = row({ status: 'completed', hasReport: true });
    const a = setup(done, false);
    await a.c.undo();
    expect(a.dialog.confirm).toHaveBeenCalled();
    expect(a.svc.reopen).not.toHaveBeenCalled();

    TestBed.resetTestingModule();
    const b = setup(done, true);
    await b.c.undo();
    expect(b.svc.reopen).toHaveBeenCalledWith(['t1']);
  });

  it('view() opens the partner file through UploadsService (a signed URL, never a bare link)', () => {
    const { c, uploads } = setup(row({ hasReport: true, tests: [
      { orderTestId: 't1', testId: 'x', testName: 'Vitamin D', status: 'outsourced', completed: false,
        report: { orderTestId: 't1', testName: 'Vitamin D', url: '/u/r.pdf' } }] }));
    c.view('/u/r.pdf');
    expect(uploads.open).toHaveBeenCalledWith('/u/r.pdf');
  });
});

/** Owner 2026-11-21 (phone, 390px): a completed row's View · Detach · Undo · Replace squeezed the patient name to one
 *  letter wide — the phone list shows ONE primary (the tube's next step) + ⋯ with the rest. */
describe('OutsourcedActionsComponent — compact (phone list)', () => {
  const rep = { orderTestId: 't1', testName: 'Vitamin D', url: '/u/r.pdf', attachToReport: true };
  const done = row({ status: 'completed', hasReport: true, tests: [{ orderTestId: 't1', testId: 'x', testName: 'Vitamin D', status: 'completed', completed: true, report: rep }] });
  const waiting = row({ hasReport: true, tests: [{ orderTestId: 't1', testId: 'x', testName: 'Vitamin D', status: 'outsourced', completed: false, report: rep }] });

  it('picks the next step as the primary and keeps every other action in the menu', () => {
    expect(outsourcedCompactActs(row())).toEqual({ primary: 'upload', more: [] });
    const d = outsourcedCompactActs(done);
    expect(d.primary).toBe('view');
    expect(d.more.map(a => a.id)).toEqual(['attach', 'undo', 'upload']);
    expect(d.more.map(a => a.label)).toEqual(['Detach from report', 'Undo completed', 'Replace report']);
    const w = outsourcedCompactActs(waiting);
    expect(w.primary).toBe('complete');
    expect(w.more.map(a => a.id)).toEqual(['view', 'attach', 'upload']);
  });

  it('renders one primary + the ⋯ trigger, never the full button row', () => {
    const { el } = setup(done, true, true);
    const buttons = [...el.querySelectorAll('button')];
    expect(el.querySelector('[data-testid="out-act-primary"]')?.textContent?.trim()).toBe('View');
    expect(buttons.length).toBe(2);
    expect(el.querySelectorAll('.pf-rowact__t').length).toBe(0);
  });

  it('run() reaches the same handlers as the full row', async () => {
    const { c, svc, uploads } = setup(done, true, true);
    c.run('view');
    expect(uploads.open).toHaveBeenCalledWith('/u/r.pdf');
    c.run('attach');
    await new Promise(r => setTimeout(r, 0));
    expect(svc.setAttachToReport).toHaveBeenCalledWith(['t1'], false);
  });
});
