import { Injectable, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { CurrentUser } from '../../../core/auth/mock-user';
import { ApiService } from '../../../core/services/api.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { CASESHEETS_FLAG_KEY } from './casesheet-gate';
import { CasesheetGateService } from './casesheet-gate.service';
import { casesheetGuard } from './casesheet.guard';

/**
 * Case sheets (part of IPD) — the gate wired into the app services. Closed for every lab today: the no-row
 * "all modules on" default, a legacy-flag tenant and a stored opd-only map never open it; only an EXPLICIT
 * ipd.enabled, a personal tenant or pf.casesheets() can — and never outside dev.
 */
let store: Record<string, string> = {};

@Injectable()
class NotDevGate extends CasesheetGateService {
  protected override isDev(): boolean { return false; }
}

function setup(opts: { flag?: boolean; modulesJson?: string | null; tenantKind?: string; signedIn?: boolean; notDev?: boolean } = {}) {
  store = opts.flag ? { [CASESHEETS_FLAG_KEY]: '1' } : {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
  });
  const user = signal<CurrentUser | null>(opts.signedIn === false ? null : {
    id: 'u1', firstName: 'A', fathersName: 'B', displayName: 'A B', tenantId: 't', tenantName: 'T',
    branchId: 'b', branchName: 'B', roles: ['Lab Admin'], permissions: ['*'],
    ...(opts.tenantKind ? { tenantKind: opts.tenantKind } : {}),
  });
  const api = {
    get: vi.fn(() => ({ subscribe: (o: { next: (v: unknown) => void }) => o.next({ modulesJson: opts.modulesJson ?? null, legacy: { inventory: true, messages: true, homeCollection: true, reports: true } }) })),
    put: vi.fn(),
  };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { user, waitForAuth: async () => undefined } },
      { provide: ApiService, useValue: api },
      { provide: Router, useValue: { createUrlTree: (c: unknown[]) => ({ bounced: c }) as unknown as UrlTree } },
      ...(opts.notDev ? [{ provide: CasesheetGateService, useClass: NotDevGate }] : []),
    ],
  });
  return { api };
}

async function visible(opts: Parameters<typeof setup>[0] = {}): Promise<boolean> {
  setup(opts);
  const gate = TestBed.inject(CasesheetGateService);
  await gate.ready();
  return gate.visible();
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('CasesheetGateService', () => {
  it('is closed for a lab with no module row (the "every module on" default never counts)', async () => {
    expect(await visible({ modulesJson: null })).toBe(false);
  });
  it('is closed when ipd is stored off, absent, or only opd is on', async () => {
    expect(await visible({ modulesJson: '{"ipd":{"enabled":false}}' })).toBe(false);
    expect(await visible({ modulesJson: '{"lab":{"enabled":true}}' })).toBe(false);
    expect(await visible({ modulesJson: '{"opd":{"enabled":true}}' })).toBe(false);
  });
  it('opens for a tenant that EXPLICITLY has ipd on', async () => {
    expect(await visible({ modulesJson: '{"ipd":{"enabled":true}}' })).toBe(true);
  });
  it('opens for a personal case-sheet tenant', async () => {
    expect(await visible({ tenantKind: 'personal' })).toBe(true);
    expect(await visible({ tenantKind: 'lab' })).toBe(false);
  });
  it('opens with pf.casesheets() in this browser', async () => {
    expect(await visible({ flag: true })).toBe(true);
  });
  it('never opens outside dev, whatever else holds', async () => {
    expect(await visible({ notDev: true, flag: true, tenantKind: 'personal', modulesJson: '{"ipd":{"enabled":true}}' })).toBe(false);
  });
  it('signed out: does not ask for the module map', async () => {
    const { api } = setup({ signedIn: false });
    await TestBed.inject(CasesheetGateService).ready();
    expect(api.get).not.toHaveBeenCalled();
  });
  it('a personal space never asks for the lab module map (the server fences /api/tenants/* for it)', async () => {
    const { api } = setup({ tenantKind: 'personal' });
    const gate = TestBed.inject(CasesheetGateService);
    await gate.ready();
    expect(gate.visible()).toBe(true);
    expect(api.get).not.toHaveBeenCalled();
  });
  it('opening the case-sheet gate does not switch the IPD module on for anything else', async () => {
    setup({ flag: true });
    const e = TestBed.inject(TenantEntitlementsService);
    await e.ensureLoaded();
    expect(TestBed.inject(CasesheetGateService).visible()).toBe(true);
    expect(e.moduleOn('ipd')).toBe(false);
  });
});

describe('casesheetGuard', () => {
  const run = () => TestBed.runInInjectionContext(() => casesheetGuard({} as never, {} as never)) as Promise<unknown>;
  it('gate closed ⇒ the unknown-URL bounce to "/" (never a 403)', async () => {
    setup({});
    expect(await run()).toEqual({ bounced: ['/'] });
  });
  it('gate open ⇒ admits', async () => {
    setup({ modulesJson: '{"ipd":{"enabled":true}}' });
    expect(await run()).toBe(true);
  });
  it('is marked for the route specs', () => {
    expect((casesheetGuard as unknown as { casesheetGate?: boolean }).casesheetGate).toBe(true);
  });
});
