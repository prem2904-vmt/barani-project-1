import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { PageFrameComponent } from './page-frame.component';
import { PageSkeleton, PageSkeletonKind, pageSkeletonFor } from '../../../core/navigation/page-skeleton';

/**
 * <pf-page-frame>: the destination's frame while a navigation is on its way —
 * the band + a skeleton of THAT screen's body (never a blank page, never the
 * PF logo), with one polite status.
 */
describe('PageFrameComponent (destination frame)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  function render(sk: PageSkeleton) {
    const f = TestBed.createComponent(PageFrameComponent);
    f.componentRef.setInput('skeleton', sk);
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }

  // The NEW frame (owner 2026-11-19): two-panel screens draw pf-skel-two-panel (side card LEFT + main card).
  const PRESET: Record<PageSkeletonKind, string[]> = {
    queue: ['pf-skel-two-panel[data-main="queue"]'],
    grid: ['pf-skel-two-panel.pf-skp--noside[data-main="grid"]', 'pf-skel-grid'],
    'grid-side': ['pf-skel-two-panel[data-main="grid"] aside.pf-card', 'pf-skel-side-list', 'pf-skel-grid'],
    tiles: ['pf-skeleton-tiles'],
    detail: ['pf-skel-two-panel[data-main="detail"]', 'pf-skeleton-detail'],
    form: ['pf-skel-two-panel[data-main="form"]'],
    chat: ['pf-skel-two-panel[data-main="queue"] aside.pf-card', 'pf-skeleton-rows'],
    dashboard: ['pf-skeleton-tiles', 'pf-skeleton-rows'],
    settings: ['pf-skel-two-panel[data-main="rows"]', 'pf-skel-setting-rows'],
    'settings-tiles': ['pf-skel-two-panel[data-main="tiles"]', 'pf-skel-tiles'],
    doc: ['pf-skel-two-panel[data-main="designer"]', 'pf-skel-doc'],
  };

  for (const [kind, presets] of Object.entries(PRESET) as [PageSkeletonKind, string[]][]) {
    it(`${kind}: draws that layout from the skeleton kit`, () => {
      const el = render({ kind, label: 'Opening X…' });
      expect(el.getAttribute('data-kind')).toBe(kind);
      for (const p of presets) expect(el.querySelector(p), p).not.toBeNull();
      expect(el.querySelector('pf-loading-logo')).toBeNull();
    });
  }

  it('Test Master opens as its grid, with ONE status naming the screen', () => {
    const el = render(pageSkeletonFor('/admin/tests')!);
    expect(el.querySelector('pf-skel-grid')).not.toBeNull();
    expect(el.querySelector('.pf-band-body--fill pf-skel-two-panel')).not.toBeNull();
    const status = [...el.querySelectorAll('[role="status"]')].filter(n => !n.closest('[aria-hidden="true"]'));
    expect(status.length).toBe(1);
    expect(status[0].textContent).toContain('Opening Test Master…');
    // The shapes are hidden from assistive tech and not focusable.
    const body = el.querySelector('.pf-pgf')!;
    expect(body.getAttribute('aria-hidden')).toBe('true');
    expect(body.hasAttribute('inert')).toBe(true);
  });

  it('eases in, and simply appears under reduced motion', () => {
    const src = readFileSync(resolve(process.cwd(), 'apps/lms/src/app/shared/components/page-frame/page-frame.component.ts'), 'utf8');
    expect(src).toMatch(/animation: pf-pgf-in 240ms cubic-bezier\(0\.32, 0\.72, 0, 1\)/);
    expect(src).toMatch(/prefers-reduced-motion: reduce\) \{ :host \{ animation: none; \} \}/);
  });
});

/** The old top progress bar is gone as navigation feedback. */
describe('no top progress bar', () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
  it('app.ts mounts no <pf-route-progress>; the shell mounts the page frame', () => {
    const app = read('apps/lms/src/app/app.ts').replace(/<!--[\s\S]*?-->/g, '');
    expect(app).not.toMatch(/pf-route-progress|RouteProgress/);
    const shell = read('apps/lms/src/app/layout/shell/shell.component.ts');
    expect(shell).toMatch(/<pf-page-frame \[skeleton\]="frame">/);
  });
  it('the route-progress component and service no longer exist', () => {
    const exists = (p: string) => { try { read(p); return true; } catch { return false; } };
    expect(exists('apps/lms/src/app/shared/components/route-progress/route-progress.component.ts')).toBe(false);
    expect(exists('apps/lms/src/app/core/navigation/route-progress.service.ts')).toBe(false);
  });
  it('no double entrance: the old auto fade on the routed screen is gone', () => {
    const css = read('apps/lms/src/styles.scss').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/main\s*>\s*router-outlet\s*\+\s*\*\s*\{[^}]*animation/);
  });
  it('the page-open view transition is styled, only the content area moves, reduced motion is instant', () => {
    const css = read('apps/lms/src/styles.scss');
    expect(css).toMatch(/html\.pf-vt-page \.shell-main \{ view-transition-name: pf-page; \}/);
    expect(css).toMatch(/html\.pf-vt-page::view-transition-new\(pf-page\) \{ animation: pf-vt-page-in 240ms/);
    expect(css).toMatch(/html\.pf-vt-page\.pf-vt-settle::view-transition-new\(pf-page\)/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*html\.pf-vt-page::view-transition-group\(\*\)/);
  });
});
