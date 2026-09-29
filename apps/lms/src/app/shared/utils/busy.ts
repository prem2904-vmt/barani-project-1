import { DestroyRef, Signal, WritableSignal, effect, inject, signal, untracked } from '@angular/core';
import { MonoTypeOperatorFunction, Observable, defer, finalize } from 'rxjs';

/**
 * LOADING FEEDBACK — the timing rules every "this takes a moment" state
 * follows (owner, 2026-09-29: "wherever there is an action that takes time,
 * there needs to be an animation so the user feels something is happening").
 *
 *   1. INSTANT press feedback, always: the control that was pressed turns
 *      busy (aria-busy, dimmed, not clickable again) in the same frame.
 *   2. The MOVING indicator (busy dots, top progress bar) appears only when
 *      the wait passes {@link BUSY_SHOW_AFTER_MS} — a fast answer never
 *      flickers a spinner.
 *   3. Once it has appeared it stays for at least {@link BUSY_MIN_SHOW_MS},
 *      so it reads as one calm motion instead of a flash.
 *
 *   spinDelay(source)        Signal: source, delayed on / held off (1 + 2 + 3)
 *   busyWhile(flag)          RxJS: flag = true while the request runs
 *   prefersReducedMotion()   the OS "reduce motion" setting, read safely
 *
 * Skeletons for regions use the skeleton kit + `heldFlag` (min-duration.ts);
 * buttons use the `[pfBusy]` directive; route changes use the global
 * `<pf-route-progress>` bar. See docs/ND-PATTERN.md "Loading feedback".
 */

/** Waits shorter than this show no moving indicator (no flicker). */
export const BUSY_SHOW_AFTER_MS = 150;
/** A moving indicator, once shown, stays at least this long. */
export const BUSY_MIN_SHOW_MS = 300;

export interface SpinDelayOptions {
  /** Delay before the indicator shows (default {@link BUSY_SHOW_AFTER_MS}). */
  delay?: number;
  /** Minimum on-time once shown (default {@link BUSY_MIN_SHOW_MS}). */
  minDuration?: number;
}

/** Clock seam (fake timers drive Date.now). */
const now = (): number => Date.now();

/**
 * A pure state machine behind {@link spinDelay} — usable outside an injection
 * context (directives that own their own timers, services, tests).
 */
export interface SpinDelayMachine {
  /** True while the moving indicator should be on screen. */
  readonly shown: Signal<boolean>;
  /** Feed the raw busy state. */
  set(busy: boolean): void;
  /** Off at once, timers cleared (the owner is going away). */
  dispose(): void;
}

export function createSpinDelay(opts: SpinDelayOptions = {}): SpinDelayMachine {
  const delay = Math.max(0, opts.delay ?? BUSY_SHOW_AFTER_MS);
  const minDuration = Math.max(0, opts.minDuration ?? BUSY_MIN_SHOW_MS);
  const shown = signal(false);
  let busy = false;
  let shownAt = 0;
  let showTimer: ReturnType<typeof setTimeout> | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  const clearShow = () => { if (showTimer !== null) { clearTimeout(showTimer); showTimer = null; } };
  const clearHide = () => { if (hideTimer !== null) { clearTimeout(hideTimer); hideTimer = null; } };
  const show = () => { showTimer = null; if (busy) { shownAt = now(); shown.set(true); } };
  return {
    shown: shown.asReadonly(),
    set(next: boolean) {
      busy = next;
      if (next) {
        clearHide();
        if (shown() || showTimer !== null) return;
        if (delay === 0) show();
        else showTimer = setTimeout(show, delay);
        return;
      }
      clearShow();
      if (!shown()) return;
      const wait = shownAt + minDuration - now();
      if (wait <= 0) { shown.set(false); return; }
      clearHide();
      hideTimer = setTimeout(() => { hideTimer = null; if (!busy) shown.set(false); }, wait);
    },
    dispose() { clearShow(); clearHide(); busy = false; shown.set(false); },
  };
}

/**
 * Signal helper: follows `source`, but only turns on after it has been true
 * for `delay` ms, and once on stays on for at least `minDuration` ms. Must be
 * called in an injection context (it owns an effect).
 */
export function spinDelay(source: Signal<boolean>, opts: SpinDelayOptions = {}): Signal<boolean> {
  const m = createSpinDelay(opts);
  inject(DestroyRef).onDestroy(() => m.dispose());
  effect(() => {
    const on = source();
    untracked(() => m.set(on));
  });
  return m.shown;
}

/**
 * `flag` is true from subscribe until the request completes, errors or is
 * unsubscribed — the one-liner for "this button is busy while it saves":
 *
 *   this.api.post(url, body).pipe(busyWhile(this.saving)).subscribe(...)
 */
export function busyWhile<T>(flag: WritableSignal<boolean>): MonoTypeOperatorFunction<T> {
  return (source$: Observable<T>) => defer(() => {
    flag.set(true);
    return source$.pipe(finalize(() => flag.set(false)));
  });
}

/** The OS "reduce motion" preference (false where matchMedia is missing). */
export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Run `fn` right after the browser has painted the current frame — for a tap
 * whose work is heavy and synchronous (a navigation that instantiates a big
 * screen from an already-loaded chunk): set the pressed / busy state first,
 * then `afterNextPaint(() => router.navigate(...))`, so the press is on
 * screen BEFORE the main thread gets busy. Falls back to a macrotask where
 * requestAnimationFrame is missing.
 */
export function afterNextPaint(fn: () => void): void {
  if (typeof requestAnimationFrame !== 'function') { setTimeout(fn, 0); return; }
  requestAnimationFrame(() => setTimeout(fn, 0));
}
