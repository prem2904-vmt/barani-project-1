import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { renderBandPage } from '../admin-band.spec-helpers';
import { NotificationsConfigComponent } from './notifications-config.component';
import { DialogService } from '../../../core/services/dialog.service';

/**
 * The lab-wide "All notifications" master switch on Admin → Notifications.
 * The server enforces it (NotificationService gate); the page reflects it,
 * flips it via POST /api/config/notifications/master, and never rewrites the
 * per-alert rows.
 */
describe('Notifications — master switch', () => {
  const rows = [
    { key: 'report_ready', module: 'reports', label: 'Report ready', firesWhen: 'A report is generated', recipients: 'Front desk', kind: 'instant', enabled: true, thresholdMinutes: null, thresholdConfigurable: false, critical: false },
    { key: 'critical_value', module: 'results', label: 'Critical result entered', firesWhen: 'A critical bound is crossed', recipients: 'Validators', kind: 'instant', enabled: true, thresholdMinutes: null, thresholdConfigurable: false, critical: true },
    { key: 'bill_settled', module: 'billing', label: 'Bill fully paid', firesWhen: 'Balance reaches zero', recipients: 'Creator', kind: 'instant', enabled: false, thresholdMinutes: null, thresholdConfigurable: false, critical: false },
  ];
  const make = (master: unknown, confirm = true) => renderBandPage(NotificationsConfigComponent, {
    getFor: (u) => (u.includes('/notifications/catalog') ? rows : u.includes('/notifications/master') ? master : []),
    providers: [{ provide: DialogService, useValue: { confirm: vi.fn(async () => confirm), prompt: vi.fn(async () => null) } }],
  });
  const masterSwitch = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.pf-nc-master button[role="switch"]')!;
  const flush = () => new Promise((r) => setTimeout(r, 0));

  afterEach(() => TestBed.resetTestingModule());

  it('renders above the list with the critical-alerts note; on by default', () => {
    const p = make({ enabled: true, alwaysSends: ['critical_value'] });
    const card = p.el.querySelector('.pf-band-body .pf-nc-master')!;
    expect(card).not.toBeNull();
    // First thing in the body, above every module section.
    expect(p.el.querySelector('.pf-band-body')!.firstElementChild?.classList.contains('pf-nc-master')).toBe(true);
    expect(card.textContent).toContain('All notifications');
    expect(card.textContent).toContain('Critical result alerts always send.');
    expect(masterSwitch(p.el).getAttribute('aria-checked')).toBe('true');
    expect(card.textContent).toContain('2 of 3 alerts');
    // SVG icons, never emoji.
    expect(card.querySelectorAll('svg').length).toBeGreaterThan(0);
  });

  it('reflects a lab that is off: paused list + "Always sends" on critical rows only', () => {
    const p = make({ enabled: false });
    expect(masterSwitch(p.el).getAttribute('aria-checked')).toBe('false');
    expect(p.el.querySelectorAll('.pf-nc-paused').length).toBeGreaterThan(0);
    const always = Array.from(p.el.querySelectorAll('.pf-nc-badge--always')).map((c) => c.closest('.pf-nc-card')?.querySelector('p.font-semibold')?.textContent?.trim());
    expect(always).toEqual(['Critical result entered']);
    // Critical rows are live while paused: not dimmed.
    expect(p.el.querySelectorAll('.pf-nc-paused .pf-nc-card--live').length).toBe(1);
  });

  it('a missing / older backend reads as on', () => {
    const p = make([]);
    expect(masterSwitch(p.el).getAttribute('aria-checked')).toBe('true');
  });

  it('turning OFF asks first, posts ONLY the master switch, keeps each per-alert choice', async () => {
    const p = make({ enabled: true });
    masterSwitch(p.el).click();
    await flush();
    p.f.detectChanges();
    const dialog = TestBed.inject(DialogService) as any;
    expect(dialog.confirm).toHaveBeenCalledTimes(1);
    expect(p.api.post).toHaveBeenCalledTimes(1);
    expect(p.api.post).toHaveBeenCalledWith('/api/config/notifications/master', { enabled: false });
    expect(masterSwitch(p.el).getAttribute('aria-checked')).toBe('false');
    // Per-alert state untouched (bill_settled stays off, the others on).
    expect(p.cmp.rows().map((r: any) => [r.key, r.enabled])).toEqual([['report_ready', true], ['critical_value', true], ['bill_settled', false]]);

    // Back ON: no confirm, one more master post, same per-alert choices.
    masterSwitch(p.el).click();
    await flush();
    p.f.detectChanges();
    expect(dialog.confirm).toHaveBeenCalledTimes(1);
    expect(p.api.post).toHaveBeenLastCalledWith('/api/config/notifications/master', { enabled: true });
    expect(p.api.post).toHaveBeenCalledTimes(2);
    expect(p.cmp.rows().map((r: any) => r.enabled)).toEqual([true, true, false]);
    expect(p.el.querySelectorAll('.pf-nc-paused').length).toBe(0);
  });

  it('cancelling the confirm leaves everything on and posts nothing', async () => {
    const p = make({ enabled: true }, false);
    masterSwitch(p.el).click();
    await flush();
    p.f.detectChanges();
    expect(p.api.post).not.toHaveBeenCalled();
    expect(masterSwitch(p.el).getAttribute('aria-checked')).toBe('true');
  });
});
