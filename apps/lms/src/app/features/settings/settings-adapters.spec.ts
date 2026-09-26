import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { authInterceptor } from '../../core/auth/auth.interceptor';
import { AutoAssignAdapter } from './adapters/auto-assign.adapter';
import { BranchLabConfigAdapter } from './adapters/branch-lab-config.adapter';
import { SETTINGS_BY_ID } from './settings-registry';
import { SettingsStore } from './settings-store.service';
import { configure, flush } from './settings.spec-helpers';

describe('Branch-scoped rows send X-Active-Branch for the branch they edit', () => {
  it('branch lab config: reads and writes carry the picked branch; the active one updates the shared service', async () => {
    const h = configure({ branches: [{ id: 'b1', name: 'Main' }, { id: 'b2', name: 'Annex' }], activeBranch: 'b1' });
    h.api.patch.mockImplementation(((_u: string, body: Record<string, unknown>) => of({ ...body, id: 'x' })) as never);
    const store = TestBed.inject(SettingsStore);
    const def = SETTINGS_BY_ID.get('fd.paymentsDue')!;

    store.ensure([def]);
    expect(h.api.get).toHaveBeenCalledWith('/api/tenants/branch-lab-config', { headers: { 'X-Active-Branch': 'b1' } });

    store.setBranch('b2');
    store.ensure([def]);
    expect(h.api.get).toHaveBeenCalledWith('/api/tenants/branch-lab-config', { headers: { 'X-Active-Branch': 'b2' } });

    await store.write(def, false);
    expect(h.api.patch).toHaveBeenLastCalledWith('/api/tenants/branch-lab-config', { showPaymentsDueTab: false },
      { headers: { 'X-Active-Branch': 'b2' } });
    expect(h.labCfg.update).not.toHaveBeenCalled();                  // not the active branch
    expect(store.read(def)).toBe(false);

    store.setBranch('b1');
    await store.write(def, true);
    expect(h.labCfg.update).toHaveBeenCalledTimes(1);                // active branch → nav follows
  });

  it('legacy values read as today\'s choices', async () => {
    const h = configure();
    h.api.get.mockImplementation(((url: string) => of(url.includes('branch-lab-config')
      ? { labelCodeMode: 'both', labStructure: 'individual', requireBillBeforeCollection: true } : null)) as never);
    const store = TestBed.inject(SettingsStore);
    store.ensure([SETTINGS_BY_ID.get('col.labelCode')!]);
    await flush();
    expect(store.read(SETTINGS_BY_ID.get('col.labelCode')!)).toBe('barcode');
    expect(store.read(SETTINGS_BY_ID.get('lab.labStructure')!)).toBe('standalone');
    expect(store.read(SETTINGS_BY_ID.get('fd.payGate')!)).toBe('dispatch');
    expect(TestBed.inject(BranchLabConfigAdapter)).toBeTruthy();
  });

  it('auto-assign: ONE picker per leg, but the PUT keeps all four pools', async () => {
    const h = configure();
    h.api.get.mockImplementation(((url: string) => {
      if (url.startsWith('/api/tenants/departments')) return of([{ id: 'd1', name: 'Biochemistry', isActive: true }]);
      if (url === '/api/tenants/auto-assign-configs') return of([{ departmentId: 'd1',
        assigneeUserIdsJson: '["u1"]', autoAssignRoleIdsJson: '[]',
        validatorUserIdsJson: '["u9"]', validatorRoleIdsJson: '["r2"]' }]);
      return of([]);
    }) as never);
    const store = TestBed.inject(SettingsStore);
    const def = SETTINGS_BY_ID.get('lab.techPool')!;
    store.ensure([def]);
    await flush();
    const aa = TestBed.inject(AutoAssignAdapter);
    expect(aa.departments('b1').map((d) => d.name)).toEqual(['Biochemistry']);
    expect(store.read(def, 'tech:d1')).toEqual(['u:u1']);
    await store.write(def, ['u:u2', 'r:r5'], 'tech:d1');
    expect(h.api.put).toHaveBeenLastCalledWith('/api/tenants/auto-assign-configs', {
      departmentId: 'd1', assigneeUserIds: ['u2'], roleIds: ['r5'], validatorUserIds: ['u9'], validatorRoleIds: ['r2'],
    }, { headers: { 'X-Active-Branch': 'b1' } });
    expect(store.read(def, 'validator:d1')).toEqual(['u:u9', 'r:r2']);
  });
});

describe('auth interceptor keeps a caller-set X-Active-Branch', () => {
  function setup() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: {
          accessToken: () => 'tok', activeBranchId: () => 'active', waitForAuth: async () => undefined,
          isAuthenticated: () => true, refreshAccessToken: async () => false, signOut: async () => undefined,
        } },
      ],
    });
    return { http: TestBed.inject(HttpClient), ctl: TestBed.inject(HttpTestingController) };
  }

  it('adds the active branch when the caller named none', async () => {
    const { http, ctl } = setup();
    http.get('/api/x').subscribe();
    await flush();
    const req = ctl.expectOne('/api/x');
    expect(req.request.headers.get('X-Active-Branch')).toBe('active');
    expect(req.request.headers.get('Authorization')).toBe('Bearer tok');
    req.flush({});
  });

  it('keeps the branch the caller named', async () => {
    const { http, ctl } = setup();
    http.get('/api/x', { headers: { 'X-Active-Branch': 'other' } }).subscribe();
    await flush();
    const req = ctl.expectOne('/api/x');
    expect(req.request.headers.get('X-Active-Branch')).toBe('other');
    req.flush({});
  });
});
