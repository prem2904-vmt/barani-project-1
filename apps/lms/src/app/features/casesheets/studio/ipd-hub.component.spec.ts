import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { CasesheetGateService } from '../shared/casesheet-gate.service';
import { IpdHubComponent } from './ipd-hub.component';
import { PrepareSwitchApi } from '../data/prepare-switch-api';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { ToastService } from '../../../core/services/toast.service';
import { vi } from 'vitest';

function render(opts: { gate: boolean; perms: string[]; prepare?: { enabled: boolean; canChange: boolean }; fail?: boolean }) {
  const prepareApi = {
    get: vi.fn(async () => opts.prepare ?? { enabled: true, canChange: true }),
    set: vi.fn(async (enabled: boolean) => { if (opts.fail) throw new Error('x'); return { enabled, canChange: true }; }),
  };
  const refresh = vi.fn();
  const toasts = { success: vi.fn(), error: vi.fn() };
  const noop = (): void => undefined;
  (window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop });
  document.documentElement.classList.add('design-new');
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [IpdHubComponent],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { data: { moduleId: 'ipd' } } } },
      { provide: CasesheetGateService, useValue: { visible: signal(opts.gate), prepareOn: signal(opts.gate), ready: async () => {} } },
      { provide: AuthService, useValue: { hasPermission: (c: string) => opts.perms.includes(c), user: signal(null) } },
      { provide: PrepareSwitchApi, useValue: prepareApi },
      { provide: TenantEntitlementsService, useValue: { refresh } },
      { provide: ToastService, useValue: toasts },
    ],
  });
  const f = TestBed.createComponent(IpdHubComponent);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  return Object.assign(el, { f, prepareApi, refresh, toasts });
}

const settle = async (el: HTMLElement & { f: { detectChanges(): void; whenStable(): Promise<unknown> } }) => {
  await new Promise(r => setTimeout(r, 0));
  await el.f.whenStable();
  el.f.detectChanges();
};

describe('/admin/ipd hub — the Prepare switch (owner 2026-11-11)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('an IPD lab admin sees the switch; turning it off saves, refreshes the nav gate and says so', async () => {
    const el = render({ gate: true, perms: ['casesheet_forms_manage'] });
    await settle(el);
    const card = el.querySelector('[data-prepare-switch]')!;
    expect(card).not.toBeNull();
    expect(card.textContent).toContain('Prepare tab next to Frontdesk');
    (card.querySelector('button[role="switch"]') as HTMLButtonElement).click();
    await settle(el);
    expect(el.prepareApi.set).toHaveBeenCalledWith(false);
    expect(el.refresh).toHaveBeenCalled();
    expect(el.toasts.success).toHaveBeenCalledWith('Prepare is off');
    expect(el.querySelector('[data-prepare-switch]')!.textContent).toContain('cannot start new case sheets');
  });

  it('a failed save puts the switch back and says so', async () => {
    const el = render({ gate: true, perms: ['casesheet_forms_manage'], fail: true });
    await settle(el);
    (el.querySelector('[data-prepare-switch] button[role="switch"]') as HTMLButtonElement).click();
    await settle(el);
    expect(el.toasts.error).toHaveBeenCalled();
    expect(el.querySelector('button[role="switch"]')!.getAttribute('aria-checked')).toBe('true');
  });

  it('not entitled (console preview / personal space): no switch', async () => {
    const el = render({ gate: true, perms: ['casesheet_forms_manage'], prepare: { enabled: true, canChange: false } });
    await settle(el);
    expect(el.querySelector('[data-prepare-switch]')).toBeNull();
  });

  it('gate closed: the API is never asked', async () => {
    const el = render({ gate: false, perms: ['casesheet_forms_manage'] });
    await settle(el);
    expect(el.prepareApi.get).not.toHaveBeenCalled();
  });
});

describe('/admin/ipd hub', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('gate open + casesheet_forms_manage: the MyPrefrontal tile links to the studio, beside the IPD coming-soon tile', () => {
    const el = render({ gate: true, perms: ['casesheet_forms_manage'] });
    const tile = el.querySelector('a[data-tile="MyPrefrontal"]') as HTMLAnchorElement;
    expect(tile).not.toBeNull();
    expect(tile.getAttribute('href')).toBe('/admin/ipd/myprefrontal');
    const soon = el.querySelector('[data-tile="IPD"]')!;
    expect(soon.tagName).not.toBe('A');
    expect(soon.textContent).toContain('Coming soon');
    expect(el.querySelector('pf-module-placeholder')).toBeNull();
  });

  it('gate closed: exactly the old module placeholder, no MyPrefrontal anywhere', () => {
    const el = render({ gate: false, perms: ['casesheet_forms_manage'] });
    expect(el.querySelector('pf-module-placeholder')).not.toBeNull();
    expect(el.querySelector('[data-tile]')).toBeNull();
    expect(el.textContent).not.toContain('MyPrefrontal');
  });

  it('gate open but no casesheet_forms_manage: still the placeholder, no tile', () => {
    const el = render({ gate: true, perms: [] });
    expect(el.querySelector('pf-module-placeholder')).not.toBeNull();
    expect(el.querySelector('[data-tile="MyPrefrontal"]')).toBeNull();
  });
});
