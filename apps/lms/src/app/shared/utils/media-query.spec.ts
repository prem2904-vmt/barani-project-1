import { TestBed } from '@angular/core/testing';
import { mediaSignal } from './media-query';

describe('mediaSignal', () => {
  const orig = window.matchMedia;
  afterEach(() => { window.matchMedia = orig; });

  it('reflects the current match and follows change events', () => {
    let listener: ((e: MediaQueryListEvent) => void) | null = null;
    window.matchMedia = ((q: string) => ({
      matches: true, media: q,
      addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => { listener = fn; },
      removeEventListener: () => { listener = null; },
    })) as unknown as typeof window.matchMedia;
    const s = TestBed.runInInjectionContext(() => mediaSignal('(max-width: 900px)'));
    expect(s()).toBe(true);
    listener!({ matches: false } as MediaQueryListEvent);
    expect(s()).toBe(false);
  });

  it('uses the fallback where matchMedia is missing', () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    expect(TestBed.runInInjectionContext(() => mediaSignal('(x)', true))()).toBe(true);
    expect(TestBed.runInInjectionContext(() => mediaSignal('(x)'))()).toBe(false);
  });
});
