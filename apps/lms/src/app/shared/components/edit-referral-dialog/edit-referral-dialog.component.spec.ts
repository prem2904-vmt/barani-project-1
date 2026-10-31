import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { EditReferralDialogComponent } from './edit-referral-dialog.component';
import { ReferralSaveResult } from './referral-edit';
import { ApiService } from '../../../core/services/api.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';

/**
 * Edit referral: loads the order's referral, uses pf-selects (never native
 * controls), Save stays off until something changed, a released report asks
 * once (DialogService) and the PATCH carries the new doctor / hospital /
 * source + reason. The server's answer reaches the host.
 */
@Component({
  standalone: true,
  imports: [EditReferralDialogComponent],
  template: `@if (open()) { <pf-edit-referral-dialog orderId="o1" (closed)="closed = true" (saved)="saved = $event"></pf-edit-referral-dialog> }`,
})
class HostComponent {
  open = signal(true);
  closed = false;
  saved: ReferralSaveResult | null = null;
}

const REF = {
  orderId: 'o1', orderNumber: 'LAB-2610-000042', patientName: 'Ms. Priya Raman', status: 'validated',
  refDoctorId: null as string | null, refDoctorName: 'Dr Old' as string | null, refHospitalName: 'City Hospital' as string | null, referralSourceType: null as string | null,
  sourceTypes: ['Doctor', 'Hospital', 'Walk-in', 'Corporate', 'Camp', 'Online'],
  releasedReportId: null as string | null, releasedReportDelivered: false,
};

describe('EditReferralDialogComponent', () => {
  let api: { get: ReturnType<typeof vi.fn>; patch: ReturnType<typeof vi.fn> };
  let dialog: { confirm: ReturnType<typeof vi.fn> };
  let toasts: Record<'success' | 'error' | 'info' | 'warning', ReturnType<typeof vi.fn>>;

  function render(ref: Partial<typeof REF> = {}) {
    const data = { ...REF, ...ref };
    api = {
      get: vi.fn((url: string) => {
        if (url === '/api/orders/o1/referral') return of(data);
        if (url.startsWith('/api/test-picker/doctors/options')) return of([{ doctorId: 'd7', name: 'Dr New', hospitalName: 'Apollo' }]);
        if (url.startsWith('/api/test-picker/hospitals')) return of(['City Hospital', 'Apollo']);
        return of(null);
      }),
      patch: vi.fn(() => of({ changed: true, reportAmended: !!data.releasedReportId, amendedReportId: data.releasedReportId ? 'r2' : null, order: { id: 'o1' } })),
    };
    dialog = { confirm: vi.fn(async () => true) };
    toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: DialogService, useValue: dialog },
        { provide: ToastService, useValue: toasts },
      ],
    });
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    const dlg = document.body.querySelector('.pf-erd') as HTMLElement;
    return { f, dlg, host: f.componentInstance };
  }
  const component = (f: ReturnType<typeof render>['f']) =>
    f.debugElement.query(d => d.componentInstance instanceof EditReferralDialogComponent).componentInstance as EditReferralDialogComponent;

  afterEach(() => { TestBed.resetTestingModule(); document.body.querySelectorAll('.pf-erd').forEach(n => n.remove()); });

  it('loads the booked referral, uses pf-selects only and shows one primary', () => {
    const { dlg } = render();
    expect(api.get).toHaveBeenCalledWith('/api/orders/o1/referral');
    expect(dlg.getAttribute('role')).toBe('dialog');
    expect(dlg.querySelectorAll('select, datalist').length).toBe(0);
    expect(dlg.querySelectorAll('pf-select').length).toBe(3);
    expect(dlg.textContent).toContain('Ms. Priya Raman');
    expect(dlg.textContent).toContain('LAB-2610-000042');
    expect(dlg.textContent).toContain('Dr Old · City Hospital');
    expect(dlg.querySelectorAll('.pf-btn--primary').length).toBe(1);
    expect(dlg.querySelector('.pf-erd__note')).toBeNull();          // nothing released yet
    expect(dlg.textContent).not.toMatch(/\bAI\b/);
  });

  it('Save stays off until something changes; a typed new doctor saves with reason, no confirm before release', async () => {
    const { f, dlg, host } = render();
    const save = dlg.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    const c = component(f);
    c.pickDoctor('Dr Typed New');
    const reason = dlg.querySelector('#pf-erd-reason') as HTMLInputElement;
    reason.value = 'Wrong doctor at booking';
    reason.dispatchEvent(new Event('input'));
    f.detectChanges();
    expect(save.disabled).toBe(false);
    await c.save();
    expect(dialog.confirm).not.toHaveBeenCalled();
    expect(api.patch).toHaveBeenCalledWith('/api/orders/o1/referral', {
      refDoctorId: null, refDoctorName: 'Dr Typed New', refHospitalName: 'City Hospital',
      referralSourceType: '', reason: 'Wrong doctor at booking',
    });
    expect(host.saved?.changed).toBe(true);
    expect(toasts.success).toHaveBeenCalledWith('Referral updated');
  });

  it('picking a directory doctor sends its id; its hospital fills an empty hospital', async () => {
    const { f } = render({ refHospitalName: null });
    const c = component(f);
    const opt = c.doctorOpts().find(o => o.label === 'Dr New · Apollo')!;
    c.pickDoctor(opt.value);
    expect(c.form()).toMatchObject({ doctorId: 'd7', doctor: 'Dr New', hospital: 'Apollo' });
    await c.save();
    expect(api.patch.mock.calls[0][1]).toMatchObject({ refDoctorId: 'd7', refDoctorName: 'Dr New', refHospitalName: 'Apollo' });
  });

  it('released report: the note shows, saving asks once, and the amended report reaches the host', async () => {
    const { f, dlg, host } = render({ releasedReportId: 'r1', releasedReportDelivered: true });
    f.detectChanges();
    expect(dlg.querySelector('.pf-erd__note')?.textContent).toContain('amended report');
    expect(dlg.querySelector('.pf-erd__note')?.textContent).toContain('already has the old copy');
    const c = component(f);
    c.pickDoctor('Dr Corrected');
    await c.save();
    expect(dialog.confirm).toHaveBeenCalledTimes(1);
    expect(dialog.confirm.mock.calls[0][0].title).toBe('Issue an amended report?');
    expect(host.saved).toMatchObject({ reportAmended: true, amendedReportId: 'r2' });
    expect(toasts.success).toHaveBeenCalledWith('Referral updated · amended report issued');
  });

  it('steps aside (hidden) while the DialogService confirm is open, and comes back after', async () => {
    const { f, dlg } = render({ releasedReportId: 'r1' });
    const c = component(f);
    let answer!: (v: boolean) => void;
    dialog.confirm.mockImplementationOnce(() => new Promise<boolean>(r => (answer = r)));
    c.pickDoctor('Dr Other');
    const pending = c.save();
    f.detectChanges();
    expect(dlg.classList).toContain('pf-erd--behind');
    answer(false);
    await pending;
    f.detectChanges();
    expect(dlg.classList).not.toContain('pf-erd--behind');
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('released report, declined confirm ⇒ nothing is sent; a source-only change never asks', async () => {
    const { f } = render({ releasedReportId: 'r1' });
    const c = component(f);
    dialog.confirm.mockResolvedValueOnce(false);
    c.pickDoctor('Dr Other');
    await c.save();
    expect(api.patch).not.toHaveBeenCalled();
    c.pickDoctor('Dr Old');
    c.patch({ sourceType: 'Doctor' });
    await c.save();
    expect(dialog.confirm).toHaveBeenCalledTimes(1);
    expect(api.patch).toHaveBeenCalledTimes(1);
  });

  it('a refused save shows the server message inline; Cancel closes without saving', async () => {
    const { f, dlg, host } = render();
    const c = component(f);
    api.patch.mockReturnValueOnce(throwError(() => ({ message: 'Cannot edit the referral on a cancelled order.' })));
    c.pickDoctor('Dr Late');
    await c.save();
    f.detectChanges();
    expect(dlg.querySelector('[role="alert"]')?.textContent).toContain('cancelled order');
    (dlg.querySelector('.pf-erd__foot .pf-btn--secondary') as HTMLButtonElement).click();
    expect(host.closed).toBe(true);
  });

  it('typing in the doctor search asks the server (debounced) with the chosen hospital', async () => {
    vi.useFakeTimers();
    try {
      const { f } = render();
      const c = component(f);
      api.get.mockClear();
      c.searchDoctors('Kum');
      vi.advanceTimersByTime(250);
      expect(api.get).toHaveBeenCalledWith('/api/test-picker/doctors/options?q=Kum&hospital=City+Hospital');
    } finally { vi.useRealTimers(); }
  });
  const escape = (target: EventTarget = document.body) => {
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    target.dispatchEvent(ev);
    return ev;
  };

  it('Escape closes the dialog when nothing else wants it', () => {
    const { host } = render();
    escape();
    expect(host.closed).toBe(true);
  });

  it('while saving: backdrop click, X, Cancel and Escape do not close the dialog', async () => {
    const { f, dlg, host } = render();
    const c = component(f);
    const pending = new Subject<unknown>();
    api.patch.mockReturnValueOnce(pending);
    c.pickDoctor('Dr Late');
    const done = c.save();
    f.detectChanges();
    expect(c.saving()).toBe(true);

    (dlg.querySelector('.pf-erd__backdrop') as HTMLElement).click();
    (dlg.querySelector('.pf-erd__close') as HTMLElement).click();
    escape();
    expect(host.closed).toBe(false);

    pending.next({ changed: true, reportAmended: false, order: { id: 'o1' } });
    pending.complete();
    await done;
    expect(host.saved?.changed).toBe(true);
    // Saved: the dialog may be dismissed again.
    (dlg.querySelector('.pf-erd__backdrop') as HTMLElement).click();
    expect(host.closed).toBe(true);
  });

  it('Escape that closes an open pf-select panel does not also close the dialog', () => {
    const { f, dlg, host } = render();
    f.detectChanges();
    (dlg.querySelector('#pf-erd-doctor button, #pf-erd-doctor .pf-dd__trigger') as HTMLElement).click();
    f.detectChanges();
    const input = document.body.querySelector('input.pf-dd__combox') as HTMLInputElement;
    expect(input).not.toBeNull();
    const ev = escape(input);
    expect(ev.defaultPrevented).toBe(true);           // the select consumed it
    expect(host.closed).toBe(false);
    f.detectChanges();
    expect(document.body.querySelector('input.pf-dd__combox')).toBeNull();   // panel closed
    escape();                                          // a second Escape (panel gone) closes the dialog
    expect(host.closed).toBe(true);
  });
});
