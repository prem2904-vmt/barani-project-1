import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { isIPadAsMac, isTouchCapable, readTouchEnv } from './touch-capability';
import { NumpadService } from './numpad.service';
import { NumpadDirective, isTypedKey } from './numpad.directive';
import { Component } from '@angular/core';
import { AuthService } from '../../../core/auth/auth.service';

/**
 * Real-device bug (owner, iPad, Capacitor iOS app): tapping a numeric result
 * opened the SYSTEM keyboard — the numpad was gated on `(pointer: coarse)`
 * alone, which an iPad in desktop-UA mode with a trackpad / Magic Keyboard
 * reports as `fine`. The rule now: native shell OR touch points OR any
 * coarse pointer, and a finger's pointerdown switches the field over
 * synchronously, before iOS focuses it.
 */
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const MAC = IPAD_AS_MAC;

describe('isTouchCapable (pure rule)', () => {
  it('iPad in desktop-UA mode (Macintosh + maxTouchPoints 5), fine primary pointer → touch', () => {
    const env = { userAgent: IPAD_AS_MAC, maxTouchPoints: 5, coarse: false, anyCoarse: false, nativePlatform: false };
    expect(isIPadAsMac(env)).toBe(true);
    expect(isTouchCapable(env)).toBe(true);
  });
  it('Capacitor native shell → touch, whatever the media queries say', () => {
    expect(isTouchCapable({ nativePlatform: true, maxTouchPoints: 0, coarse: false, anyCoarse: false })).toBe(true);
  });
  it('any coarse pointer, or the primary one → touch', () => {
    expect(isTouchCapable({ anyCoarse: true })).toBe(true);
    expect(isTouchCapable({ coarse: true })).toBe(true);
  });
  it('a real Mac / mouse-only desktop → not touch (desktop unchanged)', () => {
    const env = { userAgent: MAC, maxTouchPoints: 0, coarse: false, anyCoarse: false, nativePlatform: false };
    expect(isIPadAsMac(env)).toBe(false);
    expect(isTouchCapable(env)).toBe(false);
  });
  it('readTouchEnv reads window.Capacitor, maxTouchPoints, UA and both media queries', () => {
    const view = {
      navigator: { maxTouchPoints: 5, userAgent: IPAD_AS_MAC },
      matchMedia: (q: string) => ({ matches: q === '(any-pointer: coarse)' }),
      Capacitor: { isNativePlatform: () => true },
    } as unknown as Window;
    expect(readTouchEnv(view)).toEqual({ maxTouchPoints: 5, userAgent: IPAD_AS_MAC, anyCoarse: true, coarse: false, nativePlatform: true });
  });
});

describe('isTypedKey — only a typed key hides the pad', () => {
  const k = (key: string) => new KeyboardEvent('keydown', { key });
  it('modifiers / IME placeholders are not typing; digits, Enter, Backspace are', () => {
    for (const key of ['Shift', 'Meta', 'Control', 'Alt', 'CapsLock', 'Unidentified', 'Process', 'Dead']) expect(isTypedKey(k(key))).toBe(false);
    for (const key of ['5', '.', 'Enter', 'Backspace', 'a']) expect(isTypedKey(k(key))).toBe(true);
  });
});

@Component({
  standalone: true,
  imports: [NumpadDirective],
  template: `<input class="n" type="number" inputmode="decimal" pfNumpad pfNumpadLabel="Hb" />`,
})
class Host {}

function stubEnv(opts: { ua?: string; touchPoints?: number; native?: boolean; coarse?: boolean }) {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => opts.ua ?? MAC });
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => opts.touchPoints ?? 0 });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true, writable: true,
    value: (q: string) => ({ matches: !!opts.coarse && /coarse/.test(q), media: q, addEventListener() {}, removeEventListener() {} }),
  });
  if (opts.native) (window as any).Capacitor = { isNativePlatform: () => true };
  else delete (window as any).Capacitor;
}

function render() {
  TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: { user: () => ({ id: 'u1' }) } }] });
  const svc = TestBed.inject(NumpadService);
  const f = TestBed.createComponent(Host);
  document.body.appendChild(f.nativeElement);
  f.detectChanges();
  const appRef = TestBed.inject(ApplicationRef);
  const tick = () => { f.detectChanges(); appRef.tick(); };
  const input = (f.nativeElement as HTMLElement).querySelector('input') as HTMLInputElement;
  const pad = () => document.body.querySelector('.pf-np');
  const touchTap = () => {
    input.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
    return input;
  };
  return { svc, input, tick, pad, touchTap };
}

describe('pfNumpad on an iPad (Capacitor WKWebView)', () => {
  const realUA = navigator.userAgent;
  afterEach(() => {
    stubEnv({ ua: realUA, touchPoints: 0 });
    document.body.querySelectorAll('pf-numpad-panel').forEach(n => n.remove());
  });

  it('iPad-as-Mac UA + maxTouchPoints 5 (primary pointer fine): the field is switched at RENDER, before any focus', () => {
    stubEnv({ ua: IPAD_AS_MAC, touchPoints: 5 });
    const { svc, input } = render();
    expect(svc.touch()).toBe(true);
    expect(input.getAttribute('inputmode')).toBe('none');
    expect(input.type).toBe('text');                  // number → text before first focus
  });

  it('native platform alone (window.Capacitor) → switched at render', () => {
    stubEnv({ native: true, touchPoints: 0 });
    const { svc, input } = render();
    expect(svc.touch()).toBe(true);
    expect(input.getAttribute('inputmode')).toBe('none');
  });

  it('a device the environment check missed: the touch pointerdown switches the field SYNCHRONOUSLY, then focus opens the pad', () => {
    stubEnv({ ua: MAC, touchPoints: 0 });
    const { svc, input, tick, pad, touchTap } = render();
    expect(svc.touch()).toBe(false);
    expect(input.getAttribute('inputmode')).toBe('decimal');
    touchTap();
    // Checked right after pointerdown, with NO change detection in between —
    // this is the moment iOS decides which keyboard to raise.
    expect(input.getAttribute('inputmode')).toBe('none');
    expect(input.type).toBe('text');
    input.focus();
    tick();
    expect(pad()).not.toBeNull();
  });

  it('mouse desktop: pointerdown from a mouse changes nothing', () => {
    stubEnv({ ua: MAC, touchPoints: 0 });
    const { input, tick, pad } = render();
    input.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', bubbles: true }));
    input.focus();
    tick();
    expect(input.getAttribute('inputmode')).toBe('decimal');
    expect(input.type).toBe('number');
    expect(pad()).toBeNull();
  });

  it('an attached-but-idle keyboard never disables it: a lone modifier keeps the pad, a typed key hides it, a tap brings it back', () => {
    stubEnv({ ua: IPAD_AS_MAC, touchPoints: 5 });
    const { input, tick, pad, touchTap } = render();
    touchTap(); input.focus(); tick();
    expect(pad()).not.toBeNull();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', bubbles: true }));
    tick();
    expect(pad()).not.toBeNull();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '7', bubbles: true }));
    tick();
    expect(pad()).toBeNull();
    expect(input.getAttribute('inputmode')).toBe('none');   // not permanently disabled
    touchTap(); tick();
    expect(pad()).not.toBeNull();
  });
});
