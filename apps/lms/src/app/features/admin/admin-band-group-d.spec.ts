import { renderBandPage } from './admin-band.spec-helpers';
import { NotificationsConfigComponent } from './notifications-config/notifications-config.component';

/**
 * Group D admin pages on the band pill: notifications, workflows list,
 * process builder, KPIs, audit, OPD doctors, modules, settings hub.
 */
describe('Admin band — Notifications', () => {
  const rows = [
    { key: 'a', module: 'lab', label: 'Sample rejected', firesWhen: 'A sample is rejected', recipients: 'Front desk', kind: 'instant', enabled: true, thresholdMinutes: null, thresholdConfigurable: false },
    { key: 'b', module: 'lab', label: 'Result overdue', firesWhen: 'TAT breached', recipients: 'Lab head', kind: 'overdue', enabled: true, thresholdMinutes: 30, thresholdConfigurable: true },
    { key: 'c', module: 'billing', label: 'Refund issued', firesWhen: 'A refund posts', recipients: 'Accounts', kind: 'instant', enabled: false, thresholdMinutes: null, thresholdConfigurable: false },
  ];
  const make = () => renderBandPage(NotificationsConfigComponent, { getFor: (u) => (u.includes('/notifications/catalog') ? rows : []) });
  const labels = (el: HTMLElement) => Array.from(el.querySelectorAll('.pf-band-body pf-tile p.font-semibold')).map((p) => p.textContent?.trim());

  it('band + body; classic header and chip row are classic-only', () => {
    const p = make();
    expect(p.band()).not.toBeNull();
    expect(p.body()).not.toBeNull();
    expect(p.headerIsClassicOnly()).toBe(true);
    expect(p.el.querySelector('.pf-nc-chips')?.classList.contains('pf-classic-only')).toBe(true);
    expect(p.tools()?.querySelector('pf-select')).not.toBeNull();
  });

  it('pill search filters alerts across label / fires-when / recipients, with an empty state', () => {
    const p = make();
    expect(labels(p.el)).toEqual(['Sample rejected', 'Result overdue', 'Refund issued']);
    p.type('accounts');
    expect(labels(p.el)).toEqual(['Refund issued']);
    p.type('tat');
    expect(labels(p.el)).toEqual(['Result overdue']);
    p.type('nothing-here');
    expect(labels(p.el)).toEqual([]);
    expect(p.el.querySelector('.pf-band-empty')).not.toBeNull();
  });

  it('module picker in the pill: counts in labels, picking narrows the list', () => {
    const p = make();
    const opts = p.cmp.moduleOptions();
    expect(opts[0]).toEqual({ value: '', label: 'All modules · 3' });
    expect(opts.map((o: any) => o.label)).toContain('Lab bench · 2');
    p.cmp.setModuleFilter('billing');
    p.f.detectChanges();
    expect(labels(p.el)).toEqual(['Refund issued']);
  });
});
