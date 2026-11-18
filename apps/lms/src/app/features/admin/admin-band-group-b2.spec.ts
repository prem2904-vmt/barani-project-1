import { signal } from '@angular/core';
import { vi } from 'vitest';
import { renderBandPage } from './admin-band.spec-helpers';
import { AuthService } from '../../core/auth/auth.service';
import { TenantStateService } from '../../core/services/tenant-state.service';
import { BranchLabConfigService } from '../../core/services/branch-lab-config.service';
import { TenantEntitlementsService } from '../../core/services/tenant-entitlements.service';
import { LabSettingsComponent } from './lab-settings/lab-settings.component';
import { OrganizationSettingsComponent } from './organization/organization-settings.component';
import { AppointmentsConfigComponent } from './appointments-config/appointments-config.component';
import { AppointmentQueueService } from '../../core/services/appointment-queue.service';
import { of } from 'rxjs';
import { OpdSettingsComponent } from '../opd/admin/opd-settings.component';
import { CultureSettingsComponent } from '../lab/culture-settings/culture-settings.component';

/**
 * Admin band — settings forms whose section cards become a tabs-only pill
 * (group B2). Each page: band present, NO pill search, clicking a pill tab
 * swaps the visible section cards, and any page-level Save lives in the band.
 */

const auth = {
  provide: AuthService,
  useValue: {
    user: () => ({ tenantName: 'Micro World', firstName: 'Admin', branchId: null, permissions: [] }),
    activeBranchId: () => null,
    hasPermission: () => true,
    hasAnyPermission: () => true,
    isAuthenticated: () => true,
    waitForAuth: async () => undefined,
  },
};
const tenantState = {
  provide: TenantStateService,
  useValue: { tenant: () => null, ensureLoaded: vi.fn(), update: vi.fn() },
};

/** Pill tab buttons + a click helper. */
function pillTabs(p: ReturnType<typeof renderBandPage>) {
  const btns = () => Array.from(p.tools()!.querySelectorAll<HTMLButtonElement>('pf-segmented button'));
  return {
    labels: () => btns().map((b) => b.getAttribute('aria-label')),
    click: (label: string) => {
      const b = btns().find((x) => x.getAttribute('aria-label') === label);
      if (!b) throw new Error(`no pill tab "${label}"`);
      b.click();
      p.f.detectChanges();
    },
  };
}
const titles = (p: ReturnType<typeof renderBandPage>, sel: string) =>
  Array.from((p.body() ?? p.el).querySelectorAll(sel)).map((h) => (h.textContent ?? '').trim());

describe('Admin band B2 — Lab settings', () => {
  function make() {
    return renderBandPage(LabSettingsComponent, {
      getFor: (url) => (url === '/api/tenants/branch-lab-config' ? { labStructure: 'auto' } : []),
      providers: [
        auth,
        tenantState,
        {
          provide: BranchLabConfigService,
          useValue: {
            collectionMode: signal('front_desk'),
            billingMode: signal('front_desk'),
            ensureLoaded: vi.fn(),
            update: vi.fn(),
          },
        },
        { provide: TenantEntitlementsService, useValue: { moduleEnabled: () => true, ensureLoaded: vi.fn() } },
      ],
    });
  }

  const show = (p: ReturnType<typeof make>, cards: string[] | null) => {
    p.f.componentRef.setInput('cards', cards);
    p.f.detectChanges();
  };
  const t = (p: ReturnType<typeof make>) => titles(p, '.pf-sgroup__label');

  it('is a card host: no band or header of its own (the Lab page supplies them)', () => {
    const p = make();
    expect(p.band()).toBeNull();
    expect(p.el.querySelector('pf-screen-header')).toBeNull();
  });

  it('shows only the cards a page gives it', () => {
    const p = make();
    show(p, ['queue-focus']);
    expect(t(p)).toEqual(['Queue']);
    show(p, ['scan-mode']);
    expect(t(p)).toEqual(['Finding a sample']);
    show(p, ['lab-structure']);
    expect(t(p)).toEqual(['Structure']);
    show(p, ['label-code']);
    expect(t(p)).toEqual(['Labels']);
    show(p, ['auto-assign']);
    expect(t(p)).toEqual(['Auto-assign']);
    show(p, ['require-validation']);
    expect(t(p)).toEqual(['Validation']);
  });

  it('the moved cards are gone: payment rules (Billing), Enable inventory (Inventory), the pointer cards', () => {
    const p = make();
    show(p, null);
    const all = t(p);
    expect(all).not.toContain('Require full payment to progress');
    expect(all).not.toContain('Show "Payments due" tab');
    expect(all).not.toContain('Enable inventory');
    expect(all).not.toContain('Sample IDs');
    expect(all).not.toContain('Report layout');
    expect(all).not.toContain('WhatsApp, email and SMS');
  });

  it('autosaves — no page-level band action', () => {
    const p = make();
    expect(p.actions().length).toBe(0);
  });
});

describe('Admin band B2 — Organization & Identity', () => {
  function make() {
    return renderBandPage(OrganizationSettingsComponent, {
      getFor: (url) => (url === '/api/tenants/current' ? { name: 'Micro World', slug: 'microworld' } : {}),
      providers: [auth, tenantState],
    });
  }

  it('band with a tabs-only pill, header classic-only', () => {
    const p = make();
    expect(p.band()).not.toBeNull();
    expect(p.bandInput()).toBeNull();
    expect(p.headerIsClassicOnly()).toBe(true);
    expect(pillTabs(p).labels()).toEqual(['Identity', 'Patient ID']);
  });

  it('pill tabs swap the cards; the open tab Save is the band ONE primary', () => {
    const p = make();
    const t = () => titles(p, '.pf-ls__title');
    expect(t()).toEqual(['Organization name', 'Organization login handle']);
    const primary = () => p.el.querySelectorAll('pf-hero-band .pf-hb__actions .pf-hb-btn--primary');
    expect(primary().length).toBe(1);
    expect((primary()[0] as HTMLButtonElement).disabled).toBe(true);   // nothing changed yet
    pillTabs(p).click('Patient ID');
    expect(Array.from(p.el.querySelectorAll('.pf-sgroup__label')).map((x) => x.textContent?.trim())).toEqual(['Patient ID']);
    expect(primary()[0].textContent).toContain('Save format');
    expect(p.actions().length).toBe(1);   // the Order ID moved to Lab / OPD / Pharmacy: no tab for it here
  });

  it('kit controls: pf-card sections, pf-select (no native select), slate switches', () => {
    const p = make();
    expect(p.body()!.querySelectorAll('section.pf-card').length).toBe(2);
    pillTabs(p).click('Patient ID');
    expect(p.el.querySelector('select')).toBeNull();
    const sw = p.body()!.querySelector<HTMLButtonElement>('.pf-toggle[role="switch"]')!;   // Custom format
    expect(sw.getAttribute('aria-checked')).toBe('false');
    sw.click(); p.f.detectChanges();
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(p.body()!.querySelector('pf-select')).not.toBeNull();
    expect(p.el.querySelector('input[type="checkbox"], .font-mono')).toBeNull();
  });

  it('identity Save saves whichever of name / handle changed', () => {
    const p = make();
    p.cmp.orgName.set('Micro World Labs');
    p.f.detectChanges();
    const btn = p.el.querySelector<HTMLButtonElement>('pf-hero-band .pf-hb-btn--primary')!;
    expect(btn.disabled).toBe(false);
    btn.click();
    expect(p.api.patch).toHaveBeenCalledWith('/api/tenants/current', { name: 'Micro World Labs' });
    expect(p.api.patch).toHaveBeenCalledTimes(1);
  });
});

describe('Admin band B2 — Appointments & queue', () => {
  const cfg = {
    queueMode: 'token_queue', slotMinutes: 30, maxConcurrentSlots: 1, open24h: true, weeklyScheduleJson: null,
    queueOptions: {
      baseAppointment: 100, baseWalkin: 50, baseFollowup: 80, waitWeight: 1, appointmentGraceMinutes: 10,
      latePenalty: 50, noShowThresholdMinutes: 30, avgCollectionMinutes: 5, urgentOverrideScore: 1000,
    },
  };
  function make() {
    const svc = { getConfig: vi.fn(() => of(cfg)), saveConfig: vi.fn((c: unknown) => of(c)) };
    const p = renderBandPage(AppointmentsConfigComponent, {
      providers: [auth, tenantState, { provide: AppointmentQueueService, useValue: svc }],
    });
    return { ...p, svc };
  }

  it('band with a tabs-only pill, header classic-only', () => {
    const p = make();
    expect(p.band()).not.toBeNull();
    expect(p.bandInput()).toBeNull();
    expect(p.headerIsClassicOnly()).toBe(true);
    expect(pillTabs(p).labels()).toEqual(['Queue mode', 'Booking slots', 'Priority engine']);
  });

  it('pill tabs swap the section cards', () => {
    const p = make();
    const t = () => titles(p, '.pf-sgroup__label');
    expect(t()).toEqual(['Queue mode']);
    pillTabs(p).click('Booking slots');
    expect(t()).toEqual(['Booking slots']);
    pillTabs(p).click('Priority engine');
    expect(t()).toEqual(['Priority engine']);
  });

  it('Save lives in the band actions and saves the config', () => {
    const p = make();
    const save = p.actions().find((b) => b.textContent?.includes('Save'));
    expect(save).toBeTruthy();
    save!.click();
    expect(p.svc.saveConfig).toHaveBeenCalledTimes(1);
  });
});

describe('Admin band B2 — OPD settings', () => {
  function make(followUpMode = 'auto') {
    return renderBandPage(OpdSettingsComponent, {
      getFor: (url) => (url === '/api/opd/settings'
        ? { followUpMode, tiers: [{ withinDays: 7, discountPercent: 100 }] } : {}),
      providers: [auth, tenantState],
    });
  }

  it('band with the follow-up mode as the tabs-only pill switch, header classic-only', () => {
    const p = make();
    expect(p.band()).not.toBeNull();
    expect(p.bandInput()).toBeNull();
    expect(p.headerIsClassicOnly()).toBe(true);
    expect(pillTabs(p).labels()).toEqual(['Off', 'Automatic', 'Assisted']);
    // The classic radio-card gate is replaced by the pill.
    expect(p.body()!.querySelector('.pf-os__gate')).toBeNull();
  });

  it('switching the mode in the pill shows/hides the tiers card', () => {
    const p = make();
    expect(titles(p, '.pf-os__title')).toContain('Tiers');
    expect(p.body()!.querySelector('.pf-os__modehint')?.textContent).toContain('Automatic');
    pillTabs(p).click('Off');
    expect(titles(p, '.pf-os__title')).not.toContain('Tiers');
    expect(p.body()!.querySelector('.pf-os__modehint')?.textContent).toContain('Off');
    pillTabs(p).click('Assisted');
    expect(titles(p, '.pf-os__title')).toContain('Tiers');
  });

  it('Save lives in the band actions and PUTs the chosen mode', () => {
    const p = make();
    pillTabs(p).click('Assisted');
    const save = p.actions().find((b) => b.textContent?.includes('Save'));
    expect(save).toBeTruthy();
    save!.click();
    expect(p.api.put).toHaveBeenCalledWith('/api/opd/settings',
      { followUpMode: 'assisted', tiers: [{ withinDays: 7, discountPercent: 100 }] });
  });
});

describe('Admin band B2 — Microbiology / Culture settings', () => {
  function make() {
    return renderBandPage(CultureSettingsComponent, {
      getFor: (url) => (url === '/api/microbiology/settings'
        ? { lockTimeoutMinutes: 45, allowSupervisorTakeover: false, stageTats: [{ stageKey: 'gram', tatHours: 4 }] } : {}),
      providers: [auth, tenantState],
    });
  }

  it('band with a tabs-only pill, header classic-only', () => {
    const p = make();
    expect(p.band()).not.toBeNull();
    expect(p.bandInput()).toBeNull();
    expect(p.headerIsClassicOnly()).toBe(true);
    expect(pillTabs(p).labels()).toEqual(['Stage lock', 'Turnaround']);
  });

  it('pill tabs swap the two cards', () => {
    const p = make();
    expect(titles(p, '.pf-cs__title')).toEqual(['Stage lock']);
    pillTabs(p).click('Turnaround');
    expect(titles(p, '.pf-cs__title')).toEqual(['Turnaround targets']);
  });

  it('Save lives in the band actions and PUTs the settings', () => {
    const p = make();
    const save = p.actions().find((b) => b.textContent?.includes('Save'));
    expect(save).toBeTruthy();
    save!.click();
    expect(p.api.put).toHaveBeenCalledWith('/api/microbiology/settings',
      { lockTimeoutMinutes: 45, allowSupervisorTakeover: false, stageTats: [{ stageKey: 'gram', tatHours: 4 }] });
  });
});
