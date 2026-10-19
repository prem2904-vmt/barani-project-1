import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { NotificationBellComponent } from './notification-bell.component';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { CriticalResultsService } from '../../../core/services/critical-results.service';
import { ToastService } from '../../../core/services/toast.service';

/**
 * Audit M20: dev holds hundreds of "lms."-prefixed rows (tat_breach,
 * report_ready, sample_rejection …) that the bell used to show as a generic
 * violet bell. Both spellings must render the same icon, tone and label.
 */
describe('NotificationBellComponent — type keys', () => {
  const row = (id: string, type: string) => ({
    id, type, title: 't ' + id, body: 'b', isRead: false, createdAt: new Date().toISOString(),
    referenceId: null, referenceType: null,
  });
  const list = [
    row('1', 'lms.tat_breach'), row('2', 'tat_breach'),
    row('3', 'lms.report_ready'), row('4', 'report_ready'),
    row('5', 'lms.sample_rejection'), row('6', 'critical_value'),
    row('7', 'lms.user_created'),
  ];

  function render() {
    TestBed.configureTestingModule({
      imports: [NotificationBellComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { get: vi.fn(() => of(list)), patch: vi.fn(() => of({})) } },
        { provide: AuthService, useValue: { hasPermission: () => false } },
      ],
    });
    const f = TestBed.createComponent(NotificationBellComponent);
    f.detectChanges();
    f.componentInstance.toggleOpen();
    f.detectChanges();
    return f;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('matches tone, label and icon on the canonical key for both spellings', () => {
    const c = render().componentInstance;
    for (const [a, b] of [['lms.tat_breach', 'tat_breach'], ['lms.report_ready', 'report_ready'], ['lms.sample_rejection', 'sample_rejection']]) {
      expect(c.toneFor(a)).toBe(c.toneFor(b));
      expect(c.typeLabel(a)).toBe(c.typeLabel(b));
      expect(c.pathFor(a)).toBe(c.pathFor(b));
    }
    expect(c.toneFor('lms.tat_breach')).toBe('amber');
    expect(c.toneFor('lms.report_ready')).toBe('emerald');
    expect(c.typeLabel('lms.tat_breach')).toBe('TAT breach');
    expect(c.typeLabel('lms.user_created')).toBe('user created');
    expect(c.toneFor('critical_value')).toBe('rose');
    // Work Register #6: urgent_report_ready is amber (distinct from the
    // routine report_ready's emerald) and shares report_ready's icon.
    expect(c.toneFor('urgent_report_ready')).toBe('amber');
    expect(c.typeLabel('urgent_report_ready')).toBe('urgent — ready to report');
    expect(c.pathFor('urgent_report_ready')).toBe(c.pathFor('report_ready'));
  });

  it('renders prefixed and unprefixed rows identically in the list', () => {
    const f = render();
    const el = f.nativeElement as HTMLElement;
    const tones = Array.from(el.querySelectorAll('.pf-type-icon')).map((i) => i.getAttribute('data-tone'));
    expect(tones).toEqual(['amber', 'amber', 'emerald', 'emerald', 'amber', 'rose', 'violet']);
    const text = el.textContent ?? '';
    expect(text).toContain('TAT breach');
    expect(text).toContain('report ready');
    expect(text).not.toContain('lms.');
  });
});

/**
 * NABL: a critical bell carries an explicit Acknowledge — reading the bell
 * is not the record. Only for critical types referencing an order test, only
 * for users who may act on results; the click posts via 'bell', then the row
 * is marked read and the button goes.
 */
describe('NotificationBellComponent — critical acknowledgement', () => {
  const row = (id: string, type: string, over: Record<string, unknown> = {}) => ({
    id, type, title: 't ' + id, body: 'b', isRead: false, createdAt: new Date().toISOString(),
    referenceId: 'ot-' + id, referenceType: 'order_test', ...over,
  });
  const list = [
    row('1', 'critical_value'),
    row('2', 'lms.critical_unvalidated'),
    row('3', 'report_ready', { referenceType: 'report' }),
    row('4', 'critical_value', { referenceId: null }),
  ];

  function render(perms: boolean) {
    const api = { get: vi.fn(() => of(list)), patch: vi.fn(() => of({})) };
    const critical = { acknowledgeOrderTest: vi.fn(() => of([{ id: 'e1', status: 'acknowledged' }])) };
    const toasts = { success: vi.fn(), error: vi.fn() };
    TestBed.configureTestingModule({
      imports: [NotificationBellComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: { hasPermission: () => perms, hasAnyPermission: () => perms } },
        { provide: CriticalResultsService, useValue: critical },
        { provide: ToastService, useValue: toasts },
      ],
    });
    const f = TestBed.createComponent(NotificationBellComponent);
    f.detectChanges();
    f.componentInstance.toggleOpen();
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement, api, critical, toasts };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('offers Acknowledge on critical rows that reference a result, for a result user only', () => {
    const { el } = render(true);
    const acks = [...el.querySelectorAll('.pf-bell-ack')];
    expect(acks.length).toBe(2);
    expect(acks[0].getAttribute('aria-label')).toContain('t 1');
    expect(acks[1].getAttribute('aria-label')).toContain('t 2');
    TestBed.resetTestingModule();
    expect(render(false).el.querySelectorAll('.pf-bell-ack').length).toBe(0);
  });

  it('the click records the acknowledgement via the bell, marks the row read, and does not navigate', () => {
    const { f, el, api, critical, toasts } = render(true);
    const btn = el.querySelector('.pf-bell-ack') as HTMLButtonElement;
    btn.click();
    f.detectChanges();
    expect(critical.acknowledgeOrderTest).toHaveBeenCalledWith('ot-1', 'bell');
    expect(api.patch).toHaveBeenCalledWith('/api/notifications/1/read');
    expect(toasts.success).toHaveBeenCalledWith('Critical result acknowledged');
    expect(f.componentInstance.open()).toBe(true);
    expect(f.componentInstance.items().find(n => n.id === '1')?.isRead).toBe(true);
    expect(el.querySelectorAll('.pf-bell-ack').length).toBe(1);
  });
});
