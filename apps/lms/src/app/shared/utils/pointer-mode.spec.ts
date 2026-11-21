import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { WEB_POINTER_MQ, webPointerSignal } from './pointer-mode';

// This file stubs window.matchMedia: put the REAL one back after every test so the stub never leaks into other specs
// of the combined run (a leaked "reduce" / "pointer: coarse" answer flipped motion and touch rules elsewhere).
const realMatchMedia = window.matchMedia;
afterEach(() => { Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: realMatchMedia }); });


function stub(matches: boolean) {
  let listener: ((e: MediaQueryListEvent) => void) | null = null;
  const seen: string[] = [];
  Object.defineProperty(window, 'matchMedia', {
    configurable: true, writable: true,
    value: (q: string) => {
      seen.push(q);
      return {
        matches, media: q,
        addEventListener: (_: string, fn: any) => { listener = fn; },
        removeEventListener: () => { listener = null; },
      };
    },
  });
  return { seen, fire: (m: boolean) => listener?.({ matches: m } as MediaQueryListEvent) };
}

describe('webPointerSignal', () => {
  it('uses the Order & Payments web query', () => {
    expect(WEB_POINTER_MQ).toBe('(hover: hover) and (pointer: fine)');
  });

  it('is true on a fine pointer with hover, false on touch, and reacts to changes', () => {
    const m = stub(true);
    const s = TestBed.runInInjectionContext(() => webPointerSignal());
    expect(m.seen).toContain(WEB_POINTER_MQ);
    expect(s()).toBe(true);
    m.fire(false);
    expect(s()).toBe(false);
  });

  it('starts in touch mode on a coarse pointer', () => {
    stub(false);
    const s = TestBed.runInInjectionContext(() => webPointerSignal());
    expect(s()).toBe(false);
  });
});

@Component({
  standalone: true,
  template: `<button class="pf-rowact" [class.pf-rowact--icon]="!web()" aria-label="Delegate 26124">
    <svg></svg><span class="pf-rowact__t">Delegate</span></button>`,
})
class RowActHost { readonly web = webPointerSignal(); }

describe('pf-rowact pattern (row actions: text on web, icon on touch)', () => {
  it('web renders the text button (no icon modifier)', () => {
    stub(true);
    const f = TestBed.createComponent(RowActHost);
    f.detectChanges();
    const b = f.nativeElement.querySelector('button.pf-rowact') as HTMLElement;
    expect(b.classList.contains('pf-rowact--icon')).toBe(false);
    expect(b.querySelector('.pf-rowact__t')?.textContent).toBe('Delegate');
  });

  it('touch renders the icon button, still labelled for AT', () => {
    stub(false);
    const f = TestBed.createComponent(RowActHost);
    f.detectChanges();
    const b = f.nativeElement.querySelector('button.pf-rowact') as HTMLElement;
    expect(b.classList.contains('pf-rowact--icon')).toBe(true);
    expect(b.getAttribute('aria-label')).toBe('Delegate 26124');
  });
});
