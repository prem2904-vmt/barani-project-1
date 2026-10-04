import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withViewTransitions } from '@angular/router';
import { PAGE_CLASS, PAGE_SETTLE_CLASS, opensAsPage, slideTransition } from './slide-transition';
import { FRAME_AFTER_MS, PageOpenService } from './page-open.service';

@Component({ standalone: true, template: 'page' })
class PageComponent {}

/**
 * Page OPEN wiring: the router's view transition (withViewTransitions +
 * slideTransition) opens every move to a different screen as a page —
 * `pf-vt-page` on <html> while the old snapshot is taken, a settle
 * cross-fade when the destination frame was already up, instant under
 * reduced motion, and the step → step slide untouched.
 */
describe('slideTransition: page-open view transition', () => {
  interface Started { classes: string[]; skip: ReturnType<typeof vi.fn>; finish: () => void; }
  let started: Started[];
  let origStart: unknown;

  function reducedMotion(on: boolean) {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: on && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {},
    }));
  }

  beforeEach(() => {
    started = [];
    reducedMotion(false);
    origStart = (document as unknown as { startViewTransition?: unknown }).startViewTransition;
    // A minimal View Transitions API: records the <html> classes at the
    // moment the old state would be captured (right before the update).
    (document as unknown as { startViewTransition: unknown }).startViewTransition = (cb: () => Promise<void> | void) => {
      let finish!: () => void;
      const finished = new Promise<void>(r => { finish = r; });
      const rec: Started = { classes: [], skip: vi.fn(() => finish()), finish };
      started.push(rec);
      const updateCallbackDone = Promise.resolve().then(() => {
        rec.classes = [...document.documentElement.classList];
        return cb();
      });
      return { updateCallbackDone, ready: updateCallbackDone, finished, skipTransition: rec.skip };
    };
    TestBed.configureTestingModule({
      providers: [provideRouter([
        { path: '', component: PageComponent },
        { path: 'admin/tests', component: PageComponent },
        { path: 'slow', loadComponent: () => new Promise<typeof PageComponent>(r => setTimeout(() => r(PageComponent), 300)) },
        { path: 'lab/my-work', component: PageComponent },
        { path: 'frontdesk', component: PageComponent },
        { path: 'lab/collect', component: PageComponent },
      ], withViewTransitions({ skipInitialTransition: true, onViewTransitionCreated: slideTransition }))],
    });
  });
  afterEach(() => {
    (document as unknown as { startViewTransition?: unknown }).startViewTransition = origStart;
    document.documentElement.classList.remove('pf-vt-page', 'pf-vt-settle', 'pf-vt-forward', 'pf-vt-back');
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function boot() {
    const router = TestBed.inject(Router);
    TestBed.inject(PageOpenService);
    await router.navigateByUrl('/lab/my-work');          // initial: skipped by config
    started = [];
    return router;
  }

  it('a move to another screen opens as a page (pf-vt-page), classes cleared when it finishes', async () => {
    const router = await boot();
    await router.navigateByUrl('/admin/tests');
    expect(started.length).toBe(1);
    expect(started[0].classes).toContain(PAGE_CLASS);
    expect(started[0].classes).not.toContain(PAGE_SETTLE_CLASS);
    expect(started[0].skip).not.toHaveBeenCalled();
    started[0].finish();
    await Promise.resolve(); await Promise.resolve();
    expect(document.documentElement.classList.contains(PAGE_CLASS)).toBe(false);
  });

  it('after the destination frame was up, the screen settles (cross-fade, no second rise)', async () => {
    const router = await boot();
    vi.useFakeTimers();
    const page = TestBed.inject(PageOpenService);
    void router.navigateByUrl('/slow');
    await vi.advanceTimersByTimeAsync(FRAME_AFTER_MS + 10);
    expect(page.framed()).toBe(true);
    await vi.advanceTimersByTimeAsync(400);
    expect(started.length).toBe(1);
    expect(started[0].classes).toEqual(expect.arrayContaining([PAGE_CLASS, PAGE_SETTLE_CLASS]));
  });

  it('same screen, new query params: instant (transition skipped)', async () => {
    const router = await boot();
    await router.navigateByUrl('/lab/my-work?tab=done');
    expect(started.length).toBe(1);
    expect(started[0].skip).toHaveBeenCalled();
    expect(started[0].classes).not.toContain(PAGE_CLASS);
  });

  it('reduced motion: instant swap, no page class', async () => {
    reducedMotion(true);
    const router = await boot();
    await router.navigateByUrl('/admin/tests');
    expect(started[0].skip).toHaveBeenCalled();
    expect(started[0].classes).not.toContain(PAGE_CLASS);
  });

  it('step → step still slides (front desk → Collect), not a page open', async () => {
    const router = await boot();
    await router.navigateByUrl('/frontdesk');
    started = [];
    await router.navigateByUrl('/lab/collect?orderId=o1');
    expect(started[0].classes).toContain('pf-vt-forward');
    expect(started[0].classes).not.toContain(PAGE_CLASS);
  });
});

describe('opensAsPage', () => {
  it('different screens open as a page; same screen / the branch hop do not', () => {
    expect(opensAsPage('/frontdesk', '/lab/my-work')).toBe(true);
    expect(opensAsPage('/login', '/frontdesk')).toBe(true);
    expect(opensAsPage('/admin/tests?q=a', '/admin/tests?q=b')).toBe(false);
    expect(opensAsPage('/frontdesk', '/_branch')).toBe(false);
    expect(opensAsPage('/_branch', '/frontdesk')).toBe(false);
  });
});
