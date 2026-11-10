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

  it('the bar renders the lent controls in place of the work areas + draft tray, and only then', () => {
    const html = readFileSync(resolve(process.cwd(), 'apps/lms/src/app/layout/top-strip/top-strip.component.html'), 'utf8');
    const at = html.indexOf('@if (formBar.template(); as formTpl)');
    const nav = html.indexOf('aria-label="Work areas"');
    const tray = html.indexOf('class="pf-draftshelf"');
    const spacer = html.indexOf('class="pf-ts-spacer');
    const close = html.indexOf('}', spacer);
    expect(at).toBeGreaterThan(0);
    expect(html.slice(at, nav)).toContain('} @else {');
    expect(at).toBeLessThan(nav);
    expect(nav).toBeLessThan(tray);
    expect(tray).toBeLessThan(spacer);
    // the else-branch closes right after the spacer: the right cluster (bell, avatar) is untouched
    expect(html.slice(spacer, close + 1)).toMatch(/pf-ts-spacer[^}]*<\/div>\s*}$/);
    expect(html.indexOf('pf-ts-right')).toBeGreaterThan(close);
  });
});
