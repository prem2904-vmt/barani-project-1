import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouteProgressService } from './route-progress.service';
import { RouteProgressComponent } from '../../shared/components/route-progress/route-progress.component';
import { BUSY_MIN_SHOW_MS, BUSY_SHOW_AFTER_MS } from '../../shared/utils/busy';

@Component({ standalone: true, template: 'page' })
class PageComponent {}

/** A lazy screen whose chunk takes `ms` to arrive. */
const slow = (ms: number) => () => new Promise<typeof PageComponent>(r => setTimeout(() => r(PageComponent), ms));

describe('RouteProgressService + <pf-route-progress> (loading feedback)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [provideRouter([
        { path: '', component: PageComponent },
        { path: 'fast', component: PageComponent },
        { path: 'slow', loadComponent: slow(1000) },
        { path: 'blocked', canActivate: [() => new Promise<boolean>(r => setTimeout(() => r(false), 400))], component: PageComponent },
      ])],
    });
  });
  afterEach(() => vi.useRealTimers());

  function bar() {
    const svc = TestBed.inject(RouteProgressService);
    const f = TestBed.createComponent(RouteProgressComponent);
    f.detectChanges();
    const host = f.nativeElement as HTMLElement;
    const tick = async (ms: number) => { await vi.advanceTimersByTimeAsync(ms); f.detectChanges(); };
    return { svc, host, tick, router: TestBed.inject(Router) };
  }

  it('a slow lazy screen: pending at once, the bar only after 150ms, finish on arrival', async () => {
    const { svc, host, tick, router } = bar();
    void router.navigateByUrl('/slow');
    await tick(0);
    expect(svc.pending()).toBe(true);
    expect(host.getAttribute('data-state')).toBe('idle');
    await tick(BUSY_SHOW_AFTER_MS);
    expect(svc.shown()).toBe(true);
    expect(host.getAttribute('data-state')).toBe('loading');
    expect(host.getAttribute('data-active')).toBe('true');
    expect(host.textContent).toContain('Loading page');
    await tick(1000);
    expect(svc.pending()).toBe(false);
    // Shown for > BUSY_MIN_SHOW_MS already: it runs out and fades at once.
    expect(host.getAttribute('data-state')).toBe('done');
    expect(host.getAttribute('data-active')).toBeNull();
    await tick(400);
    expect(host.getAttribute('data-state')).toBe('idle');
  });

  it('an instant navigation never shows the bar (no flicker)', async () => {
    const { svc, host, tick, router } = bar();
    await router.navigateByUrl('/fast');
    await tick(1000);
    expect(svc.pending()).toBe(false);
    expect(svc.shown()).toBe(false);
    expect(host.getAttribute('data-state')).toBe('idle');
  });

  it('markSource: the pressed element is busy at once and released when the navigation settles', async () => {
    const { tick, router, svc } = bar();
    const btn = document.createElement('button');
    svc.markSource(btn);
    void router.navigateByUrl('/slow');
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.classList.contains('pf-nav-pending')).toBe(true);
    await tick(500);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    await tick(600);
    expect(btn.getAttribute('aria-busy')).toBeNull();
    expect(btn.classList.contains('pf-nav-pending')).toBe(false);
  });

  it('a cancelled navigation (guard says no) releases the source and the bar', async () => {
    const { tick, router, svc } = bar();
    const btn = document.createElement('button');
    svc.markSource(btn);
    void router.navigateByUrl('/blocked');
    await tick(200);
    expect(svc.shown()).toBe(true);
    await tick(300);
    expect(svc.pending()).toBe(false);
    expect(btn.getAttribute('aria-busy')).toBeNull();
    await tick(BUSY_MIN_SHOW_MS);
    expect(svc.shown()).toBe(false);
  });

  it('a press that starts no navigation is not left busy', async () => {
    const { tick, svc } = bar();
    const btn = document.createElement('button');
    svc.markSource(btn);
    await tick(1);
    expect(btn.getAttribute('aria-busy')).toBeNull();
  });
});
