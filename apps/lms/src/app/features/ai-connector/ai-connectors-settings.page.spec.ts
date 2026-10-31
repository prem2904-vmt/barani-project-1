import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from '../../core/auth/auth.service';
import { canOpenRoute } from '../../core/auth/route-access';
import { DialogService } from '../../core/services/dialog.service';
import { NavBackService } from '../../core/services/nav-back.service';
import { TenantStateService } from '../../core/services/tenant-state.service';
import { ThemeService } from '../../core/services/theme.service';
import { ToastService } from '../../core/services/toast.service';
import { ApiError } from '../../shared/models/api-response.model';
import { BetaFeaturesService } from '../../core/services/beta-features.service';
import { LabSettingsHubComponent } from '../lab/lab-settings-hub/lab-settings-hub.component';
import { AiConnectorApi, AiConnectorState } from './ai-connector.api';
import { AiConnectorsSettingsPage } from './ai-connectors-settings.page';

/**
 * Lab settings → AI connectors: the admin flips the lab switch (always asked
 * first, DialogService), copies the connector address and reads three
 * steps; anyone else sees the status only. The hub carries the tile.
 */
const OFF: AiConnectorState = { enabled: false, connectorUrl: 'https://med-fetch-dev.prefrontal.health/mcp', labName: 'Micro World' };

function setup(opts: { perms?: string[]; state?: AiConnectorState; confirm?: boolean; put?: () => ReturnType<AiConnectorApi['setEnabled']>; putLevel?: () => ReturnType<AiConnectorApi['setPrivacyLevel']> } = {}) {
  const perms = opts.perms ?? ['manage_lab_settings'];
  const api = {
    get: vi.fn(() => of(opts.state ?? OFF)),
    setPrivacyLevel: vi.fn(opts.putLevel ?? ((privacyLevel: string) => of({ ...(opts.state ?? OFF), privacyLevel }))),
    setEnabled: vi.fn(opts.put ?? ((enabled: boolean) => of({ ...(opts.state ?? OFF), enabled }))),
  };
  const dialog = { confirm: vi.fn(async () => opts.confirm ?? true) };
  const toasts = { success: vi.fn(), error: vi.fn() };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [AiConnectorsSettingsPage],
    providers: [
      provideRouter([]),
      { provide: AiConnectorApi, useValue: api },
      { provide: DialogService, useValue: dialog },
      { provide: ToastService, useValue: toasts },
      { provide: AuthService, useValue: {
        user: () => ({ id: 'u1', tenantName: 'Micro World' }),
        hasAnyPermission: (p: string[]) => perms.includes('*') || p.some(x => perms.includes(x)),
      } },
      { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => true } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World' }) } },
      { provide: NavBackService, useValue: { showBack: () => true, back: vi.fn(), backTo: vi.fn() } },
    ],
  });
  const f = TestBed.createComponent(AiConnectorsSettingsPage);
  document.body.appendChild(f.nativeElement);
  return { f, api, dialog, toasts };
}

/** The first load holds its skeleton MIN_LOAD_MS (600ms, PF-PATTERN) — wait it out once. */
async function loaded(f: { detectChanges(): void; whenStable(): Promise<unknown> }) {
  f.detectChanges();
  await new Promise(r => setTimeout(r, 650));
  await settle(f);
}

async function settle(f: { detectChanges(): void; whenStable(): Promise<unknown> }) {
  f.detectChanges();
  for (let i = 0; i < 4; i++) { await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); }
  await f.whenStable();
  f.detectChanges();
}
const sw = (f: { nativeElement: HTMLElement }) => f.nativeElement.querySelector('[role="switch"]') as HTMLButtonElement | null;

afterEach(() => { document.body.innerHTML = ''; vi.useRealTimers(); });

describe('AiConnectorsSettingsPage', () => {
  it('admin: the switch (off by default from the server), the connector address and three steps', async () => {
    const { f } = setup();
    await loaded(f);
    const s = sw(f)!;
    expect(s).toBeTruthy();
    expect(s.getAttribute('aria-checked')).toBe('false');
    expect(f.nativeElement.querySelector('#pf-aic-url')!.textContent!.trim()).toBe(OFF.connectorUrl);  // whole, never cut
    expect(f.nativeElement.querySelectorAll('.pf-aic__steps li')).toHaveLength(3);
    expect(f.nativeElement.textContent).toContain('Add custom connector');
  });

  it('turning ON asks first (DialogService) and only then PUTs {enabled:true}', async () => {
    const { f, api, dialog, toasts } = setup();
    await loaded(f);
    sw(f)!.click();
    await settle(f);
    expect(dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Turn on AI connectors?' }));
    expect(api.setEnabled).toHaveBeenCalledWith(true);
    expect(sw(f)!.getAttribute('aria-checked')).toBe('true');
    expect(toasts.success).toHaveBeenCalled();
  });

  it('cancelling the confirm changes nothing', async () => {
    const { f, api } = setup({ confirm: false });
    await loaded(f);
    sw(f)!.click();
    await settle(f);
    expect(api.setEnabled).not.toHaveBeenCalled();
    expect(sw(f)!.getAttribute('aria-checked')).toBe('false');
  });

  it('turning OFF asks with a danger confirm naming what stops', async () => {
    const { f, api, dialog } = setup({ state: { ...OFF, enabled: true } });
    await loaded(f);
    sw(f)!.click();
    await settle(f);
    expect(dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Turn off AI connectors?', tone: 'danger' }));
    expect(api.setEnabled).toHaveBeenCalledWith(false);
  });

  it('a refused save says who can change it, in words, and keeps the old state', async () => {
    const { f, toasts } = setup({ put: () => throwError(() => new ApiError('Forbidden', 'forbidden')) });
    await loaded(f);
    sw(f)!.click();
    await settle(f);
    expect(toasts.error).toHaveBeenCalledWith('Only a lab admin can change this.');
    expect(sw(f)!.getAttribute('aria-checked')).toBe('false');
  });

  it('non-admin: read-only status only — no switch, no address, no steps', async () => {
    const { f, api } = setup({ perms: ['manage_tests'], state: { ...OFF, enabled: true } });
    await loaded(f);
    expect(sw(f)).toBeNull();
    expect(f.nativeElement.querySelector('#pf-aic-url')).toBeNull();
    expect(f.nativeElement.querySelector('.pf-aic__steps')).toBeNull();
    expect(f.nativeElement.textContent).toContain('AI connectors are on for your lab.');
    expect(f.nativeElement.textContent).toContain('Only a lab admin can change this.');
    expect(api.setEnabled).not.toHaveBeenCalled();
  });

  it('Copy puts the address on the clipboard and says Copied', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { f } = setup();
    await loaded(f);
    (f.nativeElement.querySelector('.pf-aic__copy') as HTMLButtonElement).click();
    await settle(f);
    expect(writeText).toHaveBeenCalledWith(OFF.connectorUrl);
    expect(f.nativeElement.querySelector('.pf-aic__copy')!.textContent).toContain('Copied');
  });

  it('no native select / datalist; at most one primary', async () => {
    const { f } = setup();
    await loaded(f);
    expect(f.nativeElement.querySelector('select, datalist, input[list]')).toBeNull();
    expect(f.nativeElement.querySelectorAll('.pf-btn--primary').length).toBeLessThanOrEqual(1);
  });
});

describe('AiConnectorsSettingsPage privacy level', () => {
  const select = (f: { nativeElement: HTMLElement }) => f.nativeElement.querySelector('pf-select');

  it('defaults to Counts only, explains all three levels in plain words, admin gets a pf-select', async () => {
    const { f } = setup();
    await loaded(f);
    expect(select(f)).toBeTruthy();
    expect(f.nativeElement.querySelectorAll('.pf-aic__levels li')).toHaveLength(3);
    expect(f.nativeElement.querySelector('.pf-aic__levels li[data-current="true"]')!.textContent).toContain('Counts only');
    expect(f.nativeElement.textContent).toContain('never a name, phone or ID');
  });

  it('changing the level asks first and then PUTs only the level', async () => {
    const { f, api, dialog } = setup();
    await loaded(f);
    await f.componentInstance.changeLevel('results');
    await settle(f);
    expect(dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Change to “Results, patients as codes”?', tone: 'danger' }));
    expect(api.setPrivacyLevel).toHaveBeenCalledWith('results');
    expect(f.nativeElement.querySelector('.pf-aic__levels li[data-current="true"]')!.textContent).toContain('Results, patients as codes');
  });

  it('narrowing is a calm confirm; cancelling saves nothing', async () => {
    const wide = { ...OFF, privacyLevel: 'results_groups' as const };
    const a = setup({ state: wide });
    await loaded(a.f);
    await a.f.componentInstance.changeLevel('counts');
    expect(a.dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ tone: 'primary' }));
    expect(a.api.setPrivacyLevel).toHaveBeenCalledWith('counts');

    const b = setup({ confirm: false });
    await loaded(b.f);
    await b.f.componentInstance.changeLevel('results');
    expect(b.api.setPrivacyLevel).not.toHaveBeenCalled();
  });

  it('a refused save keeps the old level and says who can change it', async () => {
    const { f, toasts } = setup({ putLevel: () => throwError(() => new ApiError('Forbidden', 'forbidden')) });
    await loaded(f);
    await f.componentInstance.changeLevel('results');
    await settle(f);
    expect(toasts.error).toHaveBeenCalledWith('Only a lab admin can change this.');
    expect(f.componentInstance.level()).toBe('counts');
  });

  it('non-admin sees the current level as text, no select, and cannot change it', async () => {
    const { f, api } = setup({ perms: ['manage_tests'], state: { ...OFF, privacyLevel: 'results' } });
    await loaded(f);
    expect(select(f)).toBeNull();
    expect(f.nativeElement.textContent).toContain('Results, patients as codes');
    await f.componentInstance.changeLevel('results_groups');
    expect(api.setPrivacyLevel).not.toHaveBeenCalled();
  });

  it('an older server without the field is treated as Counts only', async () => {
    const { f } = setup({ state: { ...OFF } });
    await loaded(f);
    expect(f.componentInstance.level()).toBe('counts');
  });
});

describe('Lab settings hub → AI connectors tile', () => {
  function hub(betaOn: boolean) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [LabSettingsHubComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { hasAnyPermission: (p: string[]) => p.includes('manage_tests'), user: () => null } },
        { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => true } },
        { provide: TenantStateService, useValue: { tenant: signal(null) } },
        { provide: NavBackService, useValue: { showBack: () => true } },
        { provide: BetaFeaturesService, useValue: { enabled: (k: string) => betaOn && k === 'mcp' } },
      ],
    });
    const f = TestBed.createComponent(LabSettingsHubComponent);
    f.detectChanges();
    return f.componentInstance.visibleTiles().find(t => t.href === '/admin/ai-connectors');
  }

  it('BETA off (stage / prod / flag off) → no tile at all', () => {
    expect(hub(false)).toBeUndefined();
  });

  it('BETA on → the hub lists the tile for anyone who can open the hub; the route admits the same people', () => {
    const tile = hub(true);
    expect(tile?.title).toBe('AI connectors');
    expect(canOpenRoute('/admin/ai-connectors', { hasAny: p => p.includes('manage_tests') })).toBe(true);
    expect(canOpenRoute('/admin/ai-connectors', { hasAny: p => p.includes('register_patient') })).toBe(false);
  });
});
