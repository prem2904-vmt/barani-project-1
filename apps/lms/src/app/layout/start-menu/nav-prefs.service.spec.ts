import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from '../../core/auth/auth.service';
import { ApiService } from '../../core/services/api.service';
import { NAV_PREFS_STORAGE, NavPrefsService, parsePrefs } from './nav-prefs.service';

class FakeStorage implements Partial<Storage> {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
}

function setup(opts: { user?: Record<string, unknown> | null; storage?: () => Storage | null; get?: () => unknown } = {}) {
  const user = signal<Record<string, unknown> | null>(opts.user === undefined
    ? { id: 'u1', tenantId: 't1', roles: ['Admin'] } : opts.user);
  const store = new FakeStorage();
  const api = {
    get: vi.fn((_p: string) => (opts.get ? opts.get() : of({ roles: {} }))),
    put: vi.fn((_p: string, _b: unknown) => of({})),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { user } },
      { provide: ApiService, useValue: api },
      { provide: NAV_PREFS_STORAGE, useValue: opts.storage ?? (() => store as unknown as Storage) },
    ],
  });
  return { svc: TestBed.inject(NavPrefsService), user, store, api };
}

describe('parsePrefs', () => {
  it('reads a valid value', () => {
    expect(parsePrefs('{"v":1,"pinned":["a","b"],"iconsOnly":true}')).toEqual({ v: 1, pinned: ['a', 'b'], iconsOnly: true });
  });
  it('treats corrupt or foreign JSON as never customised', () => {
    const none = { v: 1, pinned: null, iconsOnly: false };
    expect(parsePrefs(null)).toEqual(none);
    expect(parsePrefs('{nope')).toEqual(none);
    expect(parsePrefs('[1,2]')).toEqual(none);
    expect(parsePrefs('{"v":2,"pinned":["a"]}')).toEqual(none);
    expect(parsePrefs('{"v":1,"pinned":[1,2],"iconsOnly":"yes"}')).toEqual(none);
  });
});

describe('NavPrefsService storage', () => {
  it('keys by tenant and user and persists pins + icons only', () => {
    const { svc, store } = setup();
    expect(svc.key()).toBe('pf.nav.prefs.t1.u1');
    svc.setPinned(['lab', 'results']);
    svc.setIconsOnly(true);
    expect(JSON.parse(store.data.get('pf.nav.prefs.t1.u1')!)).toEqual({ v: 1, pinned: ['lab', 'results'], iconsOnly: true });
    expect(svc.pinned()).toEqual(['lab', 'results']);
    expect(svc.iconsOnly()).toBe(true);
  });

  it('two people (or two tenants) on one browser never share a bar', () => {
    const { svc, user, store } = setup();
    svc.setPinned(['lab']);
    user.set({ id: 'u2', tenantId: 't1', roles: [] });
    expect(svc.pinned()).toBeNull();
    svc.setPinned(['results']);
    user.set({ id: 'u1', tenantId: 't2', roles: [] });
    expect(svc.pinned()).toBeNull();
    user.set({ id: 'u1', tenantId: 't1', roles: [] });
    expect(svc.pinned()).toEqual(['lab']);
    expect([...store.data.keys()].sort()).toEqual(['pf.nav.prefs.t1.u1', 'pf.nav.prefs.t1.u2']);
  });

  it('reads what an earlier session stored', () => {
    const { svc, store } = setup();
    store.data.set('pf.nav.prefs.t1.u1', '{"v":1,"pinned":["x"],"iconsOnly":true}');
    expect(svc.pinned()).toEqual(['x']);
    expect(svc.iconsOnly()).toBe(true);
  });

  it('corrupt JSON falls back to the defaults', () => {
    const { svc, store } = setup();
    store.data.set('pf.nav.prefs.t1.u1', '{{{{');
    expect(svc.pinned()).toBeNull();
    expect(svc.iconsOnly()).toBe(false);
  });

  it('blocked storage (getItem / setItem throw, or no storage) keeps working in memory', () => {
    const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } as unknown as Storage;
    const { svc } = setup({ storage: () => throwing });
    expect(svc.pinned()).toBeNull();
    expect(() => svc.setPinned(['lab'])).not.toThrow();
    expect(svc.pinned()).toEqual(['lab']);
    TestBed.resetTestingModule();
    const none = setup({ storage: () => null });
    none.svc.setIconsOnly(true);
    expect(none.svc.iconsOnly()).toBe(true);
  });

  it('reset forgets the pins and keeps icons only', () => {
    const { svc } = setup();
    svc.setPinned(['lab']);
    svc.setIconsOnly(true);
    svc.resetPins();
    expect(svc.pinned()).toBeNull();
    expect(svc.iconsOnly()).toBe(true);
  });

  it('nobody signed in: defaults, nothing stored', () => {
    const { svc, store } = setup({ user: null });
    expect(svc.key()).toBeNull();
    svc.setPinned(['lab']);
    expect(store.data.size).toBe(0);
    expect(svc.pinned()).toBeNull();
  });

  it('capacity follows icons only', () => {
    const { svc } = setup();
    const base = svc.capacity();
    svc.setIconsOnly(true);
    expect(svc.capacity()).toBe(Math.floor(base * 1.5));
  });
});

describe('NavPrefsService role defaults', () => {
  it('loads once per session and merges for the person\'s roles', () => {
    const { svc, api } = setup({ get: () => of({ roles: { Admin: { pinned: ['lab'], locked: ['lab'] }, Other: { pinned: ['x'], locked: [] } } }) });
    svc.ensureDefaults();
    svc.ensureDefaults();
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/api/tenants/nav-defaults');
    expect(svc.roleDefaults()).toEqual({ pinned: ['lab'], locked: ['lab'] });
  });

  it('a failed call means no defaults and never throws', () => {
    const { svc } = setup({ get: () => throwError(() => new Error('down')) });
    expect(() => svc.ensureDefaults()).not.toThrow();
    expect(svc.roleDefaults()).toBeNull();
  });

  it('save sends the roles with PUT and then uses them', () => {
    const { svc, api } = setup();
    const roles = { Admin: { pinned: ['lab'], locked: [] } };
    svc.saveRoleDefaults(roles).subscribe();
    expect(api.put).toHaveBeenCalledWith('/api/tenants/nav-defaults', { roles });
    expect(svc.roleDefaults()).toEqual({ pinned: ['lab'], locked: [] });
  });
});
