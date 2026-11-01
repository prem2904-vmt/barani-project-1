import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from '../../core/auth/auth.service';
import { DialogService } from '../../core/services/dialog.service';
import { NavBackService } from '../../core/services/nav-back.service';
import { TenantStateService } from '../../core/services/tenant-state.service';
import { ThemeService } from '../../core/services/theme.service';
import { ToastService } from '../../core/services/toast.service';
import { AiConnectorApi, AiConnectorGrant, AiConnectorState, rememberAppName, rememberedAppName } from './ai-connector.api';
import { AiConnectorsSettingsPage } from './ai-connectors-settings.page';

/**
 * Security-review proof (feat/connector-grants): the app NAME kept in localStorage is UNTRUSTED (any app can register any
 * name with Supabase, and localStorage can be edited). It must only ever be shown as text — never interpreted as HTML —
 * and it must never decide anything (the server works on the client id alone).
 */
const ON: AiConnectorState = { enabled: true, connectorUrl: 'https://med-fetch-dev.prefrontal.health/mcp', labName: 'Micro World', proposals: true };
const G1: AiConnectorGrant = { clientId: '3f2b8c1e-5a4d-4e7f-9b21-0c6d8e1a2b3c', propose: true, createdAt: '2026-11-01T05:00:00Z', updatedAt: '2026-11-01T05:00:00Z' };
const EVIL = '<img src=x onerror="window.__pwned=1"><b>Claude</b>';

function setup(grants: AiConnectorGrant[]) {
  const api = {
    get: vi.fn(() => of(ON)),
    listGrants: vi.fn(() => of(grants)),
    deleteGrant: vi.fn(() => of({})),
    setPrivacyLevel: vi.fn(), setProposals: vi.fn(), setEnabled: vi.fn(),
  };
  const dialog = { confirm: vi.fn(async () => true) };
  const toasts = { success: vi.fn(), error: vi.fn() };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [AiConnectorsSettingsPage],
    providers: [
      provideRouter([]),
      { provide: AiConnectorApi, useValue: api },
      { provide: DialogService, useValue: dialog },
      { provide: ToastService, useValue: toasts },
      { provide: AuthService, useValue: { user: () => ({ id: 'u1', tenantName: 'Micro World' }), hasAnyPermission: () => true } },
      { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => true } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World' }) } },
      { provide: NavBackService, useValue: { showBack: () => true, back: vi.fn(), backTo: vi.fn() } },
    ],
  });
  const f = TestBed.createComponent(AiConnectorsSettingsPage);
  document.body.appendChild(f.nativeElement);
  return { f, api, dialog, toasts };
}

async function loaded(f: { nativeElement: HTMLElement; detectChanges(): void; whenStable(): Promise<unknown> }) {
  f.detectChanges();
  await new Promise(r => setTimeout(r, 650));
  for (let i = 0; i < 4; i++) { await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); }
  await f.whenStable();
  f.detectChanges();
  // The allowed-apps list lives on the main card's "Your apps" tab.
  const tab = f.nativeElement.querySelector('#pf-aic-tab-apps') as HTMLButtonElement | null;
  if (tab && tab.getAttribute('aria-selected') !== 'true') {
    tab.click();
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
  }
}

afterEach(() => { document.body.innerHTML = ''; localStorage.removeItem('pf.aic.appnames'); delete (window as unknown as { __pwned?: number }).__pwned; });

describe('connector grants: the remembered app name is display-only text', () => {
  it('an HTML payload stored as the app name renders as literal text — no element is created, nothing runs', async () => {
    rememberAppName(G1.clientId, EVIL);
    const { f } = setup([G1]);
    await loaded(f);
    const row = f.nativeElement.querySelector('.pf-aic__grant') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.querySelector('img')).toBeNull();
    expect(row.querySelector('b')).toBeNull();
    expect(row.querySelector('.pf-aic__grantname')?.textContent).toContain('<img src=x');
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    // the aria-label on Revoke carries the same text, as an attribute value only
    const btn = row.querySelector('.pf-aic__revoke') as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toContain('Revoke <img src=x');
  });

  it('the name goes to the confirm dialog and the toast as data (strings), and the server call uses ONLY the client id', async () => {
    rememberAppName(G1.clientId, EVIL);
    const { f, api, dialog, toasts } = setup([G1]);
    await loaded(f);
    (f.nativeElement.querySelector('.pf-aic__revoke') as HTMLButtonElement).click();
    await loaded(f);
    expect(dialog.confirm).toHaveBeenCalledTimes(1);
    const arg = (dialog.confirm.mock.calls[0] as unknown[])[0] as { title: string; message: string };
    expect(typeof arg.title).toBe('string');
    expect(arg.title).toContain(EVIL);
    expect(api.deleteGrant).toHaveBeenCalledWith(G1.clientId);
    expect(toasts.success).toHaveBeenCalledTimes(1);
    expect(String((toasts.success.mock.calls[0] as unknown[])[0])).toContain(EVIL);
  });

  it('garbage in localStorage never breaks the page: the list falls back to the generic label', async () => {
    localStorage.setItem('pf.aic.appnames', '{not json');
    expect(rememberedAppName(G1.clientId)).toBeNull();
    localStorage.setItem('pf.aic.appnames', JSON.stringify({ [G1.clientId]: { nested: true } }));
    expect(rememberedAppName(G1.clientId)).toBeNull();
    const { f } = setup([G1]);
    await loaded(f);
    expect(f.nativeElement.querySelector('.pf-aic__grantname')?.textContent).toContain('Connected app');
  });

  it('names are capped at 80 characters when remembered', () => {
    rememberAppName(G1.clientId, 'x'.repeat(500));
    expect(rememberedAppName(G1.clientId)?.length).toBe(80);
  });
});
