import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { CriticalCommunicationDialogComponent } from './critical-communication-dialog.component';
import { CriticalResultsService } from '../../../core/services/critical-results.service';
import { ToastService } from '../../../core/services/toast.service';
import { CriticalResultEvent } from '../../models/critical-result.model';

/**
 * "Record communication" (NABL): the method is a pf-select (never a native
 * <select>), the name is required, the role rides along, and the POST goes to
 * the record's communication endpoint. Saved → the host gets the updated row.
 */
const EVENT: CriticalResultEvent = {
  id: 'e1', status: 'acknowledged', source: 'live', orderTestId: 'ot1', orderId: 'o1', orderNumber: 'LAB-2609-000123', resultVersion: 1,
  patientId: 'p1', patientName: 'Mr. Arun Kumar', patientMrn: 'AA0007', testId: 't1', testName: 'Potassium',
  summary: 'Potassium 7.2 mmol/L CH', values: [], detectedAt: '2026-09-29T06:00:00Z', alertedCount: 2, acknowledgements: [],
};

@Component({
  standalone: true,
  imports: [CriticalCommunicationDialogComponent],
  template: `@if (open()) { <pf-critical-communication-dialog [event]="event" (closed)="closed = true" (saved)="saved = $event"></pf-critical-communication-dialog> }`,
})
class HostComponent {
  event = EVENT;
  open = signal(true);
  closed = false;
  saved: CriticalResultEvent | null = null;
}

describe('CriticalCommunicationDialogComponent', () => {
  let svc: { recordCommunication: ReturnType<typeof vi.fn> };
  let toasts: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  function render() {
    svc = { recordCommunication: vi.fn(() => of({ ...EVENT, status: 'communicated', communicationMethod: 'phone', communicatedToName: 'Dr Anand' })) };
    toasts = { success: vi.fn(), error: vi.fn() };
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        { provide: CriticalResultsService, useValue: svc },
        { provide: ToastService, useValue: toasts },
      ],
    });
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    // pfModalPortal moves the dialog to <body>.
    const dlg = document.body.querySelector('.pf-ccd') as HTMLElement;
    return { f, dlg, host: f.componentInstance };
  }

  afterEach(() => { TestBed.resetTestingModule(); document.body.querySelectorAll('.pf-ccd').forEach(n => n.remove()); });

  it('uses pf-select for the method and the role — no native controls', () => {
    const { dlg } = render();
    expect(dlg).toBeTruthy();
    expect(dlg.getAttribute('role')).toBe('dialog');
    expect(dlg.querySelectorAll('select, datalist').length).toBe(0);
    expect(dlg.querySelectorAll('pf-select').length).toBe(2);
    expect(dlg.textContent).toContain('Potassium');
    expect(dlg.textContent).toContain('Mr. Arun Kumar');
    // ONE primary: Save.
    expect(dlg.querySelectorAll('.pf-btn--primary').length).toBe(1);
  });

  it('needs a name before it can save, then posts method / name / role / notes and emits the updated record', () => {
    const { f, dlg, host } = render();
    const save = dlg.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    const name = dlg.querySelector('#pf-ccd-to') as HTMLInputElement;
    name.value = '  Dr Anand  ';
    name.dispatchEvent(new Event('input'));
    const notes = dlg.querySelector('#pf-ccd-notes') as HTMLTextAreaElement;
    notes.value = 'Read back confirmed';
    notes.dispatchEvent(new Event('input'));
    f.detectChanges();
    expect(save.disabled).toBe(false);

    (dlg.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    f.detectChanges();
    expect(svc.recordCommunication).toHaveBeenCalledWith('e1', {
      method: 'phone', toName: 'Dr Anand', toRole: 'referring_doctor', notes: 'Read back confirmed',
    });
    expect(host.saved?.status).toBe('communicated');
    expect(toasts.success).toHaveBeenCalled();
  });

  it('shows the server message inline when the save is refused', () => {
    const { f, dlg } = render();
    svc.recordCommunication.mockReturnValueOnce(throwError(() => ({ message: 'The communication time cannot be in the future.' })));
    const name = dlg.querySelector('#pf-ccd-to') as HTMLInputElement;
    name.value = 'Patient';
    name.dispatchEvent(new Event('input'));
    f.detectChanges();
    (dlg.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    f.detectChanges();
    expect(dlg.querySelector('[role="alert"]')?.textContent).toContain('cannot be in the future');
  });

  it('Cancel and Escape close without saving', () => {
    const { f, dlg, host } = render();
    (dlg.querySelector('.pf-btn--secondary') as HTMLButtonElement).click();
    f.detectChanges();
    expect(host.closed).toBe(true);
    expect(svc.recordCommunication).not.toHaveBeenCalled();
  });
});
