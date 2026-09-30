import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { CurrentUser } from '../../../core/auth/mock-user';
import { ApiService } from '../../../core/services/api.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ModuleScopeService } from '../../../core/services/module-scope.service';
import { OrderEntryService } from '../../../core/services/order-entry.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { OPD_FLAG_KEY } from './opd-gate';
import { OpdGateService } from './opd-gate.service';

/**
 * OPD dark build — the gate wired into the app services. With OPD hidden the
 * lab new-order flow is exactly today's: straight to /frontdesk/order, no fork,
 * no dialog — even for a user whose role is tagged 'opd' and even when the
 * stored module map says opd is on (only the server's explicit entitlement or
 * the pf.opd() console flag can open it).
 */
let store: Record<string, string> = {};
function memoryStorage() {
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
  };
}

function setup(opts: { flag?: boolean; opdAccess?: boolean; opdEntitled?: boolean; modules?: string[]; modulesJson?: string | null; extra?: Record<string, string> }) {
  store = { ...(opts.flag ? { [OPD_FLAG_KEY]: '1' } : {}), ...(opts.extra ?? {}) };
  vi.stubGlobal('localStorage', memoryStorage());
  const user = signal<CurrentUser | null>({
    id: 'u1', firstName: 'A', fathersName: 'B', displayName: 'A B', tenantId: 't', tenantName: 'T',
    branchId: 'b', branchName: 'B', roles: ['Receptionist'], permissions: ['create_order'],
    modules: opts.modules ?? ['lab'], opdAccess: opts.opdAccess ?? false, opdEntitled: opts.opdEntitled ?? false,
  });
  const navigate = vi.fn(async () => true);
  const confirm = vi.fn(async () => false);
  const api = {
    get: vi.fn(() => ({ subscribe: (o: { next: (v: unknown) => void }) => o.next({ modulesJson: opts.modulesJson ?? null, legacy: { inventory: true, messages: true, homeCollection: true, reports: true } }) })),
    put: vi.fn(),
  };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { user, waitForAuth: async () => undefined } },
      { provide: Router, useValue: { navigate } },
      { provide: DialogService, useValue: { confirm } },
      { provide: ApiService, useValue: api },
    ],
  });
  return { navigate, confirm, user };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('OpdGateService', () => {
  it('is dark for everyone by default', () => {
    setup({});
    expect(TestBed.inject(OpdGateService).visible()).toBe(false);
  });
  it('server opdAccess alone (e.g. a header-less /me quirk) shows nothing', () => {
    setup({ opdAccess: true });
    expect(TestBed.inject(OpdGateService).visible()).toBe(false);
  });
  it('any user: the console flag alone → visible (no allowlist, server not consulted)', () => {
    setup({ flag: true, opdAccess: false });
    const g = TestBed.inject(OpdGateService);
    expect(g.visible()).toBe(true);
    expect(g.consolePreview()).toBe(true);
  });
  it('explicitly entitled tenant → visible without the flag', () => {
    setup({ opdAccess: true, opdEntitled: true });
    const g = TestBed.inject(OpdGateService);
    expect(g.visible()).toBe(true);
    expect(g.consolePreview()).toBe(false);
  });
});

describe('Tenant entitlements — opd resolves ONLY through the gate', () => {
  it('a stored opd.enabled=true does not open OPD while the gate is closed', async () => {
    setup({ modulesJson: '{"opd":{"enabled":true}}' });
    const e = TestBed.inject(TenantEntitlementsService);
    await e.ensureLoaded();
    expect(e.moduleOn('opd')).toBe(false);
    expect(e.moduleEnabled('opd')).toBe(false);
    expect(e.moduleOn('lab')).toBe(true); // lab untouched
  });
  it('follows the gate when it is open', async () => {
    setup({ opdAccess: true, opdEntitled: true });
    const e = TestBed.inject(TenantEntitlementsService);
    await e.ensureLoaded();
    expect(e.moduleOn('opd')).toBe(true);
  });
});

describe('New order with OPD hidden = today\'s lab flow', () => {
  for (const modules of [['lab'], ['lab', 'opd'], ['opd']]) {
    it(`roles scoped ${modules.join('+')} → straight to /frontdesk/order, no dialog`, async () => {
      const { navigate, confirm } = setup({ modules, modulesJson: '{"opd":{"enabled":true}}' });
      const scope = TestBed.inject(ModuleScopeService);
      expect(scope.opdUsable()).toBe(false);
      await TestBed.inject(OrderEntryService).startNewOrder('p1');
      expect(confirm).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith(['/frontdesk/order'], { queryParams: { patientId: 'p1' } });
    });
  }

  it('the retired dev-only pf.opdPreview flag no longer opens anything', async () => {
    const { navigate, confirm } = setup({ extra: { 'pf.opdPreview': '1' } });
    expect(TestBed.inject(ModuleScopeService).mode()).toBe('lab');
    await TestBed.inject(OrderEntryService).startNewOrder();
    expect(confirm).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/frontdesk/order'], {});
  });

  it('console preview: lab user gets the lab / consult choice (OPD → /opd/visit/new)', async () => {
    const { navigate, confirm } = setup({ flag: true });
    confirm.mockResolvedValueOnce(true);
    expect(TestBed.inject(ModuleScopeService).mode()).toBe('choose');
    await TestBed.inject(OrderEntryService).startNewOrder('p9');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/opd/visit/new'], { queryParams: { patientId: 'p9' } });
  });
});
