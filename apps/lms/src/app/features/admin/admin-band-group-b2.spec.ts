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
  Array.from(p.body()!.querySelectorAll(sel)).map((h) => (h.textContent ?? '').trim());

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

  it('band with a tabs-only pill (no search), header classic-only, one scrolling body', () => {
    const p = make();
    expect(p.band()).not.toBeNull();
    expect(p.bandInput()).toBeNull();
    expect(p.el.querySelector('.pf-hb__search--tabs')).not.toBeNull();
    expect(p.headerIsClassicOnly()).toBe(true);
    expect(p.body()).not.toBeNull();
    expect(pillTabs(p).labels()).toEqual(['Collection & IDs', 'Queues & assignment', 'Rules & gates']);
  });

  it('pill tabs swap the visible section cards', () => {
    const p = make();
    const t = () => titles(p, '.pf-ls__title');
    expect(t()).toContain('Sample identification');
    expect(t()).toContain('Specimen label code');
    expect(t()).not.toContain('Queue focus');

    pillTabs(p).click('Queues & assignment');
    expect(t()).toEqual(expect.arrayContaining(['Queue focus', 'Lab structure', 'Auto-assign by department']));
    expect(t()).not.toContain('Sample identification');

    pillTabs(p).click('Rules & gates');
    expect(t()).toEqual(expect.arrayContaining(['Calculation constants', 'Require full payment to progress', 'Enable inventory']));
    expect(t()).not.toContain('Lab structure');
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
    expect(pillTabs(p).labels()).toEqual(['Identity', 'Patient ID', 'Sample ID', 'Order ID']);
  });

  it('pill tabs swap the cards; each card keeps its own Save', () => {
    const p = make();
    const t = () => titles(p, '.pf-ls__title');
    expect(t()).toEqual(['Organization name', 'Organization login handle']);
    pillTabs(p).click('Patient ID');
    expect(t()).toEqual(['Patient ID format']);
    pillTabs(p).click('Sample ID');
    expect(t()).toEqual(['Sample ID format']);
    pillTabs(p).click('Order ID');
    expect(t()).toEqual(['Order ID format']);
    expect(p.actions().length).toBe(0);
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
    const t = () => titles(p, '.pf-section-title');
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
