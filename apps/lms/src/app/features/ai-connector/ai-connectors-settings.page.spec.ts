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
import { AI_CONNECTOR_CAN_SEE, AI_CONNECTOR_CAN_SUGGEST, AI_CONNECTOR_NEVER, AI_CONNECTOR_SUGGEST_REQUESTED, AI_PRIVACY_LEVELS, AiConnectorApi, AiConnectorGrant, AiConnectorState } from './ai-connector.api';
import { AiConnectorsSettingsPage } from './ai-connectors-settings.page';

/**
 * Lab settings → AI connectors: the admin flips the lab switch (always asked
 * first, DialogService), copies the connector address and reads three
 * steps; anyone else sees the status only. The hub carries the tile.
 */
const OFF: AiConnectorState = { enabled: false, connectorUrl: 'https://med-fetch-dev.prefrontal.health/mcp', labName: 'Micro World' };

function setup(opts: { grants?: AiConnectorGrant[]; deleteGrant?: () => ReturnType<AiConnectorApi['deleteGrant']>; perms?: string[]; state?: AiConnectorState; confirm?: boolean; putProposals?: () => ReturnType<AiConnectorApi['setProposals']>; put?: () => ReturnType<AiConnectorApi['setEnabled']>; putLevel?: () => ReturnType<AiConnectorApi['setPrivacyLevel']> } = {}) {
  const perms = opts.perms ?? ['manage_lab_settings'];
  const api = {
    get: vi.fn(() => of(opts.state ?? OFF)),
    listGrants: vi.fn(() => of(opts.grants ?? [])),
    deleteGrant: vi.fn(opts.deleteGrant ?? (() => of({}))),
    setPrivacyLevel: vi.fn(opts.putLevel ?? ((privacyLevel: string) => of({ ...(opts.state ?? OFF), privacyLevel }))),
    setProposals: vi.fn(opts.putProposals ?? ((proposals: boolean) => of({ ...(opts.state ?? OFF), proposals }))),
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
const suggestSw = (f: { nativeElement: HTMLElement }) => f.nativeElement.querySelector('#pf-aic-suggest') as HTMLButtonElement | null;

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

  it('shows what an app can read and suggest in six groups, with who each one is for, and the never-promise', async () => {
    const { f } = setup();
    await loaded(f);
    const groups = f.nativeElement.querySelectorAll('.pf-aic__grp');
    expect(groups).toHaveLength(6);
    const text = f.nativeElement.textContent ?? '';
    expect(text).toContain('Billing totals — only for people who see money');
    expect(text).toContain('Patient results as codes — only when your lab’s privacy level allows');
    expect(text).toContain('Work per staff member, shown as codes like T-1');
    expect(text).toContain('Suggested Test Master changes — only if your lab allows it');
    expect(text).toContain('Never patient or staff names, phone numbers, exact ages or ID numbers, and never a patient’s or staff member’s address');
  });

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

describe('AiConnectorsSettingsPage: let connected assistants suggest Test Master changes', () => {
  it('admin: a second switch, OFF by default, with the plain-words label and the read-only promise', async () => {
    const { f } = setup();
    await loaded(f);
    const s = suggestSw(f)!;
    expect(s).toBeTruthy();
    expect(s.getAttribute('role')).toBe('switch');
    expect(s.getAttribute('aria-checked')).toBe('false');
    const text = f.nativeElement.textContent ?? '';
    expect(text).toContain('Let connected assistants suggest Test Master changes');
    expect(text).toContain('Off — connected assistants can read, but can’t suggest any changes.');
    expect(text).toContain('Read only — an app can’t add, change or delete anything');
  });

  it('turning it ON asks first, explains the inbox, and PUTs only {proposals:true}', async () => {
    const { f, api, dialog, toasts } = setup();
    await loaded(f);
    suggestSw(f)!.click();
    await settle(f);
    expect(dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Let connected assistants suggest changes?', tone: 'primary',
      message: expect.stringContaining('Pending changes') }));
    expect(api.setProposals).toHaveBeenCalledWith(true);
    expect(api.setEnabled).not.toHaveBeenCalled();
    expect(suggestSw(f)!.getAttribute('aria-checked')).toBe('true');
    expect(f.nativeElement.textContent).toContain('someone with Test Master permission approves it');
    expect(f.nativeElement.textContent).toContain('An app can read, and suggest Test Master changes for your approval.');
    expect(f.nativeElement.textContent).not.toContain('Read only — an app can’t add');
    expect(toasts.success).toHaveBeenCalled();
  });

  it('turning the master switch OFF says every app permission is removed', async () => {
    const a = setup({ state: { ...OFF, enabled: true } });
    await loaded(a.f);
    expect(a.f.nativeElement.textContent).toContain('Turning this off removes every app’s permission to suggest. People will need to allow it again.');
    sw(a.f)!.click();
    await settle(a.f);
    const arg = (a.dialog.confirm.mock.calls as unknown as Array<[{ message: string }]>)[0][0];
    expect(arg.message).toContain('Turning this off removes every app’s permission to suggest. People will need to allow it again.');
  });

  it('the OFF confirm and the switch text say plainly that every app permission is removed', async () => {
    const a = setup({ state: { ...OFF, proposals: true } });
    await loaded(a.f);
    expect(a.f.nativeElement.textContent).toContain('Turning this off removes every app’s permission to suggest; people will need to allow it again.');
    suggestSw(a.f)!.click();
    await settle(a.f);
    const arg = (a.dialog.confirm.mock.calls as unknown as Array<[{ message: string }]>)[0][0];
    expect(arg.message).toContain('Turning this off removes every app’s permission to suggest; people will need to allow it again.');
  });

  it('turning it OFF is a danger confirm; cancelling changes nothing', async () => {
    const a = setup({ state: { ...OFF, proposals: true } });
    await loaded(a.f);
    suggestSw(a.f)!.click();
    await settle(a.f);
    expect(a.dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Stop assistants suggesting changes?', tone: 'danger' }));
    expect(a.api.setProposals).toHaveBeenCalledWith(false);
    const b = setup({ confirm: false });
    await loaded(b.f);
    suggestSw(b.f)!.click();
    await settle(b.f);
    expect(b.api.setProposals).not.toHaveBeenCalled();
    expect(suggestSw(b.f)!.getAttribute('aria-checked')).toBe('false');
  });

  it('a refused save says who can change it and keeps it off', async () => {
    const { f, toasts } = setup({ putProposals: () => throwError(() => new ApiError('Forbidden', 'forbidden')) });
    await loaded(f);
    suggestSw(f)!.click();
    await settle(f);
    expect(toasts.error).toHaveBeenCalledWith('Only a lab admin can change this.');
    expect(suggestSw(f)!.getAttribute('aria-checked')).toBe('false');
  });

  it('non-admin: sees the state as text only — no switch, cannot change it', async () => {
    const { f, api } = setup({ perms: ['manage_tests'], state: { ...OFF, proposals: true } });
    await loaded(f);
    expect(suggestSw(f)).toBeNull();
    expect(f.nativeElement.textContent).toContain('Connected assistants can suggest Test Master changes.');
    await f.componentInstance.toggleProposals();
    expect(api.setProposals).not.toHaveBeenCalled();
  });

  it('an older server without the field is treated as off', async () => {
    const { f } = setup({ state: { ...OFF } });
    await loaded(f);
    expect(suggestSw(f)!.getAttribute('aria-checked')).toBe('false');
  });

  it('copy shared with the consent screen never says an app only reads when suggestions are allowed', () => {
    expect(AI_CONNECTOR_SUGGEST_REQUESTED).toContain('Nothing is applied until someone with Test Master permission approves it in Prefrontal.');
    expect(JSON.stringify([...AI_CONNECTOR_CAN_SEE, AI_CONNECTOR_CAN_SUGGEST])).not.toMatch(/read-only|read only/i);
    expect(AI_CONNECTOR_NEVER).toContain('can never approve or apply a change');
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

  it('words the privacy levels and the never-line exactly as the server behaves (age groups only, no sex; addresses of people never)', () => {
    expect(AI_PRIVACY_LEVELS.map(l => l.label)).toEqual(['Counts only', 'Results, patients as codes', 'Results, with age groups']);
    expect(JSON.stringify(AI_PRIVACY_LEVELS)).not.toMatch(/\bsex\b/i);
    expect(AI_CONNECTOR_NEVER).toContain('never a patient’s or staff member’s address');
    expect(AI_CONNECTOR_NEVER).not.toContain('addresses,');
  });
});

describe('AiConnectorsSettingsPage: apps you have allowed to suggest changes', () => {
  const ON: AiConnectorState = { ...OFF, enabled: true, proposals: true };
  const G1: AiConnectorGrant = { clientId: '3f2b8c1e-5a4d-4e7f-9b21-0c6d8e1a2b3c', propose: true, createdAt: '2026-11-01T05:00:00Z', updatedAt: '2026-11-01T05:00:00Z' };
  const G2: AiConnectorGrant = { clientId: '9a8b7c6d-1111-4222-8333-444455556666', propose: true, createdAt: '2026-10-30T05:00:00Z', updatedAt: '2026-10-30T05:00:00Z' };
  const rows = (f: { nativeElement: HTMLElement }) => Array.from(f.nativeElement.querySelectorAll('.pf-aic__grant')) as HTMLElement[];
  const revokeBtn = (row: HTMLElement) => row.querySelector('.pf-aic__revoke') as HTMLButtonElement;

  afterEach(() => localStorage.removeItem('pf.aic.appnames'));

  it('lists the person’s own apps (name when remembered, else a generic label + short id) with a Revoke button each', async () => {
    localStorage.setItem('pf.aic.appnames', JSON.stringify({ [G1.clientId]: 'Claude' }));
    const { f, api } = setup({ state: ON, grants: [G1, G2] });
    await loaded(f);
    expect(api.listGrants).toHaveBeenCalled();
    const r = rows(f);
    expect(r).toHaveLength(2);
    expect(r[0].textContent).toContain('Claude');
    expect(r[0].textContent).toContain('…1a2b3c');
    expect(r[1].textContent).toContain('Connected app');
    expect(r.every(x => revokeBtn(x).textContent?.trim() === 'Revoke')).toBe(true);
    expect(f.nativeElement.textContent).toContain('Only your own apps are listed.');
  });

  it('Revoke asks first (danger), then DELETEs that one app and drops it from the list', async () => {
    const { f, api, dialog, toasts } = setup({ state: ON, grants: [G1, G2] });
    await loaded(f);
    revokeBtn(rows(f)[0]).click();
    await settle(f);
    expect(dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger', confirmLabel: 'Revoke' }));
    expect(api.deleteGrant).toHaveBeenCalledWith(G1.clientId);
    expect(rows(f)).toHaveLength(1);
    expect(toasts.success).toHaveBeenCalled();
  });

  it('cancelling the confirm revokes nothing; a failed revoke keeps the row and says so', async () => {
    const a = setup({ state: ON, grants: [G1], confirm: false });
    await loaded(a.f);
    revokeBtn(rows(a.f)[0]).click(); await settle(a.f);
    expect(a.api.deleteGrant).not.toHaveBeenCalled();
    expect(rows(a.f)).toHaveLength(1);
    const b = setup({ state: ON, grants: [G1], deleteGrant: () => throwError(() => new Error('x')) });
    await loaded(b.f);
    revokeBtn(rows(b.f)[0]).click(); await settle(b.f);
    expect(rows(b.f)).toHaveLength(1);
    expect(b.toasts.error).toHaveBeenCalled();
  });

  it('shows an honest empty line when the lab allows suggestions and nobody allowed an app; hides the block when both are off', async () => {
    const a = setup({ state: ON, grants: [] });
    await loaded(a.f);
    expect(a.f.nativeElement.textContent).toContain('No app can suggest Test Master changes with your account.');
    expect(rows(a.f)).toHaveLength(0);
    const b = setup({ state: { ...ON, proposals: false }, grants: [] });
    await loaded(b.f);
    expect(b.f.nativeElement.textContent).not.toContain('Apps you’ve allowed to suggest changes');
    // an old grant stays visible (and revocable) even after the lab switch is turned off
    const c = setup({ state: { ...ON, proposals: false }, grants: [G1] });
    await loaded(c.f);
    expect(rows(c.f)).toHaveLength(1);
  });
});
