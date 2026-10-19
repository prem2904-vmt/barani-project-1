import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SKELETON_KIT } from './skeleton-kit.component';

/**
 * The skeleton kit — the only loading look (owner, 2026-09-27: "I don't
 * want the PF loading anywhere, just an animation and skeleton loading in
 * that part").
 */
@Component({
  standalone: true,
  imports: [...SKELETON_KIT],
  template: `
    <pf-skeleton-rows id="rows" [rows]="4" label="Loading vendors…"></pf-skeleton-rows>
    <pf-skeleton-rows id="dense" [rows]="2" [dense]="true" [avatar]="false" [trailing]="false"></pf-skeleton-rows>
    <pf-skeleton-table id="table" [rows]="3" [cols]="4" label="Loading prices…"></pf-skeleton-table>
    <pf-skeleton-card id="card" [lines]="4" label="Loading layout…"></pf-skeleton-card>
    <pf-skeleton-detail id="detail" [fields]="6" [sections]="2" label="Opening patient…"></pf-skeleton-detail>
    <pf-skeleton-form id="form" [fields]="5" label="Loading the form…"></pf-skeleton-form>
    <pf-skeleton-tiles id="tiles" [count]="3" label="Loading slots…"></pf-skeleton-tiles>
    <button type="button">Save <pf-busy label="Saving"></pf-busy></button>
  `,
})
class Host {}

function render() {
  const f = TestBed.createComponent(Host);
  f.detectChanges();
  return f.nativeElement as HTMLElement;
}

describe('skeleton kit', () => {
  it('every preset is an aria-busy, polite loading region with a readable label', () => {
    const el = render();
    for (const [id, label] of [['rows', 'Loading vendors…'], ['table', 'Loading prices…'], ['card', 'Loading layout…'],
      ['detail', 'Opening patient…'], ['form', 'Loading the form…'], ['tiles', 'Loading slots…'], ['dense', 'Loading…']]) {
      const r = el.querySelector('#' + id)!;
      expect(r.getAttribute('role')).toBe('status');
      expect(r.getAttribute('aria-busy')).toBe('true');
      expect(r.getAttribute('aria-live')).toBe('polite');
      expect(r.querySelector('.sr-only')!.textContent!.trim()).toBe(label);
    }
  });

  it('draws the SHAPE of the area: rows, table rows × cols, form fields, tiles', () => {
    const el = render();
    const rows = el.querySelectorAll('#rows li');
    expect(rows.length).toBe(4);
    expect(rows[0].querySelector('pf-skeleton[data-variant="circle"]')).not.toBeNull();   // avatar
    expect(rows[0].querySelector('pf-skeleton[data-variant="pill"]')).not.toBeNull();     // status pill
    const dense = el.querySelectorAll('#dense li');
    expect(dense.length).toBe(2);
    expect(dense[0].querySelector('pf-skeleton[data-variant="circle"]')).toBeNull();
    expect(el.querySelectorAll('#table .tr').length).toBe(4);                               // header + 3
    expect(el.querySelectorAll('#table .tr:not(.th)')[0].querySelectorAll('pf-skeleton').length).toBe(4);
    expect(el.querySelectorAll('#form .fld').length).toBe(5);
    expect(el.querySelectorAll('#tiles .tile').length).toBe(3);
    expect(el.querySelectorAll('#detail .kv__cell').length).toBe(6);
    expect(el.querySelectorAll('#detail .sec').length).toBe(2);
  });

  it('the placeholder shapes are hidden from assistive tech (only the label is read)', () => {
    const el = render();
    el.querySelectorAll('pf-skeleton').forEach(s => expect(s.getAttribute('aria-hidden')).toBe('true'));
  });

  it('pf-busy is a small inline indicator for buttons, labelled for screen readers', () => {
    const el = render();
    const b = el.querySelector('button pf-busy')!;
    expect(b.querySelectorAll('.dots i').length).toBe(3);
    expect(b.querySelector('.sr-only')!.textContent).toBe('Saving');
  });

  it('shimmer is theme-aware and switches off under reduced motion', () => {
    const src = readFileSync(resolve(process.cwd(), 'apps/lms/src/app/shared/primitives/skeleton.component.ts'), 'utf8');
    expect(src).toMatch(/:host-context\(\.light\)/);
    expect(src).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*:host \{ animation: none; background-image: none; \}/);
    const kit = readFileSync(resolve(process.cwd(), 'apps/lms/src/app/shared/primitives/skeleton-kit.component.ts'), 'utf8');
    expect(kit).toMatch(/prefers-reduced-motion: reduce\) \{ \.pf-skel-rise \{ animation: none; \} \}/);
    expect(kit).toMatch(/prefers-reduced-motion: reduce\) \{ \.dots i \{ animation: none;/);
  });
});

/**
 * The PF logo is BRANDING, not a loader: only the sign-in screen may render
 * <pf-loading-logo>. Everything else uses the skeleton kit.
 */
describe('no PF-logo loaders outside sign-in', () => {
  const APP = resolve(process.cwd(), 'apps/lms/src/app');
  const ALLOWED = new Set([
    'features/login/login.component.ts',
    'features/login/login.component.html',
    'shared/components/loading-logo/loading-logo.component.ts',
    'shared/components/loading-logo/loading-logo.component.html',
    // PENDING (2026-09-27): /pathologist is being reworked in parallel by
    // another stream; its validation loader moves to <pf-skeleton-detail>
    // with that work. Remove this line once it lands.
    'features/pathologist/validate-result/validate-result.component.ts',
  ]);
  function walk(dir: string, out: string[] = []): string[] {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|html)$/.test(n) && !/\.spec\.ts$/.test(n)) out.push(p);
    }
    return out;
  }

  it('LoadingLogoComponent / <pf-loading-logo> appear only on the sign-in screen', () => {
    const offenders = walk(APP)
      .map(p => p.slice(APP.length + 1))
      .filter(rel => !ALLOWED.has(rel))
      .filter(rel => {
        const src = readFileSync(join(APP, rel), 'utf8');
        return /<pf-loading-logo\b/.test(src) || /\bLoadingLogoComponent\b/.test(src);
      });
    expect(offenders).toEqual([]);
  });
});
