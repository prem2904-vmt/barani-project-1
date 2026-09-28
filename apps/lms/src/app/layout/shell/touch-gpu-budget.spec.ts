import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AmbientBgComponent } from '../../shared/components/ambient-bg/ambient-bg.component';
import { guardTransition } from '../../core/navigation/zoom-transition';

/**
 * iPad (owner, 2026-09-28): stutter, the docked navbar missing, and a
 * Frontdesk frame only partly painted. iPad WebKit drops compositing layers
 * under GPU pressure; the pressure was live frost (backdrop-filter) over an
 * ever-animating ambient background. Touch devices get a GPU budget; the
 * desktop look must not change (every rule is html.device-touch-scoped).
 */
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const global = read('apps/lms/src/styles.scss');
const shell = read('apps/lms/src/app/layout/shell/shell.component.ts');
const ambient = read('apps/lms/src/app/shared/components/ambient-bg/ambient-bg.component.ts');

const touchBlock = global.slice(global.indexOf('Touch devices: GPU budget'));

describe('Touch GPU budget — global surfaces', () => {
  it('large in-flow surfaces drop the live blur on touch only', () => {
    expect(touchBlock).toMatch(/html\.device-touch \{/);
    const rule = touchBlock.slice(touchBlock.indexOf('html.device-touch {'));
    for (const sel of ['.glass-card', '.pf-card', 'pf-tile']) expect(rule).toContain(sel);
    expect(rule).toMatch(/backdrop-filter:\s*none !important/);
    expect(rule).toMatch(/-webkit-backdrop-filter:\s*none !important/);
  });

  it('desktop keeps its frost: the base .glass-card / .pf-card rules still blur', () => {
    expect(global).toMatch(/\.glass-card \{[^}]*backdrop-filter:\s*blur\(20px\)/);
    expect(global).toMatch(/\.pf-card \{[^}]*backdrop-filter:\s*blur\(20px\)/);
  });

  it('forever-loops in the app bar stop on touch (wordmark beat, bell wiggle)', () => {
    expect(touchBlock).toMatch(/\.pf-brand-name,\s*\n\s*\.pf-bell-btn\.has-unread svg \{\s*\n\s*animation:\s*none !important/);
  });
});

describe('Touch GPU budget — the docked bar', () => {
  const rule = shell.slice(shell.indexOf(':host-context(html.device-touch.design-new.nav-bottom) .pf-chrome {'));
  const body = rule.slice(0, rule.indexOf('}'));

  it('opaque surface, no backdrop-filter, one promoted layer — on touch only', () => {
    expect(body).toMatch(/background-color:\s*var\(--pf-navbar-bg\)/);
    expect(body).toMatch(/backdrop-filter:\s*none/);
    expect(body).toMatch(/will-change:\s*transform/);
    // Not a transform: that would re-home the bar's fixed children differently.
    expect(body).not.toMatch(/transform:\s*translate/);
  });

  it('desktop / non-touch bar keeps the glass', () => {
    expect(shell).toMatch(/:host-context\(\.design-new\.nav-bottom\) \.pf-chrome \{[^}]*backdrop-filter:\s*blur\(18px\)/);
  });
});

describe('Touch GPU budget — ambient background', () => {
  it('touch: static flow (no animation, one viewport tall) and no drifting glyphs', () => {
    expect(ambient).toMatch(/:host-context\(html\.device-touch\) \.dna-flow \{\s*\n\s*animation:\s*none;\s*\n\s*height:\s*100%;/);
    expect(ambient).toMatch(/:host-context\(html\.device-touch\) \.float-layer \{ display: none; \}/);
  });

  it('desktop keeps the drift (the base animation is still declared)', () => {
    expect(ambient).toMatch(/animation:\s*pf-dna-scroll 40s linear infinite/);
  });

  it('pauses while the page is hidden, resumes when visible', () => {
    const fixture = TestBed.createComponent(AmbientBgComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.classList.contains('is-paused')).toBe(false);

    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    fixture.detectChanges();
    expect(host.classList.contains('is-paused')).toBe(true);

    vis.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    fixture.detectChanges();
    expect(host.classList.contains('is-paused')).toBe(false);
    vis.mockRestore();
    expect(ambient).toMatch(/:host\(\.is-paused\) \.dna-flow,\s*\n\s*:host\(\.is-paused\) \.float \{ animation-play-state: paused; \}/);
  });
});

describe('View transitions can never hang the screen', () => {
  function fakeTransition() {
    let resolve!: () => void;
    const finished = new Promise<void>(r => { resolve = r; });
    const t = { finished, skipTransition: vi.fn(() => resolve()) };
    return { t, resolve };
  }
  afterEach(() => vi.useRealTimers());

  it('skipped after the time budget if still running', () => {
    vi.useFakeTimers();
    const { t } = fakeTransition();
    guardTransition(t, document, 2000);
    vi.advanceTimersByTime(1999);
    expect(t.skipTransition).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(t.skipTransition).toHaveBeenCalledTimes(1);
  });

  it('skipped the moment the page is hidden (app switch / lock)', () => {
    const { t } = fakeTransition();
    guardTransition(t, document, 2000);
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    vis.mockRestore();
    expect(t.skipTransition).toHaveBeenCalledTimes(1);
  });

  it('a finished transition is left alone', async () => {
    vi.useFakeTimers();
    const { t, resolve } = fakeTransition();
    guardTransition(t, document, 2000);
    resolve();
    await Promise.resolve(); await Promise.resolve();
    vi.advanceTimersByTime(5000);
    expect(t.skipTransition).not.toHaveBeenCalled();
  });
});
