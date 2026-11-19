import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { renderBandPage } from '../../admin/admin-band.spec-helpers';
import { ApiService } from '../../../core/services/api.service';
import { TatBoardComponent } from './tat-board.component';

/**
 * TAT board — LOADING FEEDBACK (PF-PATTERN "Loading feedback"): the first
 * load draws the board's rows as a skeleton (never "No active tests right
 * now" before the answer), and the band's Refresh is busy while the board
 * reloads. The silent 30s poll never touches the button.
 */
const ROWS = [
  { orderTestId: 'o1', patient: 'Ravi Kumar', test: 'CBC', status: 'received', elapsedMinutes: 90, remainingMinutes: -5, level: 'urgent' },
];

function render() {
  const calls: Subject<any>[] = [];
  const api = {
    get: vi.fn((url: string) => { const s = new Subject<any>(); if (url === '/api/dashboard/tat') calls.push(s); return s; }),
    post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(),
  };
  const p = renderBandPage(TatBoardComponent, { providers: [{ provide: ApiService, useValue: api }] });
  const answer = (i: number) => { calls[i].next({ summary: {}, rows: ROWS }); calls[i].complete(); };
  const refresh = () => p.actions().find(b => b.textContent!.includes('Refresh')) as HTMLButtonElement;
  const tatCalls = () => calls.length;
  return { ...p, api, calls, answer, refresh, tatCalls };
}

describe('TAT board — loading feedback', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('first render = rows skeleton, not "No active tests"; the board replaces it once it lands', async () => {
    const p = render();
    expect(p.el.querySelector('pf-skeleton-rows[aria-busy="true"]')).not.toBeNull();
    expect(p.el.textContent).not.toContain('No active tests right now');
    await Promise.resolve();
    p.answer(0);
    p.f.detectChanges();
    expect(p.el.querySelector('pf-skeleton-rows')).toBeNull();          // side list present → content at once
    expect(p.cmp.gridRows()[0].patient).toBe('Ravi Kumar');          // the board's grid now holds the row
    p.f.destroy();
  });

  it('Refresh: disabled + aria-busy while the board reloads, dots after 150ms, released on answer', () => {
    const p = render();
    p.answer(0);
    p.f.detectChanges();
    expect(p.refresh().getAttribute('aria-busy')).toBeNull();
    p.refresh().click();
    p.f.detectChanges();
    expect(p.tatCalls()).toBe(2);
    expect(p.refresh().disabled).toBe(true);
    expect(p.refresh().getAttribute('aria-busy')).toBe('true');
    vi.advanceTimersByTime(200);
    p.f.detectChanges();
    expect(p.refresh().querySelector('pf-busy')).not.toBeNull();
    p.answer(1);
    vi.advanceTimersByTime(400);
    p.f.detectChanges();
    expect(p.refresh().disabled).toBe(false);
    expect(p.refresh().getAttribute('aria-busy')).toBeNull();
    p.f.destroy();
  });

  it('the 30s poll reloads silently (the button never turns busy)', () => {
    const p = render();
    p.answer(0);
    p.f.detectChanges();
    vi.advanceTimersByTime(30_000);
    p.f.detectChanges();
    expect(p.tatCalls()).toBe(2);
    expect(p.refresh().getAttribute('aria-busy')).toBeNull();
    p.f.destroy();
  });
});
