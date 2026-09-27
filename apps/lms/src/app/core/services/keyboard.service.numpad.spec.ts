import { TestBed } from '@angular/core/testing';
import { KeyboardService } from './keyboard.service';
import { PlatformService } from './platform.service';

/**
 * iPad (owner, 2026-09-28): focusing a result-numpad field hid the docked
 * bottom bar — KeyboardService counted ANY focused input as "soft keyboard
 * up". A numpad field raises no system keyboard (inputmode="none"), so its
 * focus must not flip `visible`; only the viewport / Capacitor signals may.
 */
function setup() {
  TestBed.configureTestingModule({
    providers: [{ provide: PlatformService, useValue: { isCapacitor: () => true, isNative: () => true } }],
  });
  return TestBed.inject(KeyboardService);
}
function field(attrs: Record<string, string>, tag = 'input'): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  return el;
}
afterEach(() => { document.body.querySelectorAll('input, textarea').forEach(n => n.remove()); });

describe('KeyboardService × the result numpad', () => {
  it('focus on an inputmode="none" field is NOT keyboard-up (bar stays)', () => {
    const kbd = setup();
    field({ type: 'text', inputmode: 'none' }).focus();
    expect(kbd.visible()).toBe(false);
  });

  it('focus on a numpad-managed field (data-pf-numpad) is NOT keyboard-up either', () => {
    const kbd = setup();
    field({ type: 'text', 'data-pf-numpad': '' }).focus();
    expect(kbd.visible()).toBe(false);
  });

  it('a normal text field / textarea still counts (system keyboard)', () => {
    const kbd = setup();
    field({ type: 'text' }).focus();
    expect(kbd.visible()).toBe(true);
    const k2 = kbd;
    (document.activeElement as HTMLElement).blur();
    field({}, 'textarea').focus();
    expect(k2.visible()).toBe(true);
  });
});
