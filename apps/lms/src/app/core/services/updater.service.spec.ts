import { TestBed } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdaterService, updaterMenuLabel, type UpdaterState } from './updater.service';

/** Avatar-menu "Check for updates": desktop only, label follows the updater. */
const st = (over: Partial<UpdaterState>): UpdaterState => ({ phase: 'idle', version: null, progress: null, error: null, ...over });
const flush = () => new Promise(r => setTimeout(r, 0));

function withBridge(bridge: unknown): UpdaterService {
  (window as unknown as { electronAPI?: unknown }).electronAPI = bridge ? { isElectron: true, updater: bridge } : undefined;
  return TestBed.inject(UpdaterService);
}

describe('UpdaterService — avatar menu item', () => {
  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    TestBed.resetTestingModule();
  });

  it('web (no bridge): not available, checkNow is a no-op', async () => {
    const s = withBridge(undefined);
    expect(s.available).toBe(false);
    await s.checkNow();
    expect(s.menuLabel()).toBe('Check for updates');
  });

  it('desktop: available, checkNow calls the bridge and applies the returned state', async () => {
    const check = vi.fn(async () => st({ phase: 'checking' }));
    const s = withBridge({ getState: async () => st({}), restartNow: vi.fn(), onState: () => () => undefined, check });
    await flush();
    expect(s.available).toBe(true);
    expect(s.menuBusy()).toBe(false);
    await s.checkNow();
    expect(check).toHaveBeenCalledTimes(1);
    expect(s.menuLabel()).toBe('Checking for updates…');
    expect(s.menuBusy()).toBe(true);
  });

  it('label follows the phase, matching the tray wording', () => {
    expect(updaterMenuLabel(st({}))).toBe('Check for updates');
    expect(updaterMenuLabel(st({ phase: 'downloading', progress: 40 }))).toBe('Downloading update… 40%');
    expect(updaterMenuLabel(st({ phase: 'ready', version: '1.4.0' }))).toBe('Restart to install v1.4.0');
    expect(updaterMenuLabel(st({ phase: 'deferred' }))).toContain('waiting for instruments');
  });

  it('the avatar menu item is gated on updater.available and uses an SVG icon (no emoji / native control)', () => {
    const html = readFileSync(resolve(__dirname, '../../layout/top-strip/top-strip.component.html'), 'utf8');
    const i = html.indexOf('data-test="check-updates"');
    expect(i).toBeGreaterThan(0);
    expect(html.slice(html.lastIndexOf('@if', i), i)).toContain('updater.available');
    expect(html.slice(i, i + 700)).toContain('<svg');
  });
});
