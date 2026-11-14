import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { AuthService } from '../../core/auth/auth.service';
import { BetaFeaturesService } from '../../core/services/beta-features.service';
import { SheetEditorService } from './sheet-editor.service';

function make(o: { beta?: boolean; perms?: string[]; historyLen?: number } = {}) {
  const router = { url: '/insights?section=tests&period=month', navigateByUrl: vi.fn(async () => true) };
  const location = { back: vi.fn() };
  const perms = o.perms ?? ['view_report'];
  TestBed.configureTestingModule({
    providers: [
      { provide: Router, useValue: router }, { provide: Location, useValue: location },
      { provide: BetaFeaturesService, useValue: { enabled: (k: string) => k === 'neuron' && o.beta !== false } },
      { provide: AuthService, useValue: { hasAnyPermission: (c: string[]) => c.some(x => perms.includes(x)) } },
    ],
  });
  return { svc: TestBed.inject(SheetEditorService), router, location };
}

describe('SheetEditorService: the one way into the editor', () => {
  it('is unavailable (and open does nothing) with the beta off or without a results role', async () => {
    const off = make({ beta: false });
    expect(off.svc.available()).toBe(false);
    expect(await off.svc.open({ source: 'Insights' })).toBe(false);
    expect(off.router.navigateByUrl).not.toHaveBeenCalled();
    TestBed.resetTestingModule();
    const noRole = make({ perms: [] });
    expect(noRole.svc.available()).toBe(false);
    expect(await noRole.svc.open({ source: 'Insights' })).toBe(false);
  });

  it('open() remembers the screen it came from, goes to /sheet, and hands the request over once', async () => {
    const { svc, router } = make();
    await svc.open({ source: 'Insights', insert: { from: '2026-11-01', to: '2026-11-07' } });
    expect(router.navigateByUrl).toHaveBeenCalledWith('/sheet');
    expect(svc.openedFromScreen).toBe(true);
    expect(svc.take()?.source).toBe('Insights');
    expect(svc.take()).toBeNull();
  });

  it('back() returns through the router history (the screen keeps its URL and filters)', async () => {
    const { svc, location } = make();
    Object.defineProperty(history, 'length', { value: 3, configurable: true });
    await svc.open({ source: 'Insights' });
    svc.back();
    expect(location.back).toHaveBeenCalledTimes(1);
    expect(svc.openedFromScreen).toBe(false);
  });

  it('with no history it navigates to the remembered URL instead', async () => {
    const { svc, router, location } = make();
    Object.defineProperty(history, 'length', { value: 1, configurable: true });
    await svc.open({ source: 'Insights' });
    svc.back();
    expect(location.back).not.toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenLastCalledWith('/insights?section=tests&period=month');
  });
});
