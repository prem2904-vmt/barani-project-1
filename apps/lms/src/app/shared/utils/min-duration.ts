import { DestroyRef, PendingTasks, Signal, effect, inject, signal, untracked } from '@angular/core';
import { Observable, defer, materialize, dematerialize, concatMap, timer, of, map } from 'rxjs';

/**
 * PERCEIVED PERFORMANCE (owner, 2026-09-27: "if an animation would take
 * milliseconds, stretch it so the wait feels intentional — this is what
 * Apple does").
 *
 * A loading state that appears and vanishes inside ~100ms reads as a
 * flicker, not as speed. Every transition that is TRIGGERED BY A LOAD holds
 * its loading look (skeleton, veil) for a minimum time, so it plays as one
 * calm motion. Taps that do not load stay instant: nothing here runs unless
 * a load is actually in flight.
 *
 *   withMinDuration(obs$, 600)          RxJS — hold values/complete/error
 *   heldFlag(source, 600)               Signal — true for >= 600ms once on
 *   createMinDurationFlag(600)          Imperative start()/stop() flag
 */

/** Default hold for a load-driven transition (skeleton → content). */
export const MIN_LOAD_MS = 600;
/** Branch switch: long enough to read as a deliberate change of place. */
export const MIN_BRANCH_MS = 750;

/** Clock seam (fake timers drive Date.now; performance.now may be real). */
const now = (): number => Date.now();

/**
 * Hold every notification of `source$` until at least `ms` have passed since
 * subscription. Values that arrive later pass straight through (no extra
 * delay once the minimum is met). Errors are held the same way, so an error
 * state never flashes either.
 */
export function withMinDuration<T>(source$: Observable<T>, ms: number = MIN_LOAD_MS): Observable<T> {
  if (!(ms > 0)) return source$;
  return defer(() => {
    const start = now();
    return source$.pipe(
      materialize(),
      concatMap(n => {
        const wait = start + ms - now();
        return wait > 0 ? timer(wait).pipe(map(() => n)) : of(n);
      }),
      dematerialize(),
    );
  });
}

/** An imperative loading flag with a minimum on-time. */
export interface MinDurationFlag {
  /** True from start() until stop() AND the minimum has elapsed. */
  readonly active: Signal<boolean>;
  /** Turn on (restarts the minimum window if already on). */
  start(): void;
  /** Request off; honoured once the minimum window has elapsed. */
  stop(): void;
  /** Off at once (e.g. the view is going away, reduced motion). */
  cancel(): void;
}

export function createMinDurationFlag(ms: number = MIN_LOAD_MS): MinDurationFlag {
  const active = signal(false);
  let startedAt = 0;
  let pending: ReturnType<typeof setTimeout> | null = null;
  const clear = () => { if (pending !== null) { clearTimeout(pending); pending = null; } };
  return {
    active: active.asReadonly(),
    start() {
      clear();
      startedAt = now();
      active.set(true);
    },
    stop() {
      if (!active()) return;
      clear();
      const wait = startedAt + ms - now();
      if (wait <= 0) { active.set(false); return; }
      pending = setTimeout(() => { pending = null; active.set(false); }, wait);
    },
    cancel() { clear(); active.set(false); },
  };
}

/**
 * Signal helper: mirrors `source` but, once it turns true, stays true for at
 * least `ms`. Must be called in an injection context (it owns an effect).
 * A source that is already true at creation starts the window then.
 */
export function heldFlag(source: Signal<boolean>, ms: number = MIN_LOAD_MS): Signal<boolean> {
  const flag = createMinDurationFlag(ms);
  // A held skeleton is pending UI work: the app is not "stable" until the
  // real content is on screen (whenStable in specs, stability hooks).
  const tasks = inject(PendingTasks);
  let release: (() => void) | null = null;
  const settle = () => { if (release) { release(); release = null; } };
  inject(DestroyRef).onDestroy(() => { flag.cancel(); settle(); });
  effect(() => {
    const on = source();
    untracked(() => {
      if (on && !flag.active()) flag.start();
      else if (!on) flag.stop();
    });
  });
  effect(() => {
    if (flag.active()) { if (!release) release = tasks.add(); }
    else settle();
  });
  // First read before the effect has run (template's first pass): trust the
  // source so a load that is already in flight shows its skeleton at once.
  if (untracked(source)) flag.start();
  return flag.active;
}

/**
 * A FIRST-LOAD skeleton flag (ND-PATTERN "Loading feedback"): on from the
 * very first frame (created in a field initializer, so the template's first
 * pass already draws the skeleton — never a blank form), held
 * {@link MIN_LOAD_MS} once the data arrives asynchronously, and skipped
 * entirely when the data was already there in the same turn (a cache, a
 * synchronous test double) — nothing to wait for, nothing to show.
 *
 *   private readonly hold = createLoadHold(!!id);
 *   readonly skeleton = this.hold.active;
 *   …subscribe({ next: v => { use(v); this.hold.done(); }, error: () => this.hold.done() })
 */
export interface LoadHold {
  /** True while the skeleton should show. */
  readonly active: Signal<boolean>;
  /** The load answered (success or error): release after the minimum. */
  done(): void;
  /** Off at once (the view is going away). */
  cancel(): void;
}

export function createLoadHold(on = true, ms: number = MIN_LOAD_MS): LoadHold {
  const flag = createMinDurationFlag(ms);
  let sameTurn = true;
  if (on) flag.start();
  queueMicrotask(() => { sameTurn = false; });
  return {
    active: flag.active,
    done() { if (sameTurn) flag.cancel(); else flag.stop(); },
    cancel() { flag.cancel(); },
  };
}
