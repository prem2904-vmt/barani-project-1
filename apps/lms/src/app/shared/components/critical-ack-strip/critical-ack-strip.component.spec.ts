import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { vi } from 'vitest';
import { CriticalAckStripComponent } from './critical-ack-strip.component';
import { CriticalResultsService } from '../../../core/services/critical-results.service';
import { ToastService } from '../../../core/services/toast.service';
import { AuthService } from '../../../core/auth/auth.service';
import { CriticalAckVia, CriticalResultEvent } from '../../models/critical-result.model';

/**
 * The open-critical strip on the result screens: one line per record with
 * ONE status word, Acknowledge only while THIS user hasn't acknowledged it,
 * Record communication until it is communicated; the acknowledgement carries
 * the screen's channel and the host is told about the updated record.
 */
const ev = (over: Partial<CriticalResultEvent> = {}): CriticalResultEvent => ({
  id: 'e1', status: 'open', source: 'live', orderTestId: 'ot1', orderId: 'o1', resultVersion: 1,
  patientId: 'p1', patientName: 'Mrs. Latha Devi', testId: 't1', testName: 'Potassium',
  summary: 'Potassium 7.2 mmol/L CH', values: [], detectedAt: '2026-09-29T06:00:00Z', alertedCount: 2, acknowledgements: [], ...over,
});

@Component({
  standalone: true,
  imports: [CriticalAckStripComponent],
  template: `<pf-critical-ack-strip [events]="events()" [via]="via" (changed)="changed.push($event)"></pf-critical-ack-strip>`,
})
class HostComponent {
  events = signal<CriticalResultEvent[]>([]);
  via: CriticalAckVia = 'validate';
  changed: CriticalResultEvent[] = [];
}

describe('CriticalAckStripComponent', () => {
  let svc: { acknowledge: ReturnType<typeof vi.fn>; recordCommunication: ReturnType<typeof vi.fn> };

  function render(events: CriticalResultEvent[], perms = true) {
    svc = {
      acknowledge: vi.fn((id: string) => of(ev({ id, status: 'acknowledged', acknowledgedByName: 'Me', acknowledgedAt: '2026-09-29T06:10:00Z',
        acknowledgements: [{ userId: 'me', name: 'Me', at: '2026-09-29T06:10:00Z', via: 'validate' }] }))),
      recordCommunication: vi.fn(),
    };
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        { provide: CriticalResultsService, useValue: svc },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn() } },
        { provide: AuthService, useValue: { user: () => ({ id: 'me' }), hasAnyPermission: () => perms, hasPermission: () => perms } },
      ],
    });
    const f = TestBed.createComponent(HostComponent);
    f.componentInstance.events.set(events);
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement, host: f.componentInstance };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('renders nothing without records', () => {
    const { el } = render([]);
    expect(el.querySelector('.pf-cas')).toBeNull();
  });

  it('lists each record with the test, its values and ONE status word; the headline counts the unacknowledged', () => {
    const { el } = render([ev(), ev({ id: 'e2', testName: 'Haemoglobin', summary: 'Hb 3.1 g/dL CL', status: 'acknowledged',
      acknowledgedByName: 'Dr A', acknowledgedAt: '2026-09-29T06:05:00Z', acknowledgements: [{ userId: 'u2', name: 'Dr A', at: '2026-09-29T06:05:00Z', via: 'bell' }] })]);
    const rows = el.querySelectorAll('.pf-cas__row');
    expect(rows.length).toBe(2);
    expect(el.querySelector('.pf-cas__title')?.textContent).toContain('1 not acknowledged');
    expect(rows[0].textContent).toContain('Potassium 7.2 mmol/L CH');
    expect(rows[0].querySelector('.pf-cas__status')?.textContent?.trim()).toBe('Not acknowledged');
    expect(rows[1].querySelector('.pf-cas__status')?.textContent?.trim()).toBe('Acknowledged');
    expect(rows[1].textContent).toContain('Acknowledged by Dr A');
    // Both still need MY acknowledgement (Dr A's does not count for me) and a communication.
    expect(el.querySelectorAll('.pf-cas__ack').length).toBe(2);
    expect(el.querySelectorAll('.pf-cas__comm').length).toBe(2);
    // Kit row actions, no native controls.
    expect(el.querySelectorAll('select').length).toBe(0);
    el.querySelectorAll('.pf-cas__ack, .pf-cas__comm').forEach(b => expect(b.classList.contains('pf-rowact')).toBe(true));
  });

  it('Acknowledge posts the screen channel and hands the updated record to the host; the button then goes', () => {
    const { f, el, host } = render([ev()]);
    (el.querySelector('.pf-cas__ack') as HTMLButtonElement).click();
    f.detectChanges();
    expect(svc.acknowledge).toHaveBeenCalledWith('e1', 'validate');
    expect(host.changed[0]?.status).toBe('acknowledged');
    host.events.set(host.changed);
    f.detectChanges();
    expect(el.querySelector('.pf-cas__ack')).toBeNull();
    expect(el.querySelector('.pf-cas__comm')).not.toBeNull();
  });

  it('a communicated record offers no actions; a user without result permissions sees no buttons', () => {
    const { el } = render([ev({ status: 'communicated', communicationMethod: 'phone', communicatedToName: 'Dr Anand', communicatedToRole: 'referring_doctor',
      acknowledgements: [{ userId: 'me', name: 'Me', at: '2026-09-29T06:10:00Z', via: 'validate' }] })]);
    expect(el.querySelector('.pf-cas__ack')).toBeNull();
    expect(el.querySelector('.pf-cas__comm')).toBeNull();
    expect(el.textContent).toContain('Phone call to Dr Anand (Referring doctor)');
    TestBed.resetTestingModule();
    const noPerm = render([ev()], false);
    expect(noPerm.el.querySelectorAll('.pf-rowact').length).toBe(0);
    expect(noPerm.el.querySelector('.pf-cas')).not.toBeNull();
  });
});

describe('CriticalAckStripComponent — loading feedback', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('Acknowledge: disabled + aria-busy while its request runs, one POST however often it is pressed', () => {
    const res$ = new Subject<CriticalResultEvent>();
    const svc = { acknowledge: vi.fn(() => res$), recordCommunication: vi.fn() };
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        { provide: CriticalResultsService, useValue: svc },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn() } },
        { provide: AuthService, useValue: { user: () => ({ id: 'me' }), hasAnyPermission: () => true, hasPermission: () => true } },
      ],
    });
    const f = TestBed.createComponent(HostComponent);
    f.componentInstance.events.set([ev()]);
    f.detectChanges();
    const btn = (f.nativeElement as HTMLElement).querySelector('.pf-cas__ack') as HTMLButtonElement;
    btn.click();
    f.detectChanges();
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    btn.click();
    expect(svc.acknowledge).toHaveBeenCalledTimes(1);
    res$.error(new Error('offline'));
    f.detectChanges();
    expect(btn.getAttribute('aria-busy')).toBeNull();
  });
});
