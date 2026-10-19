import { Injector, runInInjectionContext, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import {
  BUSY_MIN_SHOW_MS, BUSY_SHOW_AFTER_MS, busyWhile, createSpinDelay, prefersReducedMotion, spinDelay,
} from './busy';

describe('busy (loading feedback timing)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('the standard thresholds: dots after 150ms, held 300ms', () => {
    expect(BUSY_SHOW_AFTER_MS).toBe(150);
    expect(BUSY_MIN_SHOW_MS).toBe(300);
  });

  describe('createSpinDelay', () => {
    it('a fast answer never shows the indicator (no flicker)', () => {
      const m = createSpinDelay();
      m.set(true);
      vi.advanceTimersByTime(BUSY_SHOW_AFTER_MS - 1);
      expect(m.shown()).toBe(false);
      m.set(false);
      vi.advanceTimersByTime(1000);
      expect(m.shown()).toBe(false);
    });

    it('a slow answer shows it once the delay passes', () => {
      const m = createSpinDelay();
      m.set(true);
      vi.advanceTimersByTime(BUSY_SHOW_AFTER_MS);
      expect(m.shown()).toBe(true);
    });

    it('once shown, it is held for the minimum even if the work ends at once', () => {
      const m = createSpinDelay();
      m.set(true);
      vi.advanceTimersByTime(BUSY_SHOW_AFTER_MS);
      m.set(false);
      expect(m.shown()).toBe(true);
      vi.advanceTimersByTime(BUSY_MIN_SHOW_MS - 1);
      expect(m.shown()).toBe(true);
      vi.advanceTimersByTime(1);
      expect(m.shown()).toBe(false);
    });

    it('turns off at once when it has already been on long enough', () => {
      const m = createSpinDelay();
      m.set(true);
      vi.advanceTimersByTime(BUSY_SHOW_AFTER_MS + BUSY_MIN_SHOW_MS + 50);
      m.set(false);
      expect(m.shown()).toBe(false);
    });

    it('busy again during the hold keeps it on (no gap)', () => {
      const m = createSpinDelay();
      m.set(true);
      vi.advanceTimersByTime(BUSY_SHOW_AFTER_MS);
      m.set(false);
      vi.advanceTimersByTime(100);
      m.set(true);
      vi.advanceTimersByTime(1000);
      expect(m.shown()).toBe(true);
    });

    it('custom delay / minimum; delay 0 shows at once', () => {
      const m = createSpinDelay({ delay: 0, minDuration: 50 });
      m.set(true);
      expect(m.shown()).toBe(true);
      m.set(false);
      vi.advanceTimersByTime(50);
      expect(m.shown()).toBe(false);
    });

    it('dispose clears pending timers and turns off', () => {
      const m = createSpinDelay();
      m.set(true);
      m.dispose();
      vi.advanceTimersByTime(1000);
      expect(m.shown()).toBe(false);
    });
  });

  describe('spinDelay (signal)', () => {
    it('follows the source through the delay', () => {
      const src = signal(false);
      const shown = runInInjectionContext(TestBed.inject(Injector), () => spinDelay(src));
      src.set(true);
      TestBed.tick();
      vi.advanceTimersByTime(BUSY_SHOW_AFTER_MS);
      expect(shown()).toBe(true);
      src.set(false);
      TestBed.tick();
      vi.advanceTimersByTime(BUSY_MIN_SHOW_MS);
      expect(shown()).toBe(false);
    });
  });

  describe('busyWhile', () => {
    it('is true from subscribe until complete', () => {
      const flag = signal(false);
      const src = new Subject<number>();
      const obs = src.pipe(busyWhile(flag));
      expect(flag()).toBe(false);                 // lazy: nothing until subscribed
      obs.subscribe();
      expect(flag()).toBe(true);
      src.next(1);
      expect(flag()).toBe(true);
      src.complete();
      expect(flag()).toBe(false);
    });

    it('turns off on error and on unsubscribe', () => {
      const flag = signal(false);
      throwError(() => new Error('x')).pipe(busyWhile(flag)).subscribe({ error: () => { /* expected */ } });
      expect(flag()).toBe(false);
      const sub = new Subject<number>().pipe(busyWhile(flag)).subscribe();
      expect(flag()).toBe(true);
      sub.unsubscribe();
      expect(flag()).toBe(false);
    });

    it('passes values through untouched', () => {
      const flag = signal(false);
      const seen: number[] = [];
      of(1, 2).pipe(busyWhile(flag)).subscribe(v => seen.push(v));
      expect(seen).toEqual([1, 2]);
    });
  });

  it('prefersReducedMotion reads the media query safely', () => {
    const orig = globalThis.matchMedia;
    try {
      (globalThis as { matchMedia?: unknown }).matchMedia = (q: string) => ({ matches: q.includes('reduce') });
      expect(prefersReducedMotion()).toBe(true);
      (globalThis as { matchMedia?: unknown }).matchMedia = undefined;
      expect(prefersReducedMotion()).toBe(false);
    } finally {
      (globalThis as { matchMedia?: unknown }).matchMedia = orig;
    }
  });
});

describe('afterNextPaint', () => {
  it('runs after the next frame, never synchronously', async () => {
    const { afterNextPaint } = await import('./busy');
    let ran = false;
    afterNextPaint(() => { ran = true; });
    expect(ran).toBe(false);
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 5)));
    expect(ran).toBe(true);
  });
});
