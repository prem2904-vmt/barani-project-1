import { TestBed } from '@angular/core/testing';
import { renderBandPage } from '../admin-band.spec-helpers';
import { NotificationsConfigComponent, alertInDepartment } from './notifications-config.component';

describe('Notifications — by department (OPD / IPD alerts in Settings)', () => {
  const row = (key: string, module: string) => ({ key, module, label: key, firesWhen: 'x', recipients: 'y', kind: 'instant', enabled: true, thresholdMinutes: null, thresholdConfigurable: false });
  const rows = [row('bill_settled', 'billing'), row('inventory_low_stock', 'inventory'), row('opd_visit_waiting', 'opd'), row('rx_ready', 'pharmacy'), row('ipd_admit', 'ipd')];
  const make = (department: 'lab' | 'opd' | 'ipd' | 'pharmacy' | null) => {
    const p = renderBandPage(NotificationsConfigComponent, { getFor: (u) => u.includes('/catalog') ? rows : u.includes('/master') ? { enabled: true } : [] });
    p.f.componentRef.setInput('department', department);
    p.f.detectChanges();
    return p;
  };
  afterEach(() => TestBed.resetTestingModule());

  it('the pure rule: OPD owns opd, Pharmacy owns pharmacy, IPD owns ipd, Lab owns the rest, none = all', () => {
    expect(alertInDepartment('opd', 'opd')).toBe(true);
    expect(alertInDepartment('pharmacy', 'opd')).toBe(false);
    expect(alertInDepartment('pharmacy', 'pharmacy')).toBe(true);
    expect(alertInDepartment('billing', 'opd')).toBe(false);
    expect(alertInDepartment('ipd', 'ipd')).toBe(true);
    expect(alertInDepartment('opd', 'lab')).toBe(false);
    expect(alertInDepartment('billing', 'lab')).toBe(true);
    expect(alertInDepartment('ipd', null)).toBe(true);
  });

  it('no department shows every alert (the old page, unchanged)', () => {
    const p = make(null);
    expect(p.cmp.scoped().length).toBe(5);
  });

  it('OPD shows only OPD alerts, with the master switch count scoped too', () => {
    const p = make('opd');
    expect(p.cmp.scoped().map((r: any) => r.key)).toEqual(['opd_visit_waiting']);
    expect(p.el.textContent).toContain('1 of 1 alerts');
  });

  it('IPD shows only IPD alerts', () => {
    const p = make('ipd');
    expect(p.cmp.scoped().map((r: any) => r.key)).toEqual(['ipd_admit']);
  });

  it('a department with no alerts yet says so in plain words', () => {
    const p = renderBandPage(NotificationsConfigComponent, { getFor: (u) => u.includes('/catalog') ? [row('bill_settled', 'billing')] : u.includes('/master') ? { enabled: true } : [] });
    p.f.componentRef.setInput('department', 'ipd');
    p.f.detectChanges();
    expect(p.el.querySelector('.pf-band-empty')!.textContent).toContain('no IPD alerts yet');
  });
});
