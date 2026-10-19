import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { BRANCH_HOP_PATH, BRANCH_IN_MS, BRANCH_OUT_MS, BranchSwitchService } from './branch-switch.service';
import { BranchLabConfigService } from './branch-lab-config.service';
import { ProcessWorkflowService } from './process-workflow.service';
import { OutsourcingService } from './outsourcing.service';
import { DraftShelfService } from './draft-shelf.service';
import { PatientProfileService } from './patient-profile.service';
import { HttpActivityService } from './http-activity.service';
import { MIN_BRANCH_MS } from '../../shared/utils/min-duration';
import { BranchVeilComponent } from '../../shared/components/branch-veil/branch-veil.component';

@Component({ template: '<p>work</p>' })
class Work {}

/**
 * In-app branch switch (owner, 2026-09-27: "switch branch feels vague and
 * takes time — it needs an animation"). No page reload: out (screen recedes,
 * destination skeleton rises) → loading (held until the new screen's data
 * settles, at least MIN_BRANCH_MS) → in (zoom up) → idle.
 */
function setup(opts: { reduced?: boolean } = {}) {
  const active = signal<string | null>('chn');
  const auth = {
    user: () => ({ branches: [{ id: 'chn', name: 'Chennai Main' }, { id: 'slm', name: 'Salem' }] }),
    activeBranchId: active.asReadonly(),
    setActiveBranch: vi.fn((id: string, o?: { reload?: boolean }) => {
      if (o?.reload !== false) throw new Error('must not reload');
      if (id === active()) return false;
      active.set(id);
      return true;
    }),
  };
  const labCfg = { reset: vi.fn(), ensureLoaded: vi.fn() };
  const process = { refreshActive: vi.fn() };
  const outsourcing = { reset: vi.fn() };
  const profile = { close: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'frontdesk', component: Work },
        { path: BRANCH_HOP_PATH, children: [] },
      ]),
      { provide: AuthService, useValue: auth },
      { provide: BranchLabConfigService, useValue: labCfg },
      { provide: ProcessWorkflowService, useValue: process },
      { provide: OutsourcingService, useValue: outsourcing },
      { provide: PatientProfileService, useValue: profile },
    ],
  });
  const svc = TestBed.inject(BranchSwitchService);
  const activity = TestBed.inject(HttpActivityService);
  const drafts = TestBed.inject(DraftShelfService);
  const router = TestBed.inject(Router);
  svc.reducedMotion = () => !!opts.reduced;
  return { svc, auth, active, labCfg, process, outsourcing, profile, activity, drafts, router };
}

describe('BranchSwitchService — in-app re-scope with motion', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('out → loading (skeleton held while data loads, >= MIN_BRANCH_MS) → in → idle; never reloads', async () => {
    const { svc, auth, active, labCfg, process, outsourcing, profile, activity, drafts, router } = setup();
    await router.navigateByUrl('/frontdesk');
    drafts.publish('lab', [{ id: 'lab:A', label: 'A', link: ['/lab/sample', 'A'] }]);
    const nav = vi.spyOn(router, 'navigateByUrl');

    const done = svc.switchTo('slm');
    expect(svc.phase()).toBe('out');
    expect(svc.veil()).toBe(true);
    expect(svc.target()?.name).toBe('Salem');
    expect(svc.announcement()).toBe('Switching to Salem…');
    expect(auth.setActiveBranch).not.toHaveBeenCalled();     // the screen recedes first

    // The new screen's first fetch is still in flight when the hop lands.
    activity.begin();
    await vi.advanceTimersByTimeAsync(BRANCH_OUT_MS);
    expect(auth.setActiveBranch).toHaveBeenCalledWith('slm', { reload: false });
    expect(active()).toBe('slm');
    expect(profile.close).toHaveBeenCalled();
    expect(outsourcing.reset).toHaveBeenCalled();
    expect(labCfg.reset).toHaveBeenCalled();
    expect(labCfg.ensureLoaded).toHaveBeenCalled();
    expect(process.refreshActive).toHaveBeenCalled();
    expect(drafts.items()).toEqual([]);                      // the old branch's chips are gone
    expect(svc.phase()).toBe('loading');
    // Re-created through the hop, guards re-run, the URL is kept.
    expect(nav.mock.calls[0][0]).toBe('/' + BRANCH_HOP_PATH);
    expect(nav.mock.calls[0][1]).toMatchObject({ skipLocationChange: true });
    expect(nav.mock.calls[1][0]).toBe('/frontdesk');

    await vi.advanceTimersByTimeAsync(200);
    expect(svc.phase()).toBe('loading');                     // data still loading
    activity.end();                                          // data arrives (fast)
    await vi.advanceTimersByTimeAsync(200);
    expect(svc.phase()).toBe('loading');                     // held to the minimum
    // Idle ~160ms after the data landed; the rest of MIN_BRANCH_MS is held.
    await vi.advanceTimersByTimeAsync(MIN_BRANCH_MS - (BRANCH_OUT_MS + 400) + 30);
    expect(svc.phase()).toBe('in');
    expect(svc.announcement()).toBe('Now working in Salem');
    await vi.advanceTimersByTimeAsync(BRANCH_IN_MS);
    expect(await done).toBe(true);
    expect(svc.phase()).toBe('idle');
    expect(svc.busy()).toBe(false);
    expect(router.url).toBe('/frontdesk');
  });

  it('nothing to fetch (cached): no hold — straight out → in with the same motion', async () => {
    const { svc, router } = setup();
    await router.navigateByUrl('/frontdesk');
    const done = svc.switchTo('slm');
    await vi.advanceTimersByTimeAsync(BRANCH_OUT_MS);
    await vi.advanceTimersByTimeAsync(0);
    expect(svc.phase()).toBe('in');
    await vi.advanceTimersByTimeAsync(BRANCH_IN_MS);
    expect(await done).toBe(true);
  });

  it('reduced motion: no waits at all (instant cross-fade handled by CSS)', async () => {
    const { svc, router, activity } = setup({ reduced: true });
    await router.navigateByUrl('/frontdesk');
    activity.begin();
    const done = svc.switchTo('slm');
    await vi.advanceTimersByTimeAsync(0);
    activity.end();
    await vi.advanceTimersByTimeAsync(200);                  // only the idle probe's quiet window
    expect(await done).toBe(true);
    expect(svc.phase()).toBe('idle');
  });

  it('refuses a branch outside the user\'s set, the active one, or a second tap mid-switch', async () => {
    const { svc, auth, router } = setup();
    await router.navigateByUrl('/frontdesk');
    expect(await svc.switchTo('mdu')).toBe(false);
    expect(await svc.switchTo('chn')).toBe(false);
    const first = svc.switchTo('slm');
    expect(await svc.switchTo('slm')).toBe(false);           // busy
    await vi.advanceTimersByTimeAsync(BRANCH_OUT_MS + BRANCH_IN_MS + 100);
    expect(await first).toBe(true);
    expect(auth.setActiveBranch).toHaveBeenCalledTimes(1);
  });

  it('the veil renders the destination skeleton (aria-busy region + polite label) while switching', async () => {
    const { svc, router } = setup();
    await router.navigateByUrl('/frontdesk');
    void svc.switchTo('slm');
    const f = TestBed.createComponent(BranchVeilComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.getAttribute('data-phase')).toBe('out');
    expect(el.textContent).toContain('Switching to');
    expect(el.textContent).toContain('Salem');
    const region = el.querySelector('pf-skeleton-rows')!;
    expect(region.getAttribute('aria-busy')).toBe('true');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toContain('Loading Salem…');
    expect(el.querySelector('pf-loading-logo')).toBeNull();
    await vi.advanceTimersByTimeAsync(BRANCH_OUT_MS + BRANCH_IN_MS + 100);
  });
});

describe('Branch switchers use the in-app switch (no page reload)', () => {
  it('top strip + bottom nav call BranchSwitchService, not auth.setActiveBranch', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    for (const f of ['layout/top-strip/top-strip.component.ts', 'layout/bottom-nav/bottom-nav.component.ts']) {
      const src = readFileSync(resolve(process.cwd(), 'apps/lms/src/app', f), 'utf8');
      expect(src).toMatch(/branchSwitch\.switchTo\(b\.id\)/);
      expect(src).not.toMatch(/auth\.setActiveBranch\(/);
    }
  });
});
