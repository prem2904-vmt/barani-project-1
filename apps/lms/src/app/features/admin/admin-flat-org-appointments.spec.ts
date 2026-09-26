import { vi } from 'vitest';
import { of } from 'rxjs';
import { renderBandPage } from './admin-band.spec-helpers';
import { AuthService } from '../../core/auth/auth.service';
import { TenantStateService } from '../../core/services/tenant-state.service';
import { OrganizationSettingsComponent } from './organization/organization-settings.component';
import { AppointmentsConfigComponent } from './appointments-config/appointments-config.component';
import { AppointmentQueueService } from '../../core/services/appointment-queue.service';

/**
 * ND-PATTERN §19 "Admin pages": Organization & IDs and Appointments & queue
 * are ONE scrolling page each — no pill tabs, the page name is the pill's
 * h1, every section renders at once, every searchable setting has its
 * anchor, choices are real radiogroups, and the band Save still saves.
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
type Page = ReturnType<typeof renderBandPage>;
const bandSave = (p: Page) => p.el.querySelector<HTMLButtonElement>('pf-hero-band .pf-hb__actions .pf-hb-btn--primary')!;
const secTitles = (p: Page) =>
  Array.from(p.body()!.querySelectorAll('section.nd-setsec .nd-card__label')).map((h) => (h.textContent ?? '').trim());

function expectFlat(p: Page, h1: string) {
  expect(p.band()).not.toBeNull();
  expect(p.el.querySelector('.pf-hb__tools pf-segmented')).toBeNull();
  const title = p.el.querySelector('pf-hero-band h1.nd-band-page');
  expect(title?.textContent?.trim()).toBe(h1);
  expect(p.headerIsClassicOnly()).toBe(true);
}

describe('Flat admin page — Organization & IDs', () => {
  function make() {
    return renderBandPage(OrganizationSettingsComponent, {
      getFor: (url) => (url === '/api/tenants/current' ? { name: 'Micro World', slug: 'microworld' } : {}),
      providers: [auth, tenantState],
    });
  }

  it('no pill tabs; the page name is the pill h1', () => expectFlat(make(), 'Organization & IDs'));

  it('every section renders at once, in order, with the jump list', () => {
    const p = make();
    expect(secTitles(p)).toEqual(['Organization', 'Patient ID', 'Sample ID', 'Order ID']);
    for (const id of ['sec-identity', 'sec-patient', 'sec-sample', 'sec-order']) {
      expect(p.el.querySelector(`#${id}`)).not.toBeNull();
    }
    expect(p.el.querySelectorAll('pf-settings-jump .nd-setjump__item').length).toBe(4);
  });

  it('every searchable setting has its anchor', () => {
    const p = make();
    for (const id of ['org-name', 'login-handle', 'patient-id', 'sample-id', 'order-id']) {
      expect(p.el.querySelector(`#${id}.nd-set`)).not.toBeNull();
    }
  });

  it('previews read "Looks like:"; switches are labelled slate toggles; no native select', () => {
    const p = make();
    const previews = Array.from(p.el.querySelectorAll('.nd-set__preview')).map((e) => e.textContent ?? '');
    expect(previews.some((t) => /Looks like:\s*MIC-/.test(t))).toBe(true);
    expect(previews.some((t) => /Looks like:\s*LAB-/.test(t))).toBe(true);
    const sws = Array.from(p.el.querySelectorAll<HTMLButtonElement>('.nd-toggle[role="switch"]'));
    expect(sws.length).toBeGreaterThanOrEqual(3);
    for (const sw of sws) {
      const lid = sw.getAttribute('aria-labelledby');
      expect(lid && p.el.querySelector(`#${lid}`)).toBeTruthy();
    }
    expect(p.el.querySelector('select, datalist')).toBeNull();
  });

  it('band Save is disabled until something changes, then saves only what changed', () => {
    const p = make();
    expect(bandSave(p).disabled).toBe(true);
    p.cmp.orgName.set('Micro World Labs');
    p.f.detectChanges();
    expect(bandSave(p).disabled).toBe(false);
    bandSave(p).click();
    expect(p.api.patch).toHaveBeenCalledWith('/api/tenants/current', { name: 'Micro World Labs' });
    expect(p.api.patch).toHaveBeenCalledTimes(1);
    expect(p.api.post).not.toHaveBeenCalled();
  });

  it('a changed sample format saves just that format', () => {
    const p = make();
    p.cmp.sampleFmt.sep.set('/');
    p.f.detectChanges();
    bandSave(p).click();
    const posts = p.api.post.mock.calls.map((c: any[]) => c[0]);
    expect(posts).toEqual(['/api/config/sample-id']);
  });
});

describe('Flat admin page — Appointments & queue', () => {
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

  it('no pill tabs; the page name is the pill h1', () => expectFlat(make(), 'Appointments & queue'));

  it('every section renders at once; every anchor exists', () => {
    const p = make();
    expect(secTitles(p)).toEqual(['Queue', 'Booking', 'Who goes next']);
    for (const id of ['queue-mode', 'booking-slots', 'priority']) {
      expect(p.el.querySelector(`#${id}.nd-set`)).not.toBeNull();
    }
    expect(p.el.querySelectorAll('#priority pf-number-input').length).toBe(9);
  });

  it('queue type is a real radiogroup (role=radio, aria-checked, labelled)', () => {
    const p = make();
    const group = p.el.querySelector('#queue-mode [role="radiogroup"]')!;
    expect(group).not.toBeNull();
    expect(group.getAttribute('aria-labelledby')).toBe('queue-mode-l');
    const radios = Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual(['Token', 'Walk-in', 'Home visits']);
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    radios[1].click();
    p.f.detectChanges();
    expect(p.cmp.cfg().queueMode).toBe('walk_up');
    expect(p.el.querySelector('#queue-mode .nd-set__help')?.textContent).toContain('No tokens');
  });

  it('Open all day is a slate switch; off shows the opening hours', () => {
    const p = make();
    const sw = p.el.querySelector<HTMLButtonElement>('.nd-toggle[role="switch"]')!;
    expect(sw.getAttribute('aria-checked')).toBe('true');
    sw.click(); p.f.detectChanges();
    expect(p.el.querySelectorAll('input[type="time"].nd-input').length).toBe(2);
  });

  it('band Save saves the config once', () => {
    const p = make();
    const save = p.actions().find((b) => b.textContent?.includes('Save'))!;
    save.click();
    expect(p.svc.saveConfig).toHaveBeenCalledTimes(1);
  });
});
