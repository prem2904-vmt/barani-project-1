import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { renderBandPage } from '../../admin/admin-band.spec-helpers';
import { OPD_FRONT_DESK_SECTIONS, OpdFrontDeskPage, type OpdFrontDeskSection } from './front-desk.page';

describe('OPD front desk (Settings → OPD → Front desk, alerts and numbers)', () => {
  const make = (tab: string | null) => {
    const q = new BehaviorSubject(convertToParamMap(tab ? { tab } : {}));
    return renderBandPage(OpdFrontDeskPage, {
      getFor: (u) => u.includes('/notifications/catalog') ? [{ key: 'opd_visit_waiting', module: 'opd', label: 'Visit waiting', firesWhen: 'x', recipients: 'y', kind: 'instant', enabled: true, thresholdMinutes: null, thresholdConfigurable: false }]
        : u.includes('/notifications/master') ? { enabled: true } : [],
      providers: [{ provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: q.value, data: {} }, queryParamMap: q } }],
    });
  };
  afterEach(() => TestBed.resetTestingModule());

  it('lists the three categories the left panel anchors', () => {
    expect(OPD_FRONT_DESK_SECTIONS.map(s => s.label)).toEqual(['Appointments and booking', 'Referring doctors and hospitals', 'OPD alerts']);
  });

  it('opens on Appointments and booking: only the Booking slots card, plus a link to the OPD workflow', () => {
    const p = make(null);
    expect(p.el.querySelector('pf-appointments-config')).not.toBeNull();
    expect(p.cmp.section()).toBe<OpdFrontDeskSection>('appointments');
    expect(p.el.textContent).toContain('Booking slots');
    expect(p.el.textContent).not.toContain('Queue mode');
    expect(p.el.textContent).not.toContain('Priority engine');
    expect(p.el.querySelector('a[href="/admin/opd/workflow"]')).not.toBeNull();
  });

  it('?tab=referring shows the ONE shared referring list; ?tab=alerts shows OPD alerts only', () => {
    const r = make('referring');
    expect(r.el.querySelector('pf-referring-network')).not.toBeNull();
    TestBed.resetTestingModule();
    const a = make('alerts');
    expect(a.el.querySelector('pf-notifications-config')).not.toBeNull();
    expect(a.el.textContent).toContain('Visit waiting');
  });

  it('an unknown tab falls back to Appointments and booking', () => {
    expect(make('nonsense').cmp.section()).toBe('appointments');
  });
});
