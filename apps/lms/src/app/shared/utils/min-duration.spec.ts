import { Injector, runInInjectionContext, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { createMinDurationFlag, heldFlag, withMinDuration } from './min-duration';

describe('min-duration (perceived performance)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  describe('withMinDuration', () => {
    it('holds a fast value until the minimum has passed', () => {
      const seen: number[] = [];
      let done = false;
      withMinDuration(of(1), 600).subscribe({ next: v => seen.push(v), complete: () => (done = true) });
      expect(seen).toEqual([]);
      vi.advanceTimersByTime(599);
      expect(seen).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(seen).toEqual([1]);
      expect(done).toBe(true);
    });

    it('lets a slow value through without extra delay', () => {
      const src = new Subject<string>();
      const seen: string[] = [];
      withMinDuration(src, 600).subscribe(v => seen.push(v));
      vi.advanceTimersByTime(900);
      src.next('late');
      expect(seen).toEqual(['late']);
    });

    it('holds errors too, so an error state never flashes', () => {
      let err: unknown = null;
      withMinDuration(throwError(() => new Error('x')), 500).subscribe({ error: e => (err = e) });
      vi.advanceTimersByTime(499);
      expect(err).toBeNull();
      vi.advanceTimersByTime(1);
      expect((err as Error).message).toBe('x');
    });

    it('a 0ms minimum is a pass-through', () => {
      const seen: number[] = [];
      withMinDuration(of(7), 0).subscribe(v => seen.push(v));
      expect(seen).toEqual([7]);
    });
  });

  describe('createMinDurationFlag', () => {
    it('stays on for the minimum even when stopped at once', () => {
      const f = createMinDurationFlag(600);
      f.start();
      f.stop();
      expect(f.active()).toBe(true);
      vi.advanceTimersByTime(600);
      expect(f.active()).toBe(false);
    });

    it('turns off immediately when the load outlasted the minimum', () => {
      const f = createMinDurationFlag(300);
      f.start();
      vi.advanceTimersByTime(1000);
      f.stop();
      expect(f.active()).toBe(false);
    });

    it('cancel() is instant', () => {
      const f = createMinDurationFlag(600);
      f.start();
      f.cancel();
      expect(f.active()).toBe(false);
    });
  });

  describe('heldFlag', () => {
    it('mirrors the source with a minimum on-time', () => {
      const injector = TestBed.inject(Injector);
      const src = signal(false);
      const held = runInInjectionContext(injector, () => heldFlag(src, 600));
      expect(held()).toBe(false);
      src.set(true);
      TestBed.tick();
      expect(held()).toBe(true);
      src.set(false);
      TestBed.tick();
      expect(held()).toBe(true);           // held
      vi.advanceTimersByTime(600);
      expect(held()).toBe(false);
    });

    it('a source already true at creation shows at once', () => {
      const injector = TestBed.inject(Injector);
      const held = runInInjectionContext(injector, () => heldFlag(signal(true), 600));
      expect(held()).toBe(true);
    });
  });
});
