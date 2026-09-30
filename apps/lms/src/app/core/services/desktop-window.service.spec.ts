import { TestBed } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopWindowService, ELECTRON_WINDOW_SOURCE, type ElectronWindowBridge } from './desktop-window.service';
import { DesktopClockComponent } from '../../layout/top-strip/desktop-clock.component';

/** Desktop kiosk full screen — renderer side: the clock shows ONLY on the
 *  Electron app while full screen; web / iPad never. */
function fakeBridge(initial: boolean) {
  let cb: ((on: boolean) => void) | null = null;
  const bridge: ElectronWindowBridge = {
    isFullScreen: vi.fn(async () => initial),
    setFullScreen: vi.fn(async (on: boolean) => { cb?.(on); return on; }),
    onFullScreenChange: vi.fn((fn: (on: boolean) => void) => { cb = fn; return () => { cb = null; }; }),
  };
  return { bridge, emit: (on: boolean) => cb?.(on) };
}

function withSource(bridge: ElectronWindowBridge | undefined): DesktopWindowService {
  TestBed.configureTestingModule({ providers: [{ provide: ELECTRON_WINDOW_SOURCE, useValue: () => bridge }] });
  return TestBed.inject(DesktopWindowService);
}

const flush = () => new Promise(r => setTimeout(r, 0));

describe('DesktopWindowService — visibility of the full-screen clock', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('web / iPad (no bridge): never available, never full screen, never a clock; setFullScreen is a no-op', async () => {
    const s = withSource(undefined);
    expect(s.available).toBe(false);
    expect(s.isFullScreen()).toBe(false);
    expect(s.showClock()).toBe(false);
    await s.setFullScreen(true);
    expect(s.showClock()).toBe(false);
  });

  it('default source: the test DOM has no window.electronAPI → off', () => {
    TestBed.configureTestingModule({});
    expect(TestBed.inject(DesktopWindowService).available).toBe(false);
  });

  it('Electron, launched full screen → clock on; leaving full screen (any path) → clock off', async () => {
    const { bridge, emit } = fakeBridge(true);
    const s = withSource(bridge);
    await flush();
    expect(s.available).toBe(true);
    expect(s.isFullScreen()).toBe(true);
    expect(s.showClock()).toBe(true);
    emit(false); // Esc / green button / F11 — main pushes the change
    expect(s.showClock()).toBe(false);
    await s.setFullScreen(true); // avatar-menu "Full screen"
    expect(bridge.setFullScreen).toHaveBeenCalledWith(true);
    expect(s.showClock()).toBe(true);
  });

  it('Electron, windowed → no clock', async () => {
    const s = withSource(fakeBridge(false).bridge);
    await flush();
    expect(s.showClock()).toBe(false);
  });

  it('Esc with nothing open leaves full screen through the bridge; Esc closing a dialog does not', async () => {
    const { bridge } = fakeBridge(true);
    const s = withSource(bridge);
    await flush();
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    document.body.appendChild(dlg);
    const closeOnEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') dlg.remove(); };
    document.addEventListener('keydown', closeOnEsc);
    try {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 5));
      expect(bridge.setFullScreen).not.toHaveBeenCalled();
      expect(s.isFullScreen()).toBe(true);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 5));
      expect(bridge.setFullScreen).toHaveBeenCalledWith(false);
      expect(s.showClock()).toBe(false);
    } finally {
      document.removeEventListener('keydown', closeOnEsc);
      dlg.remove();
    }
  });

  it('a refusing / throwing bridge never crashes the app', async () => {
    const s = withSource({
      isFullScreen: async () => { throw new Error('forbidden'); },
      setFullScreen: async () => { throw new Error('forbidden'); },
      onFullScreenChange: () => { throw new Error('old preload'); },
    });
    await flush();
    await expect(s.setFullScreen(true)).resolves.toBeUndefined();
    expect(s.showClock()).toBe(false);
  });
});

describe('Top-strip clock — markup', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders <time datetime> with aria-live off and the full label; date + time parts', () => {
    const f = TestBed.createComponent(DesktopClockComponent);
    f.detectChanges();
    const t = (f.nativeElement as HTMLElement).querySelector('time')!;
    expect(t.getAttribute('aria-live')).toBe('off');
    expect(t.getAttribute('datetime')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}\+05:30$/);
    expect(t.getAttribute('aria-label')).toMatch(/IST$/);
    // Windows-taskbar order: time line first, dd/mm/yyyy date line under it.
    const lines = Array.from(t.children).map(c => c.className);
    expect(lines).toEqual(['pf-dclock__time', 'pf-dclock__date']);
    expect(t.querySelector('.pf-dclock__time')!.textContent).toMatch(/^\d{1,2}:\d{2}( [AP]M)?$/);
    expect(t.querySelector('.pf-dclock__date')!.textContent).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    f.destroy();
  });

  it('the top strip mounts it only behind desktopWindow.showClock(); the menu item only when windowed on desktop', () => {
    const html = readFileSync(resolve(process.cwd(), 'apps/lms/src/app/layout/top-strip/top-strip.component.html'), 'utf8');
    expect(html).toMatch(/@if \(desktopWindow\.showClock\(\)\) \{\s*(<!--[\s\S]*?-->\s*)?<pf-desktop-clock \/>/);
    expect(html.match(/<pf-desktop-clock/g)).toHaveLength(1);
    // The LAST thing in the right cluster (right end of the bar).
    expect(html).toMatch(/<pf-desktop-clock \/>\s*\}\s*<\/div><!-- \/right cluster -->/);
    expect(html).toMatch(/@if \(desktopWindow\.available && !desktopWindow\.isFullScreen\(\)\)[\s\S]{0,400}enterFullScreen\(\)/);
  });
});
