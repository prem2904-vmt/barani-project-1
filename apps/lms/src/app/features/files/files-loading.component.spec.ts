import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ThemeService } from '../../core/services/theme.service';
import { FilesLoadingComponent, FilesLoadingMode } from './files-loading.component';
import { FILES_APPS } from './files-registry';

function make(app: string, mode?: FilesLoadingMode) {
  TestBed.configureTestingModule({ providers: [{ provide: ThemeService, useValue: { mode: signal('light'), isDark: () => false } }] });
  const fixture = TestBed.createComponent(FilesLoadingComponent);
  fixture.componentRef.setInput('app', app);
  if (mode) fixture.componentRef.setInput('mode', mode);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, el, q: (s: string) => el.querySelector(s), all: (s: string) => el.querySelectorAll(s) };
}
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
/** The component's own stylesheet (emulated encapsulation puts it in <head>). */
const css = () => Array.from(document.head.querySelectorAll('style')).map(s => s.textContent ?? '').join('\n');

describe('FilesLoadingComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('is ONE polite live region named after the app; every drawn shape is hidden from assistive tech', () => {
    for (const a of FILES_APPS) {
      TestBed.resetTestingModule();
      const { el, q } = make(a.id);
      expect(el.getAttribute('role')).toBe('status');
      expect(el.getAttribute('aria-live')).toBe('polite');
      expect(el.getAttribute('aria-label')).toBe(`Opening ${a.name}…`);
      expect(el.getAttribute('data-app')).toBe(a.id);
      expect(q('.fl')?.getAttribute('aria-hidden')).toBe('true');
      expect(text(q('[data-testid="files-loading-pill"]'))).toBe(`Opening ${a.name}…`);
      expect(q(`[data-testid="files-loading-pill"] [data-files-logo="${a.id}"]`)).toBeTruthy();   // the app's own logo, not a spinner
    }
  });

  it('Neuron draws a sheet: column letters, row numbers, A1 selected, a formula bar showing A1, the Sheet1 tab', () => {
    const { q, all } = make('neuron');
    expect(q('[data-testid="files-loader-neuron-file"]')).toBeTruthy();
    const cols = Array.from(all('.fl-sheet__cols span:not(.fl-corner)')).map(s => s.textContent?.trim());
    expect(cols.slice(0, 5)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(cols).toContain('AA');
    expect(all('.fl-sheet__rows span').length).toBeGreaterThanOrEqual(40);
    expect(q('.fl-sheet__cols .on')?.textContent?.trim()).toBe('A');
    expect(q('.fl-sheet__rows .on')?.textContent?.trim()).toBe('1');
    expect(q('.fl-a1')).toBeTruthy();
    expect(text(q('.fl-fx__box'))).toBe('A1');
    expect(text(q('.fl-sheettab'))).toBe('Sheet1');
    expect(all('.fl-cellbar').length).toBeGreaterThan(5);
    expect(text(q('.fl-tabs .on'))).toBe('Home');
    expect(text(q('.fl-tabs'))).toContain('Formulas');
  });

  it('Synapse draws its ribbon, a ruler and a page with a heading and text lines', () => {
    const { q, all } = make('synapse');
    expect(q('[data-testid="files-loader-synapse-file"]')).toBeTruthy();
    expect(text(q('.fl-tabs'))).toContain('References');
    expect(q('.fl-ruler')).toBeTruthy();
    expect(q('.fl-page--doc .fl-b--h1')).toBeTruthy();
    expect(all('.fl-page--doc .fl-b--line').length).toBeGreaterThan(8);
    expect(q('.fl-sheet')).toBeNull();
  });

  it('Axon draws the thumbnail rail (slide 1 selected) and a 16:9 slide with title and subtitle placeholders', () => {
    const { q, all } = make('axon');
    expect(text(q('.fl-tabs'))).toContain('Slide Show');
    expect(all('.fl-rail__t').length).toBe(3);
    expect(q('.fl-rail__t.on')).toBe(all('.fl-rail__t')[0]);
    expect(q('.fl-slide .fl-ph--title')).toBeTruthy();
    expect(q('.fl-slide .fl-ph--sub')).toBeTruthy();
    expect(text(q('.fl-status'))).toContain('Slide 1 of 1');
  });

  it('Myelin draws a thin toolbar, the tools panel, a PDF page and a page-number chip', () => {
    const { q, all } = make('myelin');
    expect(text(q('.fl-pdfbar'))).toContain('All tools');
    expect(q('.fl-page--pdf')).toBeTruthy();
    expect(all('.fl-page--pdf .fl-trow').length).toBeGreaterThan(3);
    expect(text(q('.fl-pagechip'))).toBe('1');
    expect(q('.fl-ribbon')).toBeNull();
  });

  it('Retina draws a menu bar, a tool rail and a checkerboard canvas with an image placeholder', () => {
    const { q, all } = make('retina');
    expect(text(q('.fl-menubar'))).toContain('Filter');
    expect(all('.fl-toolrail i').length).toBeGreaterThan(10);
    expect(q('.fl-checker svg')).toBeTruthy();
    expect(q('.fl-panels')).toBeTruthy();
  });

  it('START mode mirrors the app\'s own start screen (side nav, New tiles, Recent), never the editor', () => {
    const n = make('neuron', 'start');
    expect(n.q('[data-testid="files-loader-neuron-start"]')).toBeTruthy();
    expect(n.q('.fl-sheet')).toBeNull();
    expect(n.q('.fl-nav--solid')).toBeTruthy();
    expect(Array.from(n.all('.fl-nav__i')).map(e => text(e))).toEqual(['Back', 'Home', 'New', 'Open']);
    expect(text(n.q('.fl-nav__i.on'))).toBe('Home');
    expect(n.all('.fl-tile').length).toBe(4);                       // blank workbook + the three built-in sheets
    expect(text(n.q('.fl-home__body'))).toContain('Recent');
    TestBed.resetTestingModule();
    const s = make('synapse', 'start');
    expect(s.all('.fl-tile').length).toBe(3);
    expect(s.all('.fl-tile .fl-thumb__plus').length).toBe(3);
    expect(Array.from(s.all('.fl-nav__i')).map(e => text(e))).toContain('Save As');
    TestBed.resetTestingModule();
    const x = make('axon', 'start');
    expect(x.q('.fl-nav--solid')).toBeNull();                      // Axon's start nav is the light one
    expect(text(x.q('.fl-title'))).toBe('Axon');
    expect(x.all('.fl-thumb[data-kind="axon"]').length).toBe(3);
    TestBed.resetTestingModule();
    const m = make('myelin', 'start');
    expect(m.all('.fl-card').length).toBe(2);
    expect(m.q('.fl-page--pdf')).toBeNull();
    TestBed.resetTestingModule();
    const r = make('retina', 'start');
    expect(r.all('.fl-orow').length).toBe(2);
    expect(r.q('.fl-checker')).toBeNull();
  });

  it('switches layout when the inputs change (no stale screen)', () => {
    const { fixture, q } = make('neuron');
    expect(q('.fl-sheet')).toBeTruthy();
    fixture.componentRef.setInput('mode', 'start');
    fixture.detectChanges();
    expect(q('.fl-sheet')).toBeNull();
    expect(q('[data-testid="files-loader-neuron-start"]')).toBeTruthy();
    fixture.componentRef.setInput('app', 'retina');
    fixture.componentRef.setInput('mode', 'file');
    fixture.detectChanges();
    expect(q('.fl-checker')).toBeTruthy();
  });

  it('an unknown app falls back to the first app (as the editor does)', () => {
    const { el } = make('nope');
    expect(el.getAttribute('data-app')).toBe(FILES_APPS[0].id);
  });

  it('the first-time hint is there but waits 3 s (CSS delay, no timer); reduced motion drops the shimmer and fades', () => {
    const { q } = make('neuron');
    expect(text(q('[data-testid="files-loading-hint"]'))).toContain('first time can take a moment');
    const sheet = css();
    expect(sheet).toMatch(/fl-hint[^}]*3s/);
    const reduced = sheet.slice(sheet.indexOf('prefers-reduced-motion'));
    expect(reduced).toMatch(/\.fl-b\[[^\]]*\]\s*\{\s*animation:\s*none;\s*background-image:\s*none/);
    expect(reduced).toMatch(/transition:\s*none/);
    expect(sheet).toMatch(/pf-fl-leave[^{]*\{\s*opacity:\s*0/);      // the 200 ms fade-out class the editor sets once ready
    expect(sheet).not.toMatch(/\bAI\b/);
  });
});
