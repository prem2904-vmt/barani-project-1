import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { ApiService } from './api.service';
import { TmProposalsService } from './tm-proposals.service';
import { BetaFeaturesService } from './beta-features.service';

/**
 * Test Master "Pending changes": the list/badge read the backend's single-request shape
 * (`status=pending,stale,failed`, `counts` settled after the stale flip) - no second read.
 */
function setup(page: unknown, assistant = true) {
  const get = vi.fn(() => (page instanceof Error ? throwError(() => page) : of(page)));
  const post = vi.fn(() => of({}));
  TestBed.configureTestingModule({ providers: [
    { provide: ApiService, useValue: { get, post } },
    { provide: BetaFeaturesService, useValue: { enabled: (k: string) => assistant && k === 'assistant' } },
  ] });
  return { svc: TestBed.inject(TmProposalsService), get, post };
}
const row = (id: string, createdAt: string) => ({ id, createdAt });

describe('TmProposalsService', () => {
  it('Needs review is ONE request for pending,stale,failed; total + badge come from that response', async () => {
    const { svc, get } = setup({ items: [row('a', '2026-11-01T10:00:00Z'), row('b', '2026-11-01T11:00:00Z')], total: 2, pendingCount: 1,
      counts: { pending: 1, stale: 1, failed: 0 } });
    const r = await firstValueFrom(svc.list('review'));
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/api/tm-proposals?status=pending%2Cstale%2Cfailed&take=100');
    expect(r.items.map(i => i.id)).toEqual(['b', 'a']);
    expect(r.total).toBe(2);
    expect(r.openCount).toBe(2);
  });

  it('a closed-status list badge is counts.pending + stale + failed (counts are not narrowed by the filter)', async () => {
    const { svc, get } = setup({ items: [], total: 9, pendingCount: 3, counts: { pending: 3, stale: 2, failed: 1 } });
    const r = await firstValueFrom(svc.list('approved'));
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/api/tm-proposals?status=approved&take=100');
    expect(r.total).toBe(9);
    expect(r.openCount).toBe(6);
  });

  it('openCount reads one tiny page and sums counts; 0 on any failure', async () => {
    const a = setup({ items: [], total: 4, pendingCount: 2, counts: { pending: 2, stale: 1, failed: 1 } });
    expect(await firstValueFrom(a.svc.openCount())).toBe(4);
    expect(a.get).toHaveBeenCalledWith('/api/tm-proposals?status=pending%2Cstale%2Cfailed&take=1');
    TestBed.resetTestingModule();
    const b = setup(new Error('404'));
    expect(await firstValueFrom(b.svc.openCount())).toBe(0);
  });

  it('beta off (Settings access): the contributor changes route, same calls, never the beta inbox', async () => {
    const { svc, get, post } = setup({ items: [], total: 0, pendingCount: 0, counts: { pending: 0, stale: 0, failed: 0 } }, false);
    await firstValueFrom(svc.list('review'));
    expect(get).toHaveBeenCalledWith('/api/settings-changes/test-master?status=pending%2Cstale%2Cfailed&take=100');
    await firstValueFrom(svc.approve('p1', true));
    expect(post).toHaveBeenCalledWith('/api/settings-changes/test-master/p1/approve', { confirmClinical: true });
    await firstValueFrom(svc.withdraw('p1'));
    expect(post).toHaveBeenCalledWith('/api/settings-changes/test-master/p1/withdraw', {});
  });
});
