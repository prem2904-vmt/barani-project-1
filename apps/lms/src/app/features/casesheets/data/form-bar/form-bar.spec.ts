import { TemplateRef } from '@angular/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FormBarService } from './form-bar.service';

/** One bottom bar (owner 2026-11-02): an open case sheet lends Back · Pages · Next to the LMS bar. */
describe('FormBarService + the LMS bottom bar', () => {
  it('only the owner that showed the controls can take them back', () => {
    const bar = new FormBarService();
    const a = {}, b = {};
    const tA = {} as TemplateRef<unknown>, tB = {} as TemplateRef<unknown>;
    expect(bar.template()).toBeNull();
    bar.show(a, tA);
    bar.show(b, tB);
    bar.clear(a);
    expect(bar.template()).toBe(tB);
    bar.clear(b);
    expect(bar.template()).toBeNull();
  });

  it('carries the way home for the logo, and drops it with the controls', () => {
    const bar = new FormBarService();
    const o = {}, home = () => undefined;
    bar.show(o, {} as TemplateRef<unknown>, home);
    expect(bar.home()).toBe(home);
    bar.clear(o);
    expect(bar.home()).toBeNull();
  });

  it('the bar renders the lent controls in place of the work areas + draft tray, and hides the right cluster', () => {
    const html = readFileSync(resolve(process.cwd(), 'apps/lms/src/app/layout/top-strip/top-strip.component.html'), 'utf8');
    const at = html.indexOf('@if (formBar.template(); as formTpl)');
    const nav = html.indexOf('aria-label="Work areas"');
    const tray = html.indexOf('class="pf-draftshelf"');
    const spacer = html.indexOf('class="pf-ts-spacer');
    expect(at).toBeGreaterThan(0);
    expect(html.slice(at, nav)).toContain('} @else {');
    expect(html.slice(at, nav)).toContain('data-sheetbar');
    expect(at).toBeLessThan(nav);
    expect(nav).toBeLessThan(tray);
    expect(tray).toBeLessThan(spacer);
    // owner 2026-11-13: only Back · Pages · Next — the right cluster (messages, bell, avatar) goes while a sheet is open
    expect(html).toMatch(/class="pf-ts-right[^"]*"\s+\[class\.pf-ts-right--sheet\]="!!sheetHome\(\)"/);
    const scss = readFileSync(resolve(process.cwd(), 'apps/lms/src/app/layout/top-strip/top-strip.component.scss'), 'utf8');
    expect(scss).toMatch(/\.pf-ts-right--sheet\s*\{\s*display:\s*none/);
  });
});
