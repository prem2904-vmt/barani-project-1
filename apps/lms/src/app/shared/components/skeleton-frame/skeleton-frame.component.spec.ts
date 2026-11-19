import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SKELETON_FRAME } from './skeleton-frame.component';

/**
 * Skeleton frame blocks (owner 2026-11-19: skeletons mirror the NEW frame). Geometry comes from the frame's own
 * classes / tokens (no second set of numbers), ONE shimmer (pf-skeleton), static under reduced motion.
 */
@Component({
  standalone: true,
  imports: [...SKELETON_FRAME],
  template: `
    <pf-skel-two-panel id="tp" main="grid" [sideRows]="5" [rows]="7" [cols]="4" [pills]="2" label="Loading tests…"></pf-skel-two-panel>
    <pf-skel-two-panel id="solo" [side]="false" main="rows" [rows]="3" label=""></pf-skel-two-panel>
    <pf-skel-two-panel id="phone" main="tiles" phone="side" [narrow]="true" [rows]="4" label="Loading settings…"></pf-skel-two-panel>
    <pf-skel-grid id="grid" [rows]="3" [columns]="5" label="Loading prices…"></pf-skel-grid>
    <pf-skel-side-list id="side" [rows]="4" [headings]="[0, 2]" label="Loading departments…"></pf-skel-side-list>
    <pf-skel-setting-rows id="srows" [rows]="4" label="Loading lab settings…"></pf-skel-setting-rows>
    <pf-skel-tiles id="tiles" [count]="6"></pf-skel-tiles>
    <pf-skel-doc id="doc" [rows]="5"></pf-skel-doc>
  `,
})
class Host {}

const src = () => readFileSync(resolve(process.cwd(), 'apps/lms/src/app/shared/components/skeleton-frame/skeleton-frame.component.ts'), 'utf8');

describe('skeleton frame blocks', () => {
  let el: HTMLElement;
  beforeEach(() => {
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    el = f.nativeElement;
  });
  const q = (s: string) => el.querySelector(s) as HTMLElement;

  it('pf-skel-two-panel: side card LEFT (aside.pf-card) + main card with a pf-card__head, ONE status region', () => {
    const tp = q('#tp');
    const kids = [...tp.children].filter(c => c.tagName !== 'SPAN');
    expect(kids.map(k => k.tagName.toLowerCase())).toEqual(['aside', 'section']);   // side first = left column
    expect(kids[0].classList).toContain('pf-card');
    expect(kids[1].classList).toContain('pf-card');
    expect(tp.querySelector('section.pf-card > pf-skel-card-head.pf-card__head')).not.toBeNull();
    expect(tp.querySelectorAll('pf-skel-card-head .pf-skf-pill').length).toBe(2);
    expect(tp.getAttribute('role')).toBe('status');
    expect(tp.getAttribute('aria-busy')).toBe('true');
    expect(tp.textContent).toContain('Loading tests…');
    // Nested blocks are silent (no second region), shapes hidden from assistive tech.
    expect(tp.querySelectorAll('[role="status"]').length).toBe(0);
    expect(kids[0].getAttribute('aria-hidden')).toBe('true');
    expect(kids[1].getAttribute('aria-hidden')).toBe('true');
  });

  it('side list = the shared .pf-side-list / .pf-side-item rows (44px from the frame stylesheet), headings where asked', () => {
    expect(q('#tp aside .pf-side-list')).not.toBeNull();
    expect(el.querySelectorAll('#tp aside .pf-side-item').length).toBe(5);
    expect(el.querySelectorAll('#side .pf-side-item').length).toBe(4);
    expect(el.querySelectorAll('#side .pf-skf-heading').length).toBe(2);
    expect(q('#side').getAttribute('role')).toBe('status');
  });

  it('grid: header + N rows; heights read the theme vars (--pf-grid-head-h / --pf-grid-row-h), never a literal', () => {
    expect(el.querySelectorAll('#grid [data-skel="grid-head"]').length).toBe(1);
    expect(el.querySelectorAll('#grid [data-skel="grid-row"]').length).toBe(3);
    expect(q('#grid [data-skel="grid-row"]').style.gridTemplateColumns).toContain('repeat(4');
    const s = src();
    expect(s).toMatch(/height: var\(--pf-grid-row-h\)/);
    expect(s).toMatch(/height: var\(--pf-grid-head-h\)/);
    expect(s).not.toMatch(/--pf-grid-row-h:\s*\d/);     // the numbers live ONCE, in styles.scss
    const styles = readFileSync(resolve(process.cwd(), 'apps/lms/src/styles.scss'), 'utf8');
    expect(styles).toMatch(/--pf-grid-row-h: 56px/);
    expect(styles).toMatch(/--pf-grid-head-h: 40px/);
    // Touch = the grid theme's own media query (not a class): 64px rows, 48px header.
    expect(styles).toMatch(/@media not \(\(hover: hover\) and \(pointer: fine\)\) \{ :root \{ --pf-grid-head-h: 48px; --pf-grid-row-h: 64px; \} \}/);
  });

  it('main card variants: setting rows, tiles, document; no side card when side=false', () => {
    expect(q('#solo aside')).toBeNull();
    expect(q('#solo').classList).toContain('pf-skp--noside');
    expect(el.querySelectorAll('#solo [data-skel="setting-row"]').length).toBe(3);
    expect(el.querySelectorAll('#srows [data-skel="setting-row"]').length).toBe(4);
    expect(el.querySelectorAll('#tiles [data-skel="tile"]').length).toBe(6);
    expect(q('#doc [data-skel="doc"]')).not.toBeNull();
    expect(el.querySelectorAll('#doc .pf-skf-trow').length).toBe(5);
  });

  it('phone / narrow: one card — the side list where the screen opens on it', () => {
    const p = q('#phone');
    expect(p.classList).toContain('pf-skp--narrow');
    expect(p.classList).toContain('pf-skp--phone-side');
    const s = src();
    expect(s).toMatch(/:host\(\.pf-skp--narrow\.pf-skp--phone-side\) \.pf-skp__main \{ display: none; \}/);
    expect(s).toMatch(/@media \(max-width: 767px\)/);
  });

  it('ONE shimmer (the kit pf-skeleton only) and static under prefers-reduced-motion', () => {
    const shapes = el.querySelectorAll('pf-skeleton');
    expect(shapes.length).toBeGreaterThan(20);
    const s = src();
    expect(s).not.toMatch(/@keyframes [a-z-]*sweep/);               // no second shimmer
    expect(s).toMatch(/prefers-reduced-motion: reduce\) \{ \.pf-skf-rise \{ animation: none !important; \} \}/);
    const kit = readFileSync(resolve(process.cwd(), 'libs/shared/src/lib/primitives/skeleton.component.ts'), 'utf8');
    expect(kit).toMatch(/prefers-reduced-motion: reduce\) \{\s*:host \{ animation: none; background-image: none; \}/);
  });

  it('colours are tokens (light + dark follow the theme)', () => {
    const s = src();
    expect(s).toMatch(/var\(--pf-line/);
    expect(s).toMatch(/var\(--pf-card-bg/);
    expect(s).toMatch(/var\(--pf-side-w, 340px\)/);
    expect(s).not.toMatch(/(?:color|background): #[0-9a-f]{3,6};/i);
  });
});
