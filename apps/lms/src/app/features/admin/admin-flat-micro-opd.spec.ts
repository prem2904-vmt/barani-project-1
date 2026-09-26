import { vi } from 'vitest';
import { renderBandPage } from './admin-band.spec-helpers';
import { AuthService } from '../../core/auth/auth.service';
import { TenantStateService } from '../../core/services/tenant-state.service';
import { OpdSettingsComponent } from '../opd/admin/opd-settings.component';
import { CultureSettingsComponent } from '../lab/culture-settings/culture-settings.component';

/**
 * ND-PATTERN §19 "Admin pages" — Microbiology and OPD settings are ONE
 * scrolling page: no pill tabs, the pill names the page (h1.nd-band-page),
 * every section renders at once, search anchors are on the rows, and the
 * band Save PUTs exactly the same payload as before.
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

describe('Admin flat — Microbiology (/admin/microbiology)', () => {
  const settings = { lockTimeoutMinutes: 45, allowSupervisorTakeover: false, stageTats: [{ stageKey: 'gram', tatHours: 4 }] };
  const make = () => renderBandPage(CultureSettingsComponent, {
    getFor: (url) => (url === '/api/microbiology/settings' ? settings : {}),
    providers: [auth, tenantState],
  });

  it('no pill tabs; the pill carries the page h1', () => {
    const p = make();
    expect(p.bandInput()).toBeNull();
    expect(p.tools()!.querySelector('pf-segmented')).toBeNull();
    expect(p.el.querySelector('pf-hero-band h1.nd-band-page')?.textContent).toContain('Microbiology');
    expect(p.headerIsClassicOnly()).toBe(true);
  });

  it('both sections render at once with their search anchors', () => {
    const p = make();
    const secs = Array.from(p.body()!.querySelectorAll('section.nd-setsec')).map((s) => s.id);
    expect(secs).toEqual(['sec-lock', 'sec-tat']);
    expect(p.body()!.querySelector('#stage-lock.nd-set')).not.toBeNull();
    expect(p.body()!.querySelector('#turnaround.nd-set')).not.toBeNull();
    // Every input has a real label; the switch is named by its row label.
    for (const i of Array.from(p.body()!.querySelectorAll<HTMLInputElement>('input'))) {
      expect(p.body()!.querySelector(`label[for="${i.id}"]`)).not.toBeNull();
    }
    const sw = p.body()!.querySelector<HTMLButtonElement>('.nd-toggle[role="switch"]')!;
    const lbl = document.getElementById(sw.getAttribute('aria-labelledby')!);
    expect(lbl?.textContent).toContain('Supervisor can take over');
  });

  it('Save lives in the band actions and PUTs the same settings', () => {
    const p = make();
    const save = p.actions().find((b) => b.textContent?.includes('Save'));
    expect(save).toBeTruthy();
    save!.click();
    expect(p.api.put).toHaveBeenCalledWith('/api/microbiology/settings', settings);
  });
});

describe('Admin flat — OPD settings (/admin/opd/settings)', () => {
  const make = (followUpMode = 'auto') => renderBandPage(OpdSettingsComponent, {
    getFor: (url) => (url === '/api/opd/settings'
      ? { followUpMode, tiers: [{ withinDays: 7, discountPercent: 100 }] } : {}),
    providers: [auth, tenantState],
  });
  const radios = (p: ReturnType<typeof make>) =>
    Array.from(p.body()!.querySelectorAll<HTMLButtonElement>('#follow-up [role="radiogroup"] [role="radio"]'));

  it('no pill tabs; the pill carries the page h1', () => {
    const p = make();
    expect(p.tools()!.querySelector('pf-segmented')).toBeNull();
    expect(p.el.querySelector('pf-hero-band h1.nd-band-page')?.textContent).toContain('OPD settings');
  });

  it('the mode is a radiogroup row (anchor follow-up) with 3 radios', () => {
    const p = make();
    const group = p.body()!.querySelector('#follow-up.nd-set [role="radiogroup"]')!;
    expect(group).not.toBeNull();
    expect(document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent).toContain('Follow-up discount');
    expect(radios(p).map((r) => r.getAttribute('aria-label'))).toEqual(['Off', 'Automatic', 'Assisted']);
    expect(radios(p).map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
  });

  it('picking Off hides the tiers; Assisted shows them again', () => {
    const p = make();
    expect(p.body()!.querySelector('#sec-tiers')).not.toBeNull();
    radios(p)[0].click(); p.f.detectChanges();
    expect(p.body()!.querySelector('#sec-tiers')).toBeNull();
    expect(radios(p)[0].getAttribute('aria-checked')).toBe('true');
    radios(p)[2].click(); p.f.detectChanges();
    expect(p.body()!.querySelector('#sec-tiers')).not.toBeNull();
  });

  it('Save lives in the band actions and PUTs the chosen mode', () => {
    const p = make();
    radios(p)[2].click(); p.f.detectChanges();
    const save = p.actions().find((b) => b.textContent?.includes('Save'));
    save!.click();
    expect(p.api.put).toHaveBeenCalledWith('/api/opd/settings',
      { followUpMode: 'assisted', tiers: [{ withinDays: 7, discountPercent: 100 }] });
  });
});
