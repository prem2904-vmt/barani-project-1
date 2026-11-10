import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CS_TOUCH_CLASS, CsStylesComponent } from './cs-styles.component';

const TOUCH = readFileSync(resolve(process.cwd(), 'apps/lms/src/app/features/casesheets/styles/_touch.scss'), 'utf8');

@Component({
  standalone: true,
  imports: [CsStylesComponent],
  template: `@if (a()) { <cs-styles /> } @if (b()) { <cs-styles /> }`,
})
class Host {
  a = signal(false);
  b = signal(false);
}

/** The lab keeps the kit as it is: the 48px raise applies only while a case-sheet screen is open. */
describe('case-sheet styles', () => {
  afterEach(() => document.documentElement.classList.remove(CS_TOUCH_CLASS));

  it('html carries cs-touch while at least one case-sheet screen is open, and loses it after', () => {
    const f = TestBed.createComponent(Host);
    const html = document.documentElement.classList;
    f.detectChanges();
    expect(html.contains(CS_TOUCH_CLASS)).toBe(false);
    f.componentInstance.a.set(true);
    f.detectChanges();
    expect(html.contains(CS_TOUCH_CLASS)).toBe(true);
    f.componentInstance.b.set(true);
    f.detectChanges();
    f.componentInstance.a.set(false);
    f.detectChanges();
    expect(html.contains(CS_TOUCH_CLASS)).toBe(true);
    f.componentInstance.b.set(false);
    f.detectChanges();
    expect(html.contains(CS_TOUCH_CLASS)).toBe(false);
  });

  it('every kit raise in _touch.scss sits inside :root.cs-touch (only the --pf-touch tokens are on :root)', () => {
    const scoped = TOUCH.indexOf(':root.cs-touch {');
    expect(scoped).toBeGreaterThan(0);
    const before = TOUCH.slice(0, scoped).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(before.replace(/\s+/g, ' ').trim()).toBe(':root { --pf-touch: 48px; --pf-dock-h: 64px; }');
    // the scoped block runs to the end of the file
    expect(TOUCH.trimEnd().endsWith('}')).toBe(true);
    expect(TOUCH.slice(scoped)).toMatch(/\.pf-btn \{/);
  });
});
