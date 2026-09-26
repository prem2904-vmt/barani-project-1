import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from '../../core/auth/auth.service';
import { ApiService } from '../../core/services/api.service';
import { BranchLabConfigService } from '../../core/services/branch-lab-config.service';
import { DialogService } from '../../core/services/dialog.service';
import { PlatformService } from '../../core/services/platform.service';
import { TenantEntitlementsService } from '../../core/services/tenant-entitlements.service';
import { TenantStateService } from '../../core/services/tenant-state.service';
import { ToastService } from '../../core/services/toast.service';
import { SettingAdapter } from './adapters/adapter';

/** A signal-backed store whose writes the test resolves or rejects. */
export class FakeAdapter implements SettingAdapter {
  readonly values = signal<Record<string, unknown>>({});
  readonly writes: Array<{ key: string; value: unknown; branchId: string | null; resolve: () => void; reject: (e: unknown) => void }> = [];
  isLoaded = true;
  constructor(init: Record<string, unknown> = {}) { this.values.set(init); }
  ensure(): void { /* loaded */ }
  loaded(): boolean { return this.isLoaded; }
  read(key: string): unknown { return this.values()[key]; }
  write(key: string, value: unknown, branchId: string | null): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.writes.push({
        key, value, branchId,
        resolve: () => { this.values.update((v) => ({ ...v, [key]: value })); resolve(); },
        reject,
      });
    });
  }
}

export interface HarnessOpts {
  perms?: string[];
  branches?: Array<{ id: string; name: string }>;
  activeBranch?: string;
  getFor?: (url: string) => unknown;
  confirm?: boolean;
  modulesOff?: string[];
}

/** Providers for Settings specs: stub API / auth / entitlements, the rest real. */
export function settingsProviders(o: HarnessOpts = {}) {
  if (!window.matchMedia) {
    (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  }
  document.documentElement.classList.add('design-new');
  const api = {
    get: vi.fn((url: string) => of(o.getFor?.(url) ?? null)),
    post: vi.fn(() => of({})),
    put: vi.fn(() => of({})),
    patch: vi.fn(() => of({})),
    delete: vi.fn(() => of({})),
  };
  const dialog = { confirm: vi.fn(async () => o.confirm ?? true), prompt: vi.fn(async () => null), active: () => null };
  const perms = o.perms ?? ['*'];
  const branches = o.branches ?? [{ id: 'b1', name: 'Main' }];
  const user = {
    id: 'u1', firstName: 'Admin', displayName: 'Admin', tenantName: 'Micro World', tenantId: 't1',
    branchId: o.activeBranch ?? branches[0]?.id ?? 'b1', branchName: branches[0]?.name ?? 'Main',
    roles: [], permissions: perms, branches,
  };
  const auth = {
    user: () => user,
    permissions: () => perms,
    activeBranchId: () => o.activeBranch ?? branches[0]?.id ?? null,
    activeBranch: () => branches[0] ?? null,
    hasPermission: (c: string) => perms.includes('*') || perms.includes(c),
    hasAnyPermission: (cs: string[]) => perms.includes('*') || cs.some((c) => perms.includes(c)),
    isAuthenticated: () => true,
    waitForAuth: async () => undefined,
    setRegistrationIdLocal: vi.fn(),
    setSignatureLocal: vi.fn(),
  };
  const off = new Set(o.modulesOff ?? []);
  const entitlements = {
    ensureLoaded: vi.fn(async () => undefined),
    loaded: () => true,
    refresh: vi.fn(),
    moduleEnabled: (k: string) => !off.has(k),
    moduleOn: (k: string) => !off.has(k),
    featureOn: (_m: string, k: string) => !off.has(k),
    effectiveState: () => ({}),
    save: vi.fn(() => of({})),
  };
  const labCfg = {
    ensureLoaded: vi.fn(), update: vi.fn(), config: () => null,
    billingMode: () => 'front_desk', collectionMode: () => 'front_desk', collectsAtFrontdesk: () => true,
  };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  return {
    api, dialog, auth, entitlements, labCfg, toasts,
    providers: [
      provideRouter([]),
      { provide: ApiService, useValue: api },
      { provide: AuthService, useValue: auth },
      { provide: DialogService, useValue: dialog },
      { provide: ToastService, useValue: toasts },
      { provide: TenantEntitlementsService, useValue: entitlements },
      { provide: BranchLabConfigService, useValue: labCfg },
      { provide: PlatformService, useValue: { isElectron: () => false, isCapacitor: () => false, getApiUrl: () => '' } },
      { provide: TenantStateService, useValue: { tenant: signal(null), status: () => 'loaded', ensureLoaded: vi.fn(), update: vi.fn(), refresh: vi.fn() } },
    ],
  };
}

export function configure(o: HarnessOpts = {}) {
  const h = settingsProviders(o);
  TestBed.configureTestingModule({ providers: h.providers });
  return h;
}

/** Let promise chains settle. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}
