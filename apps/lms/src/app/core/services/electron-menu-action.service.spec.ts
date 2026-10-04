import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import {
  ELECTRON_MENU_ACTION_SOURCE,
  ElectronMenuActionService,
  type ElectronMenuBridge,
  type MenuActionPayload,
} from './electron-menu-action.service';

@Component({ template: '' })
class Blank {}

function fakeBridge() {
  let cb: ((p: MenuActionPayload) => void) | null = null;
  const bridge: ElectronMenuBridge = {
    onMenuAction: vi.fn((fn: (p: MenuActionPayload) => void) => { cb = fn; return () => { cb = null; }; }),
  };
  return { bridge, emit: (p: MenuActionPayload) => cb?.(p) };
}

function setup(bridge: ElectronMenuBridge | undefined) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'admin/instruments', component: Blank },
        { path: 'lab/analyzer-results', component: Blank },
        { path: '', component: Blank },
      ]),
      { provide: ELECTRON_MENU_ACTION_SOURCE, useValue: () => bridge },
    ],
  });
  const router = TestBed.inject(Router);
  // Eager-injected service (mirrors how app.ts wires it) — inject() runs the constructor.
  TestBed.inject(ElectronMenuActionService);
  return { router };
}

describe('ElectronMenuActionService — tray "Open Instruments" / "Unmatched results" navigation', () => {
  it('web / no bridge: subscribing is a no-op, nothing throws', () => {
    expect(() => setup(undefined)).not.toThrow();
  });

  it('a navigate payload routes the app to the given path', async () => {
    const { bridge, emit } = fakeBridge();
    const { router } = setup(bridge);
    expect(bridge.onMenuAction).toHaveBeenCalledTimes(1);
    emit({ action: 'navigate', path: '/admin/instruments' });
    await new Promise((r) => setTimeout(r, 0));
    expect(router.url).toBe('/admin/instruments');
  });

  it('a different route (the "Unmatched results" click target) also navigates', async () => {
    const { bridge, emit } = fakeBridge();
    const { router } = setup(bridge);
    emit({ action: 'navigate', path: '/lab/analyzer-results' });
    await new Promise((r) => setTimeout(r, 0));
    expect(router.url).toBe('/lab/analyzer-results');
  });

  it('an unrecognised action, or a navigate payload with no path, is ignored', async () => {
    const { bridge, emit } = fakeBridge();
    const { router } = setup(bridge);
    const before = router.url;
    emit({ action: 'some-future-action' });
    emit({ action: 'navigate' });
    await new Promise((r) => setTimeout(r, 0));
    expect(router.url).toBe(before);
  });
});
