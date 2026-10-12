import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../core/auth/auth.service';
import { BRIDGE_NEARBY_CONFIG, BridgeNearbyService, readSnoozes } from './bridge-nearby.service';
import { BridgesApiService } from './bridges-api.service';
import { FX_NEARBY } from './testing/bridge-fixtures';

const flush = async () => { for (let i = 0; i < 3; i++) await Promise.resolve(); };

function setup(perms: string[], clock = { t: 1_000_000 }) {
  const api = { nearby: vi.fn(() => of(FX_NEARBY)) };
  TestBed.configureTestingModule({
    providers: [
      { provide: BridgesApiService, useValue: api },
      { provide: AuthService, useValue: { hasAnyPermission: (c: string[]) => perms.includes('*') || c.some((x) => perms.includes(x)) } },
      { provide: BRIDGE_NEARBY_CONFIG, useValue: { pollMs: 0, snoozeMs: 24 * 3600_000, now: () => clock.t } },
    ],
  });
  return { api, svc: TestBed.inject(BridgeNearbyService), clock };
}

describe('BridgeNearbyService — "New Bridge found nearby"', () => {
  beforeEach(() => {
    // Node's own (file-less) localStorage global shadows jsdom's — stub a real one.
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => store.clear(),
    });
  });
  afterEach(() => { TestBed.resetTestingModule(); vi.unstubAllGlobals(); });

  it('without manage_bridges it NEVER calls the server', async () => {
    const { api, svc } = setup(['manage_lab_settings']);
    svc.start();
    await svc.poll();
    expect(api.nearby).not.toHaveBeenCalled();
    expect(svc.current()).toBeNull();
  });

  it('with manage_bridges (or *) it polls at start and exposes ONE offer at a time', async () => {
    for (const perms of [['manage_bridges'], ['*']]) {
      TestBed.resetTestingModule();
      const { api, svc } = setup(perms);
      svc.start();
      await flush();
      expect(api.nearby).toHaveBeenCalledTimes(1);
      expect(svc.current()?.announcementId).toBe(FX_NEARBY[0].announcementId);
    }
  });

  it('"Not now" snoozes that Bridge for 24 h (localStorage), then it comes back', async () => {
    const clock = { t: 1_000_000 };
    const { svc } = setup(['manage_bridges'], clock);
    await svc.poll();
    svc.snooze(FX_NEARBY[0].announcementId);
    expect(svc.current()).toBeNull();
    expect(readSnoozes(clock.t)[FX_NEARBY[0].announcementId]).toBe(clock.t + 24 * 3600_000);
    // A new tab / service instance reads the same snooze.
    TestBed.resetTestingModule();
    const again = setup(['manage_bridges'], clock);
    again.svc.start();
    await flush();
    expect(again.svc.current()).toBeNull();
    clock.t += 24 * 3600_000 + 1;
    expect(readSnoozes(clock.t)).toEqual({});
  });

  it('polls again when the tab becomes visible; skips while hidden', async () => {
    const { api, svc } = setup(['manage_bridges']);
    svc.start();
    await flush();
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(api.nearby).toHaveBeenCalledTimes(1);
    vis.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(api.nearby).toHaveBeenCalledTimes(2);
    svc.stop();
    vis.mockRestore();
  });

  it('a failed poll keeps what it had; forget drops a claimed offer; at most 5', async () => {
    const { api, svc } = setup(['manage_bridges']);
    await svc.poll();
    api.nearby.mockReturnValueOnce(throwError(() => new Error('x')) as never);
    await svc.poll();
    expect(svc.nearby()).toHaveLength(1);
    svc.forget(FX_NEARBY[0].announcementId);
    expect(svc.nearby()).toHaveLength(0);
    api.nearby.mockReturnValueOnce(of(Array.from({ length: 8 }, (_, i) => ({ ...FX_NEARBY[0], announcementId: 'a' + i }))) as never);
    await svc.poll();
    expect(svc.nearby()).toHaveLength(5);
  });

  it('localStorage that throws never breaks it', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
    expect(readSnoozes(1)).toEqual({});
  });
});
