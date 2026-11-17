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
import { SETTINGS_SECTIONS } from '../admin/settings/settings-map';
import { AI_CONNECTOR_CAN_SEE, AI_CONNECTOR_CAN_SUGGEST, AI_CONNECTOR_NEVER, AI_CONNECTOR_NEVER_ITEMS, AI_CONNECTOR_SUGGEST_OFF_EFFECT, AI_CONNECTOR_SUGGEST_REQUESTED, AI_PRIVACY_LEVELS, AiConnectorApi, AiConnectorGrant, AiConnectorState } from './ai-connector.api';
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
  const dialog = { confirm: vi.fn(async () => opts.confirm ?? true), alert: vi.fn(async () => undefined) };
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
const tabBtn = (f: { nativeElement: HTMLElement }, id: 'settings' | 'can' | 'apps' | 'claude') => f.nativeElement.querySelector(`#pf-aic-tab-${id}`) as HTMLButtonElement | null;
/** Open one of the main card's tabs (Settings is open by default). */
async function openTab(f: { nativeElement: HTMLElement; detectChanges(): void; whenStable(): Promise<unknown> }, id: 'settings' | 'can' | 'apps' | 'claude') {
  tabBtn(f, id)!.click();
  await settle(f);
}

afterEach(() => { document.body.innerHTML = ''; vi.useRealTimers(); });

describe('AiConnectorsSettingsPage', () => {
  it('admin: the switch (off by default from the server), the connector address and three steps', async () => {
    const { f } = setup();
    await loaded(f);
    const s = sw(f)!;
    expect(s).toBeTruthy();
    expect(s.getAttribute('aria-checked')).toBe('false');
    await openTab(f, 'claude');   // Connect Claude is its own category (owner: no side card)
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
    expect(f.nativeElement.textContent).toContain('Only a lab admin can change these.');
    expect(api.setEnabled).not.toHaveBeenCalled();
  });

  it('Copy puts the address on the clipboard and says Copied', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { f } = setup();
    await loaded(f);
    await openTab(f, 'claude');
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

  it('“What apps see” is a compact Can / Never list: six groups (who each is for + one short line) and the never lines', async () => {
    const { f } = setup();
    await loaded(f);
    expect(f.nativeElement.querySelectorAll('.pf-aic__grp')).toHaveLength(0);   // not on the Settings tab
    await openTab(f, 'can');
    expect(tabBtn(f, 'can')!.getAttribute('aria-selected')).toBe('true');
    const groups = f.nativeElement.querySelectorAll('.pf-aic__grp');
    expect(groups).toHaveLength(6);
    const text = f.nativeElement.textContent ?? '';
    expect(text).toContain('Billing totals — only for people who see money');
    expect(text).toContain('Patient results as codes — only when your lab’s privacy level allows');
    expect(text).toContain('Suggested Test Master changes — only if your lab allows it');
    expect(text).toContain('Results and report status, each patient as a code');
    const never = Array.from(f.nativeElement.querySelectorAll('.pf-aic__never li')).map(li => (li as HTMLElement).textContent!.trim());
    expect(never).toEqual([...AI_CONNECTOR_NEVER_ITEMS]);
    expect(text).toContain('Patient or staff names');
    expect(text).toContain('Approve or apply a change by itself');
  });

  it('“See the full list” opens the full wording (every item of every group + the never-promise) in a DialogService notice', async () => {
    const { f, dialog } = setup();
    await loaded(f);
    await openTab(f, 'can');
    const btn = Array.from(f.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(b => b.textContent?.trim() === 'See the full list') as HTMLButtonElement;
    btn.click();
    await settle(f);
    const req = (dialog.alert.mock.calls[0] as unknown as [{ title: string; message: string; items: string[] }])[0];
    expect(req.message).toContain('Never patient or staff names, phone numbers, exact ages or ID numbers, and never a patient’s or staff member’s address');
    const total = [...AI_CONNECTOR_CAN_SEE, AI_CONNECTOR_CAN_SUGGEST].reduce((n, g) => n + g.items.length, 0);
    expect(req.items).toHaveLength(total);
    expect(req.items.some(i => i.includes('Work per staff member, shown as codes like T-1'))).toBe(true);
    expect(req.items.some(i => i.startsWith('Billing totals (only for people who see money): '))).toBe(true);
  });

  it('the never short lines keep every promise of the full never-sentence', () => {
    const joined = AI_CONNECTOR_NEVER_ITEMS.join(' ').toLowerCase();
    for (const w of ['names', 'phone', 'exact ages', 'id numbers', 'address', 'fewer than 5', 'approve or apply']) expect(joined).toContain(w);
  });

  it('defaults to Counts only, says what it means, admin gets a pf-select; “Compare the levels” explains all three', async () => {
    const { f, dialog } = setup();
    await loaded(f);
    expect(select(f)).toBeTruthy();
    expect(f.nativeElement.querySelector('.pf-aic__levelhint')!.textContent).toContain(AI_PRIVACY_LEVELS[0].summary);
    expect(f.nativeElement.textContent).toContain('never a name, phone or ID');
    const btn = Array.from(f.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(b => b.textContent?.trim() === 'Compare the levels') as HTMLButtonElement;
    btn.click();
    await settle(f);
    const req = (dialog.alert.mock.calls[0] as unknown as [{ message: string; items: string[] }])[0];
    expect(req.items).toHaveLength(3);
    expect(req.items[0]).toBe(`Counts only: ${AI_PRIVACY_LEVELS[0].summary}`);
    expect(req.message).toContain('Your lab is on “Counts only”');
    expect(dialog.confirm).not.toHaveBeenCalled();
  });

  it('changing the level asks first and then PUTs only the level', async () => {
    const { f, api, dialog } = setup();
    await loaded(f);
    await f.componentInstance.changeLevel('results');
    await settle(f);
    expect(dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Change to “Results, patients as codes”?', tone: 'danger' }));
    expect(api.setPrivacyLevel).toHaveBeenCalledWith('results');
    expect(f.nativeElement.querySelector('.pf-aic__levelhint')!.textContent).toContain(AI_PRIVACY_LEVELS[1].summary);
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
    expect(f.nativeElement.textContent).toContain('Turning this off removes every app’s permission to suggest. People will need to allow it again.');
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
    expect(a.f.nativeElement.textContent).toContain('Turning this off removes every app’s permission to suggest. People will need to allow it again.');
    suggestSw(a.f)!.click();
    await settle(a.f);
    const arg = (a.dialog.confirm.mock.calls as unknown as Array<[{ message: string }]>)[0][0];
    expect(arg.message).toContain('Turning this off removes every app’s permission to suggest. People will need to allow it again.');
  });

  it('turning it OFF is a danger confirm; cancelling changes nothing', async () => {
    const a = setup({ state: { ...OFF, proposals: true } });
    await loaded(a.f);
    suggestSw(a.f)!.click();
    await settle(a.f);
    expect(a.dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Stop assistants suggesting changes?', tone: 'danger',
      message: expect.stringContaining('Turning this off removes every app’s permission to suggest. People will need to allow it again.') }));
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
    expect(AI_CONNECTOR_SUGGEST_REQUESTED).toContain('Nothing is applied until someone with permission approves it in Prefrontal.');
    expect(AI_CONNECTOR_SUGGEST_REQUESTED).toContain('Test Master and case sheets');
    expect(JSON.stringify([...AI_CONNECTOR_CAN_SEE, AI_CONNECTOR_CAN_SUGGEST])).not.toMatch(/read-only|read only/i);
    expect(AI_CONNECTOR_NEVER).toContain('can never approve or apply a change');
  });
});

describe('Settings → Organization › Connected apps → Cortex connectors tile', () => {
  const item = SETTINGS_SECTIONS.find((x) => x.id === 'connected')!.items[0];

  it('the tile is a BETA surface (mcp) on /admin/ai-connectors — off means no tile at all', () => {
    expect(item.path).toBe('/admin/ai-connectors');
    expect(item.beta).toBe('mcp');
    expect(item.label).toBe('Cortex connectors');
  });

  it('the route admits anyone who can open Settings\' lab hub perms; the switch inside stays admin-only', () => {
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
    expect(tabBtn(f, 'apps')!.textContent).toContain('2');
    await openTab(f, 'apps');
    const r = rows(f);
    expect(r).toHaveLength(2);
    expect(r[0].textContent).toContain('Claude');
    expect(r[0].textContent).toContain('…1a2b3c');
    expect(r[1].textContent).toContain('Connected app');
    expect(r.every(x => revokeBtn(x).textContent?.trim() === 'Revoke')).toBe(true);
    expect(f.nativeElement.textContent).toContain('Only your own apps are listed.');
  });

  it('"Your apps" shows when the server offers the grant for case sheets only (offerAppGrant)', async () => {
    const { f } = setup({ state: { ...ON, proposals: false, caseSheetBuild: true, offerAppGrant: true }, grants: [] });
    await loaded(f);
    expect(tabBtn(f, 'apps')).not.toBeNull();
  });

  it('each allowed app says what the ONE grant covers: Test Master and case sheet suggestions', async () => {
    const { f } = setup({ state: ON, grants: [G1] });
    await loaded(f);
    await openTab(f, 'apps');
    expect(rows(f)[0].querySelector('[data-grant-label]')!.textContent).toContain('Can suggest Test Master and case sheet changes');
  });

  it('Revoke asks first (danger), then DELETEs that one app and drops it from the list', async () => {
    const { f, api, dialog, toasts } = setup({ state: ON, grants: [G1, G2] });
    await loaded(f);
    await openTab(f, 'apps');
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
    await openTab(a.f, 'apps');
    revokeBtn(rows(a.f)[0]).click(); await settle(a.f);
    expect(a.api.deleteGrant).not.toHaveBeenCalled();
    expect(rows(a.f)).toHaveLength(1);
    const b = setup({ state: ON, grants: [G1], deleteGrant: () => throwError(() => new Error('x')) });
    await loaded(b.f);
    await openTab(b.f, 'apps');
    revokeBtn(rows(b.f)[0]).click(); await settle(b.f);
    expect(rows(b.f)).toHaveLength(1);
    expect(b.toasts.error).toHaveBeenCalled();
  });

  it('turning suggestions off (or the master switch off) clears the app list at once', async () => {
    const a = setup({ state: ON, grants: [G1] });
    await loaded(a.f);
    expect((a.f.componentInstance as unknown as { grants: () => unknown[] }).grants()).toHaveLength(1);
    suggestSw(a.f)!.click();
    await settle(a.f);
    expect((a.f.componentInstance as unknown as { grants: () => unknown[] }).grants()).toHaveLength(0);
    const b = setup({ state: ON, grants: [G1] });
    await loaded(b.f);
    sw(b.f)!.click();
    await settle(b.f);
    expect((b.f.componentInstance as unknown as { grants: () => unknown[] }).grants()).toHaveLength(0);
  });

  it('shows an honest empty line when the lab allows suggestions and nobody allowed an app; hides the block when both are off', async () => {
    const a = setup({ state: ON, grants: [] });
    await loaded(a.f);
    await openTab(a.f, 'apps');
    expect(a.f.nativeElement.textContent).toContain('No app can suggest Test Master or case sheet changes with your account.');
    expect(rows(a.f)).toHaveLength(0);
    const b = setup({ state: { ...ON, proposals: false }, grants: [] });
    await loaded(b.f);
    expect(tabBtn(b.f, 'apps')).toBeNull();
    expect(b.f.nativeElement.textContent).not.toContain('Apps you’ve allowed to suggest changes');
    // an old grant stays visible (and revocable) even after the lab switch is turned off
    const c = setup({ state: { ...ON, proposals: false }, grants: [G1] });
    await loaded(c.f);
    await openTab(c.f, 'apps');
    expect(rows(c.f)).toHaveLength(1);
  });
});

describe('AiConnectorsSettingsPage: tabs instead of one long page', () => {
  const ON: AiConnectorState = { ...OFF, enabled: true, proposals: true };
  const G1: AiConnectorGrant = { clientId: '3f2b8c1e-5a4d-4e7f-9b21-0c6d8e1a2b3c', propose: true, createdAt: '2026-11-01T05:00:00Z', updatedAt: '2026-11-01T05:00:00Z' };

  it('Settings is open by default; tabs are a labelled tablist with one selected tab and one tabpanel', async () => {
    const { f } = setup({ state: ON, grants: [G1] });
    await loaded(f);
    const list = f.nativeElement.querySelector('[role="tablist"]')!;
    expect(list.getAttribute('aria-label')).toBe('AI connector sections');
    const tabs = Array.from(list.querySelectorAll('[role="tab"]')) as HTMLElement[];
    expect(tabs.map(t => t.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['Settings', 'What apps see', 'Your apps1', 'Connect Claude']);
    expect(tabs.filter(t => t.getAttribute('aria-selected') === 'true')).toHaveLength(1);
    expect(f.nativeElement.querySelectorAll('[role="tabpanel"]')).toHaveLength(1);
    expect(f.nativeElement.querySelector('[role="tabpanel"]')!.getAttribute('aria-labelledby')).toBe('pf-aic-tab-settings');
    expect(sw(f)).toBeTruthy();
  });

  it('“Your apps” falls back to Settings when its tab goes away (last grant revoked while suggestions are off)', async () => {
    const { f } = setup({ state: { ...ON, proposals: false }, grants: [G1] });
    await loaded(f);
    await openTab(f, 'apps');
    expect(f.componentInstance.tab()).toBe('apps');
    (f.nativeElement.querySelector('.pf-aic__revoke') as HTMLButtonElement).click();
    await settle(f);
    expect(tabBtn(f, 'apps')).toBeNull();
    expect(f.componentInstance.tab()).toBe('settings');
    expect(sw(f)).toBeTruthy();
  });

  it('Connect Claude is a category (admin): the address + Copy and the steps, no side card; the two notes are ONE muted line', async () => {
    const { f } = setup({ state: ON, grants: [G1] });
    await loaded(f);
    expect(f.nativeElement.querySelector('.pf-aic__side, aside.pf-card')).toBeNull();
    expect(f.nativeElement.querySelectorAll('[data-testid="aic-note"]')).toHaveLength(1);
    expect(f.nativeElement.querySelector('.pf-card .pf-card')).toBeNull();   // never card-in-card
    await openTab(f, 'claude');
    expect(f.nativeElement.querySelector('#pf-aic-url')).toBeTruthy();
    expect(f.nativeElement.querySelectorAll('.pf-aic__steps li')).toHaveLength(3);
  });

  it('the suggest-off helper and confirm share ONE sentence (owner rule)', () => {
    expect(AI_CONNECTOR_SUGGEST_OFF_EFFECT).toBe('Turning this off removes every app’s permission to suggest. People will need to allow it again.');
  });
});
