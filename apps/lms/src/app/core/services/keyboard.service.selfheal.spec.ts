import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { KeyboardService } from './keyboard.service';
import { PlatformService } from './platform.service';

/**
 * iPad (owner, 2026-09-28): the docked navbar was missing on an idle
 * Settings hub — KeyboardService still said "keyboard up". Every latch it
 * fuses can be left set with nothing to clear it; these pin the self-heal
 * paths that re-derive the state from the live DOM so the bar comes back.
 */
const events = new Subject<unknown>();

function setup(): KeyboardService {
  TestBed.configureTestingModule({
    providers: [
      { provide: PlatformService, useValue: { isCapacitor: () => true, isNative: () => true } },
      { provide: Router, useValue: { events } },
    ],
  });
  return TestBed.inject(KeyboardService);
}

function input(): HTMLInputElement {
  const el = document.createElement('input');
  el.type = 'text';
  document.body.appendChild(el);
  return el;
}

/** Remove a focused element the way WebKit does: NO blur / focusout. */
function detachSilently(el: HTMLElement): void {
  const proto = EventTarget.prototype;
  const original = proto.dispatchEvent;
  proto.dispatchEvent = function (this: EventTarget, e: Event) {
    return e.type === 'focusout' || e.type === 'blur' ? true : original.call(this, e);
  };
  try { el.remove(); } finally { proto.dispatchEvent = original; }
}

describe('KeyboardService — self-healing "keyboard up" state', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.querySelectorAll('input, textarea').forEach(n => n.remove());
    TestBed.resetTestingModule();
  });

  it('a route change clears a latch left by a focused field removed from the DOM', () => {
    const kbd = setup();
    const el = input();
    el.focus();
    expect(kbd.visible()).toBe(true);
    detachSilently(el);
    expect(kbd.visible()).toBe(true);           // the stuck state the owner saw
    events.next(new NavigationEnd(1, '/admin', '/admin'));
    vi.advanceTimersByTime(1);
    expect(kbd.visible()).toBe(false);          // navbar back
  });

  it('coming back to the tab / app (visibilitychange) clears a stale latch', () => {
    const kbd = setup();
    const el = input();
    el.focus();
    detachSilently(el);
    expect(kbd.visible()).toBe(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(kbd.visible()).toBe(false);
  });

  it('blur without focusout: the watchdog notices no editable is focused', () => {
    const kbd = setup();
    const el = input();
    el.focus();
    detachSilently(el);
    expect(kbd.visible()).toBe(true);
    vi.advanceTimersByTime(KeyboardService.WATCHDOG_MS + 10);
    expect(kbd.visible()).toBe(false);
  });

  it('a lost keyboardWillHide (capUp) is dropped once nothing editable holds focus', () => {
    const kbd = setup();
    (kbd as unknown as { capUp: boolean }).capUp = true;
    kbd.resync();
    expect(kbd.visible()).toBe(false);
  });

  it('a genuinely focused field stays "up" through a resync (no false negatives)', () => {
    const kbd = setup();
    const el = input();
    el.focus();
    kbd.resync();
    events.next(new NavigationEnd(2, '/x', '/x'));
    vi.advanceTimersByTime(KeyboardService.WATCHDOG_MS * 3);
    expect(kbd.visible()).toBe(true);
  });

  it('PF Keys state is left to its owner: resync does not drop setInAppKeyboard(true)', () => {
    const kbd = setup();
    kbd.setInAppKeyboard(true);
    kbd.resync();
    expect(kbd.visible()).toBe(true);
    kbd.setInAppKeyboard(false);
    expect(kbd.visible()).toBe(false);
  });

  it('a normal blur still brings the bar back (debounced)', () => {
    const kbd = setup();
    const el = input();
    el.focus();
    el.blur();
    vi.advanceTimersByTime(200);
    expect(kbd.visible()).toBe(false);
  });
});
