import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { NumpadService, PF_KEYS_OPEN_CLASS, PfKeysField } from './numpad.service';
import { KeyboardService } from '../../../core/services/keyboard.service';
import { PlatformService } from '../../../core/services/platform.service';

/**
 * iPad (owner, 2026-09-28): the docked navbar missing on an idle screen.
 * PF Keys docks like a keyboard (html.pf-keys-open + KeyboardService
 * in-app latch → the bar steps aside). When the search field's page is
 * navigated away, its input leaves the DOM with no blur — the keys must
 * still close and hand the navbar back.
 */
const events = new Subject<unknown>();

function setup() {
  TestBed.configureTestingModule({
    providers: [
      { provide: PlatformService, useValue: { isCapacitor: () => true, isNative: () => true } },
      { provide: Router, useValue: { events } },
    ],
  });
  return { pad: TestBed.inject(NumpadService), kbd: TestBed.inject(KeyboardService) };
}

function keysField(el: HTMLInputElement): PfKeysField {
  return {
    el, scope: null, kind: 'keys',
    keys: () => new Set(), label: () => 'Search', unit: () => null, flag: () => null,
    flushChange: () => {}, markDirty: () => {},
    keysKind: () => 'test', defaultLayout: () => null, enterLabel: () => 'Add', enterAria: () => 'Add',
    enterTone: () => 'primary', arrows: () => false, prefixes: () => [], useSystemKeyboard: () => {},
  };
}

/** Open the keys for a field and dock their chrome (what layoutNow does
 *  once the panel has a height — jsdom has no layout). */
function dock(pad: NumpadService, f: PfKeysField) {
  pad.show(f);
  (pad as unknown as { applyKeysChrome(h: number): void }).applyKeysChrome(260);
}

describe('PF Keys — closes (and gives the navbar back) when its page goes away', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.classList.remove(PF_KEYS_OPEN_CLASS);
    document.body.querySelectorAll('input').forEach(n => n.remove());
    TestBed.resetTestingModule();
  });

  it('route change with the search input removed → keys hidden, html.pf-keys-open gone, bar back', () => {
    const { pad, kbd } = setup();
    const el = document.createElement('input');
    el.setAttribute('inputmode', 'none');
    document.body.appendChild(el);
    el.focus();
    dock(pad, keysField(el));
    expect(pad.open()).toBe(true);
    expect(document.documentElement.classList.contains(PF_KEYS_OPEN_CLASS)).toBe(true);
    expect(kbd.visible()).toBe(true);

    el.remove();                               // the page was torn down
    events.next(new NavigationEnd(1, '/admin', '/admin'));
    vi.advanceTimersByTime(1);

    expect(pad.open()).toBe(false);
    expect(document.documentElement.classList.contains(PF_KEYS_OPEN_CLASS)).toBe(false);
    expect(kbd.visible()).toBe(false);
  });

  it('back from the background with the field no longer focused → keys closed', () => {
    const { pad, kbd } = setup();
    const el = document.createElement('input');
    el.setAttribute('inputmode', 'none');
    document.body.appendChild(el);
    el.focus();
    dock(pad, keysField(el));
    (document.activeElement as HTMLElement).blur();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(pad.open()).toBe(false);
    expect(kbd.visible()).toBe(false);
  });

  it('a still-focused search keeps its keys across a navigation (band search on a persistent bar)', () => {
    const { pad } = setup();
    const el = document.createElement('input');
    el.setAttribute('inputmode', 'none');
    document.body.appendChild(el);
    el.focus();
    dock(pad, keysField(el));
    events.next(new NavigationEnd(2, '/frontdesk', '/frontdesk'));
    vi.advanceTimersByTime(1);
    expect(pad.open()).toBe(true);
    expect(document.documentElement.classList.contains(PF_KEYS_OPEN_CLASS)).toBe(true);
  });
});
