import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { TenantEntitlementsService } from '../../core/services/tenant-entitlements.service';
import { OpdGateService } from '../../features/opd/shared/opd-gate.service';
import { ServiceShelfService } from '../../core/services/service-shelf.service';
import { tallyServices } from '../../core/services/service-shelf';
import { ServicesShelfComponent } from './services-shelf.component';

/** The Services shelf on the bottom bar (owner 2026-11-19): Frontdesk area, 2+ services, remembered per user. */
function setup(o: { url?: string; opd?: boolean; perms?: string[]; user?: string } = {}) {
  const opd = signal(o.opd ?? true);
  const user = signal<{ id: string; permissions: string[] } | null>({ id: o.user ?? 'u1', permissions: o.perms ?? ['*'] });
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [ServicesShelfComponent],
    providers: [
      { provide: Router, useValue: { url: o.url ?? '/frontdesk', events: new Subject() } },
      { provide: AuthService, useValue: { user, hasAnyPermission: (codes: string[]) => { const p = user()?.permissions ?? []; return p.includes('*') || codes.some(c => p.includes(c)); } } },
      { provide: TenantEntitlementsService, useValue: { modules: signal(null), moduleOn: (id: string) => id === 'lab' || (id === 'opd' && opd()) } },
      { provide: OpdGateService, useValue: { visible: opd } },
    ],
  });
  return { svc: TestBed.inject(ServiceShelfService), opd, user };
}

describe('ServiceShelfService', () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });

  it('lab-only (OPD gate closed): one service, no shelf, the filter is always All', () => {
    const { svc } = setup({ opd: false });
    expect(svc.services().map(s => s.id)).toEqual(['lab']);
    expect(svc.visible()).toBe(false);
    svc.select('lab');
    expect(svc.selected()).toBe('all');
  });

  it('Lab + OPD (pf.opd()): the shelf shows in the Frontdesk area only', () => {
    expect(setup({ url: '/frontdesk' }).svc.visible()).toBe(true);
    expect(setup({ url: '/lab/my-work' }).svc.visible()).toBe(false);
  });

  it('OPD without any desk permission is not a service', () => {
    const { svc } = setup({ perms: ['view_results'] });
    expect(svc.services().map(s => s.id)).toEqual(['lab']);
    expect(svc.visible()).toBe(false);
  });

  it('remembers the pick per user, and falls back to All when the service is no longer granted', () => {
    const { svc, opd } = setup({ user: 'u7' });
    svc.select('opd');
    expect(svc.selected()).toBe('opd');
    expect(localStorage.getItem('pf-lms.frontdesk.service.u7')).toBe('opd');
    opd.set(false);                       // the gate closes (or the grant is withdrawn)
    expect(svc.selected()).toBe('all');
    // Another user on the same browser has their own choice.
    const other = setup({ user: 'u8' }).svc;
    expect(other.selected()).toBe('all');
  });
});

describe('pf-services-shelf', () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });

  it('renders "Services" + All · Lab · OPD chips with counts; the pick takes the draft chip\'s aria-current look', () => {
    const { svc } = setup();
    svc.publish(tallyServices([{ s: 'lab' }, { s: 'lab' }, { s: 'opd', late: true }] as Array<{ s: 'lab' | 'opd'; late?: boolean }>, x => x.s, x => !!x.late));
    const f = TestBed.createComponent(ServicesShelfComponent);
    f.componentRef.setInput('viewportW', 1440);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('.pf-draftshelf__head')?.textContent?.trim()).toBe('Services');
    const chips = [...el.querySelectorAll<HTMLButtonElement>('.pf-draftshelf__chip[role="radio"]')];
    expect(chips.map(c => [c.querySelector('.pf-draftshelf__lbl')?.textContent?.trim(), c.querySelector('.pf-svcshelf__n')?.textContent?.trim()]))
      .toEqual([['All', '3'], ['Lab', '2'], ['OPD', '1']]);
    expect(chips[0].getAttribute('aria-current')).toBe('true');
    expect(chips[0].getAttribute('aria-checked')).toBe('true');
    // Rose dot = someone is waiting long in that service (and so in All).
    expect(chips[2].querySelector('.pf-svcshelf__late')).not.toBeNull();
    expect(chips[1].querySelector('.pf-svcshelf__late')).toBeNull();
    chips[2].click();
    f.detectChanges();
    expect(svc.selected()).toBe('opd');
    const after = [...el.querySelectorAll<HTMLButtonElement>('.pf-draftshelf__chip[role="radio"]')];
    expect(after[2].getAttribute('aria-current')).toBe('true');
    expect(after[0].getAttribute('aria-current')).toBeNull();
  });
});
