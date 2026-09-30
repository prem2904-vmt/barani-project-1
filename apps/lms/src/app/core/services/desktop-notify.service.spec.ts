import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import {
  DesktopNotifyService, desktopInFront, pageShown, resetDesktopWindowForTests, type ElectronNotifyBridge,
} from './desktop-notify.service';
import type { DesktopWindowState } from './desktop-notify.policy';

/**
 * Renderer half of the desktop notification plumbing, against a fake
 * electronAPI.notify bridge: window state from main drives "is the page on
 * screen"; coming back / waking fires the app's foreground path; badge counts
 * are coalesced; settings round-trip; bell clicks reach the bell.
 */
function fakeBridge() {
  let onState: ((s: DesktopWindowState) => void) | null = null;
  let onResume: (() => void) | null = null;
  let onAction: ((a: { type: 'alert'; kind?: string; referenceType?: string | null; referenceId?: string | null }) => void) | null = null;
  const stored = { calls: true, messages: true, alerts: true, sound: true, openAtLogin: true };
  const b: ElectronNotifyBridge = {
    getSettings: vi.fn(async () => ({ settings: { ...stored }, platform: 'darwin', loginSupported: true })),
    setSettings: vi.fn(async (patch) => { Object.assign(stored, patch); return { settings: { ...stored }, platform: 'darwin', loginSupported: true }; }),
    alert: vi.fn(),
    badge: vi.fn(),
    getWindowState: vi.fn(async () => null),
    onWindowState: vi.fn((cb) => { onState = cb; return () => undefined; }),
    onResume: vi.fn((cb) => { onResume = cb; return () => undefined; }),
    onAction: vi.fn((cb) => { onAction = cb; return () => undefined; }),
  };
  return {
    b,
    state: (s: DesktopWindowState) => onState!(s),
    resume: () => onResume!(),
    action: (a: Parameters<NonNullable<typeof onAction>>[0]) => onAction!(a),
  };
}

describe('DesktopNotifyService', () => {
  let f: ReturnType<typeof fakeBridge>;
  const w = window as unknown as { electronAPI?: unknown };

  beforeEach(() => {
    resetDesktopWindowForTests();
    f = fakeBridge();
    w.electronAPI = { isElectron: true, notify: f.b };
    TestBed.configureTestingModule({});
  });
  afterEach(() => {
    delete w.electronAPI;
    resetDesktopWindowForTests();
    vi.useRealTimers();
  });

  it('is inactive (and the page falls back to document visibility) without the bridge', () => {
    delete w.electronAPI;
    const s = TestBed.inject(DesktopNotifyService);
    expect(s.active).toBe(false);
    expect(desktopInFront()).toBeNull();
    expect(pageShown()).toBe(true);           // jsdom document is visible
  });

  it('window state from main decides "on screen" — the page itself always says visible', () => {
    TestBed.inject(DesktopNotifyService);
    f.state({ focused: false, visible: false, minimized: false });   // hidden in the tray
    expect(pageShown()).toBe(false);
    expect(desktopInFront()).toBe(false);
    f.state({ focused: false, visible: true, minimized: true });     // minimised
    expect(pageShown()).toBe(false);
    f.state({ focused: false, visible: true, minimized: false });    // behind another app
    expect(pageShown()).toBe(true);
    expect(desktopInFront()).toBe(false);
    f.state({ focused: true, visible: true, minimized: false });
    expect(desktopInFront()).toBe(true);
  });

  it('coming back from the tray fires the foreground path once (visibilitychange)', () => {
    TestBed.inject(DesktopNotifyService);
    const seen = vi.fn();
    document.addEventListener('visibilitychange', seen);
    f.state({ focused: false, visible: false, minimized: false });
    expect(seen).not.toHaveBeenCalled();
    f.state({ focused: true, visible: true, minimized: false });
    expect(seen).toHaveBeenCalledTimes(1);
    f.state({ focused: false, visible: true, minimized: false });   // blur: still on screen
    expect(seen).toHaveBeenCalledTimes(1);
    document.removeEventListener('visibilitychange', seen);
  });

  it('wake from sleep / unlock revives the sockets and refreshes the bell', () => {
    TestBed.inject(DesktopNotifyService);
    const vis = vi.fn();
    const bell = vi.fn();
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('pf-notification-received', bell);
    f.resume();
    expect(vis).toHaveBeenCalledTimes(1);
    expect(bell).toHaveBeenCalledTimes(1);
    document.removeEventListener('visibilitychange', vis);
    window.removeEventListener('pf-notification-received', bell);
  });

  it('badge counts are coalesced into one IPC and unchanged counts send nothing', () => {
    vi.useFakeTimers();
    const s = TestBed.inject(DesktopNotifyService);
    s.setChatUnread(2);
    s.setBellUnread(3);
    s.setChatUnread(4);
    expect(f.b.badge).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(f.b.badge).toHaveBeenCalledTimes(1);
    expect(f.b.badge).toHaveBeenCalledWith({ chat: 4, bell: 3 });
    s.setChatUnread(4);
    vi.advanceTimersByTime(300);
    expect(f.b.badge).toHaveBeenCalledTimes(1);
  });

  it('settings load from main and a switch round-trips (optimistic)', async () => {
    const s = TestBed.inject(DesktopNotifyService);
    await s.refreshSettings();
    expect(s.loginSupported()).toBe(true);
    const p = s.set('messages', false);
    expect(s.settings().messages).toBe(false);
    await p;
    expect(f.b.setSettings).toHaveBeenCalledWith({ messages: false });
    expect(s.settings().messages).toBe(false);
  });

  it('a failed save rolls the switch back', async () => {
    const s = TestBed.inject(DesktopNotifyService);
    await s.refreshSettings();
    (f.b.setSettings as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('ipc'));
    await s.set('sound', false);
    expect(s.settings().sound).toBe(true);
  });

  it('a click on a native bell notification asks the bell to open its target', () => {
    TestBed.inject(DesktopNotifyService);
    const got = vi.fn();
    const h = (e: Event) => got((e as CustomEvent).detail);
    window.addEventListener('pf-open-notification', h);
    f.action({ type: 'alert', kind: 'report_ready', referenceType: 'report', referenceId: 'r1' });
    expect(got).toHaveBeenCalledWith({ type: 'report_ready', referenceType: 'report', referenceId: 'r1' });
    window.removeEventListener('pf-open-notification', h);
  });

  it('alert() forwards only the bell fields', () => {
    const s = TestBed.inject(DesktopNotifyService);
    s.alert({ kind: 'critical_value', title: 'Critical value', body: 'Potassium 6.9', critical: true, referenceType: 'order_test', referenceId: 'x' });
    expect(f.b.alert).toHaveBeenCalledWith({
      kind: 'critical_value', title: 'Critical value', body: 'Potassium 6.9',
      referenceType: 'order_test', referenceId: 'x', critical: true,
    });
  });
});
