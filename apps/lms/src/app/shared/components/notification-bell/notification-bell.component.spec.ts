import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { NotificationBellComponent } from './notification-bell.component';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';

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
