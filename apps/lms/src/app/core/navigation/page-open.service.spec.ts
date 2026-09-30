import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ENTER_MS, FRAME_AFTER_MS, FRAME_AFTER_PAIRED_MS, PageOpenService } from './page-open.service';
import { ZoomTransitionService } from './zoom-transition';

@Component({ standalone: true, template: 'page' })
class PageComponent {}

/** A lazy screen whose chunk takes `ms` to arrive. */
const slow = (ms: number) => () => new Promise<typeof PageComponent>(r => setTimeout(() => r(PageComponent), ms));

function reducedMotion(on: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: on && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {},
  }));
}

describe('PageOpenService (page-open navigation feedback)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reducedMotion(false);
    TestBed.configureTestingModule({
      providers: [provideRouter([
        { path: '', component: PageComponent },
        { path: 'admin/tests', loadComponent: slow(1000) },
        { path: 'lab/my-work', component: PageComponent },
        { path: 'lab/sample/:id', loadComponent: slow(1000) },
        { path: 'blocked', canActivate: [() => new Promise<boolean>(r => setTimeout(() => r(false), 400))], component: PageComponent },
      ])],
    });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  function setup() {
    const svc = TestBed.inject(PageOpenService);
    const router = TestBed.inject(Router);
    const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);
    return { svc, router, tick };
  }

  it('a slow screen: the DESTINATION frame (its layout) after 90ms, gone on arrival', async () => {
    const { svc, router, tick } = setup();
    void router.navigateByUrl('/admin/tests');
    await tick(0);
    expect(svc.pending()).toBe(true);
    expect(svc.frame()).toBeNull();                       // not before 90ms: no flicker
    await tick(FRAME_AFTER_MS);
    expect(svc.frame()).toEqual({ kind: 'grid-side', label: 'Opening Test Master…' });
    expect(svc.framed()).toBe(true);
    await tick(1000);
    expect(svc.pending()).toBe(false);
    expect(svc.frame()).toBeNull();
  });

  it('an instant navigation draws no frame (the view transition opens it)', async () => {
    const { svc, router, tick } = setup();
    await router.navigateByUrl('/lab/my-work');
    await tick(1000);
    expect(svc.frame()).toBeNull();
    expect(svc.pending()).toBe(false);
  });

  it('a refused guard takes the frame down and gives the old screen back', async () => {
    const { svc, router, tick } = setup();
    void router.navigateByUrl('/blocked');
    await tick(FRAME_AFTER_MS);
    expect(svc.frame()?.kind).toBe('queue');
    await tick(400);
    expect(svc.frame()).toBeNull();
    expect(svc.pending()).toBe(false);
  });

  it('same screen with new query params: no frame', async () => {
    const { svc, router, tick } = setup();
    await router.navigateByUrl('/lab/my-work');
    void router.navigateByUrl('/lab/my-work?tab=done');
    await tick(FRAME_AFTER_MS + 50);
    expect(svc.frame()).toBeNull();
  });

  it('a zoom-armed tap keeps its zoom: the frame only if the screen is slow (400ms)', async () => {
    const { svc, router, tick } = setup();
    await router.navigateByUrl('/lab/my-work');
    const zoom = TestBed.inject(ZoomTransitionService);
    const tile = document.createElement('div');
    document.body.appendChild(tile);
    zoom.tap(tile, ['S-1']);
    expect(zoom.armed()).toBe(true);
    void router.navigateByUrl('/lab/sample/S-1');
    await tick(FRAME_AFTER_MS + 10);
    expect(svc.frame()).toBeNull();
    await tick(FRAME_AFTER_PAIRED_MS);
    expect(svc.frame()?.kind).toBe('detail');
    await tick(1000);
    expect(svc.frame()).toBeNull();
    tile.remove();
  });

  it('markSource: the pressed element is busy until the navigation settles', async () => {
    const { svc, router, tick } = setup();
    const btn = document.createElement('button');
    svc.markSource(btn);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.classList.contains('pf-nav-pending')).toBe(true);
    void router.navigateByUrl('/admin/tests');
    await tick(500);
    expect(btn.classList.contains('pf-nav-pending')).toBe(true);
    await tick(1000);
    expect(btn.classList.contains('pf-nav-pending')).toBe(false);
    expect(btn.hasAttribute('aria-busy')).toBe(false);
  });

  it('markSource without a navigation clears itself (no stuck busy button)', async () => {
    const { svc, tick } = setup();
    const btn = document.createElement('button');
    svc.markSource(btn);
    await tick(300);
    expect(btn.classList.contains('pf-nav-pending')).toBe(false);
  });

  describe('CSS fallback entrance (no View Transitions API)', () => {
    it('a screen that landed without a frame rises in, then the class clears', async () => {
      const { svc, router, tick } = setup();
      svc.viewTransitions = () => false;
      await router.navigateByUrl('/lab/my-work');
      await tick(0);
      expect(svc.entering()).toBe('rise');
      await tick(ENTER_MS);
      expect(svc.entering()).toBeNull();
    });

    it('a screen that landed from its frame settles (cross-fade), never a second rise', async () => {
      const { svc, router, tick } = setup();
      svc.viewTransitions = () => false;
      void router.navigateByUrl('/admin/tests');
      await tick(1000);
      expect(svc.entering()).toBe('settle');
    });

    it('with View Transitions the router transition plays it: no CSS entrance', async () => {
      const { svc, router, tick } = setup();
      svc.viewTransitions = () => true;
      await router.navigateByUrl('/lab/my-work');
      await tick(0);
      expect(svc.entering()).toBeNull();
    });

    it('reduced motion: no entrance at all', async () => {
      reducedMotion(true);
      const { svc, router, tick } = setup();
      svc.viewTransitions = () => false;
      await router.navigateByUrl('/lab/my-work');
      await tick(0);
      expect(svc.entering()).toBeNull();
    });
  });
});
