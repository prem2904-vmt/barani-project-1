import { Injectable, signal } from '@angular/core';
import {
  DEFAULT_DESKTOP_SETTINGS, appInFront, mergeSettings, windowShown,
  type DesktopNotifySettings, type DesktopWindowState,
} from './desktop-notify.policy';

/** window.electronAPI.notify — electron/preload.js (absent on web / mobile). */
export interface ElectronNotifyBridge {
  getSettings(): Promise<{ settings: Partial<DesktopNotifySettings>; platform: string; loginSupported: boolean } | null>;
  setSettings(patch: Partial<DesktopNotifySettings>): Promise<{ settings: Partial<DesktopNotifySettings>; platform: string; loginSupported: boolean } | null>;
  alert(info: {
    kind: string; title: string; body?: string | null;
    referenceType?: string | null; referenceId?: string | null; critical?: boolean;
  }): void;
  badge(counts: { chat: number; bell: number }): void;
  getWindowState(): Promise<DesktopWindowState | null>;
  onWindowState(cb: (s: DesktopWindowState) => void): () => void;
  onResume(cb: () => void): () => void;
  onAction(cb: (a: { type: 'alert'; kind?: string; referenceType?: string | null; referenceId?: string | null }) => void): () => void;
}

export function electronNotifyBridge(): ElectronNotifyBridge | null {
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as { electronAPI?: { isElectron?: boolean; notify?: ElectronNotifyBridge } }).electronAPI;
  return api?.isElectron && api.notify ? api.notify : null;
}

/** Main-process window state (desktop only; null elsewhere / until known).
 *  Module-level signal so a static "is the page on screen" check can read —
 *  and effects can track — it without injecting anything. */
const desktopWindow = signal<DesktopWindowState | null>(null);

/**
 * Is the app's page on screen? Desktop: the main window is shown (not in the
 * tray, not minimised) — document.visibilityState can't say, it is always
 * 'visible' there. Web / mobile: the document visibility, as before.
 */
export function pageShown(): boolean {
  const s = desktopWindow();
  if (s) return windowShown(s);
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

/** Desktop only: the user is working in the app window right now. */
export function desktopInFront(): boolean | null {
  const s = desktopWindow();
  return s ? appInFront(s) : null;
}

/**
 * Desktop (Electron) notification plumbing on the renderer side: the window
 * state from main, the per-user settings (avatar menu), bell alerts as native
 * notifications, the dock / taskbar badge and wake-up after sleep.
 *
 * Wake-up reuses the app's existing "came back to the foreground" path: a
 * synthetic `visibilitychange` (the page reads 'visible') makes the chat,
 * signaling and work sockets revive / re-sync and the session refresh — the
 * same thing a browser tab does when it returns.
 */
@Injectable({ providedIn: 'root' })
export class DesktopNotifyService {
  private readonly api = electronNotifyBridge();
  /** True in the desktop app (the bridge exists). */
  readonly active = !!this.api;
  readonly settings = signal<DesktopNotifySettings>({ ...DEFAULT_DESKTOP_SETTINGS });
  readonly loginSupported = signal(false);
  readonly windowState = desktopWindow.asReadonly();
  private counts = { chat: 0, bell: 0 };
  private badgeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const api = this.api;
    if (!api) return;
    api.onWindowState(s => this.setWindowState(s));
    void api.getWindowState().then(s => { if (s) this.setWindowState(s); }).catch(() => undefined);
    api.onResume(() => this.wake());
    api.onAction(a => this.onAction(a));
    void this.refreshSettings();
  }

  async refreshSettings(): Promise<void> {
    if (!this.api) return;
    try { this.applyResult(await this.api.getSettings()); } catch { /* keep defaults */ }
  }

  async set<K extends keyof DesktopNotifySettings>(key: K, value: DesktopNotifySettings[K]): Promise<void> {
    if (!this.api) return;
    const prev = this.settings();
    this.settings.set({ ...prev, [key]: value });          // optimistic
    try { this.applyResult(await this.api.setSettings({ [key]: value })); }
    catch { this.settings.set(prev); }
  }

  /** Bell event → native notification (caller already decided it should show). */
  alert(p: { kind: string; title: string; body?: string | null; referenceType?: string | null; referenceId?: string | null; critical?: boolean }): void {
    this.api?.alert({
      kind: p.kind, title: p.title, body: p.body ?? '',
      referenceType: p.referenceType ?? null, referenceId: p.referenceId ?? null, critical: !!p.critical,
    });
  }

  setChatUnread(n: number): void { this.setCount('chat', n); }
  setBellUnread(n: number): void { this.setCount('bell', n); }

  private setCount(k: 'chat' | 'bell', n: number): void {
    if (!this.api) return;
    const v = Math.max(0, Math.floor(n || 0));
    if (this.counts[k] === v) return;
    this.counts = { ...this.counts, [k]: v };
    if (this.badgeTimer) return;
    this.badgeTimer = setTimeout(() => {
      this.badgeTimer = null;
      this.api?.badge({ ...this.counts });
    }, 250);
  }

  private applyResult(r: { settings: Partial<DesktopNotifySettings>; loginSupported: boolean } | null): void {
    if (!r) return;
    this.settings.set(mergeSettings(DEFAULT_DESKTOP_SETTINGS, r.settings));
    this.loginSupported.set(!!r.loginSupported);
  }

  private setWindowState(s: DesktopWindowState): void {
    const clean: DesktopWindowState = { focused: !!s?.focused, visible: !!s?.visible, minimized: !!s?.minimized };
    const wasShown = pageShown();
    desktopWindow.set(clean);
    // Back on screen from the tray / minimised → the foreground path runs
    // (catch up reads, re-sync lists) exactly as when a browser tab returns.
    if (!wasShown && windowShown(clean)) this.fireForeground();
  }

  /** Sleep → wake / screen unlock (main debounces): revive the sockets and
   *  refresh the bell. */
  private wake(): void {
    this.fireForeground();
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('pf-notification-received'));
  }

  private fireForeground(): void {
    if (typeof document !== 'undefined') document.dispatchEvent(new Event('visibilitychange'));
  }

  /** Click on a native bell notification → the bell opens that row's screen. */
  private onAction(a: { type: 'alert'; kind?: string; referenceType?: string | null; referenceId?: string | null }): void {
    if (!a || a.type !== 'alert' || typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('pf-open-notification', {
      detail: { type: a.kind ?? '', referenceType: a.referenceType ?? null, referenceId: a.referenceId ?? null },
    }));
  }
}

/** The avatar-menu switches (desktop app only). Stroked SVG paths, 24px box. */
export const DESKTOP_NOTIFY_ITEMS: readonly {
  key: keyof DesktopNotifySettings;
  label: string;
  paths: readonly string[];
  /** Only when the installed app can register a login item. */
  loginOnly?: boolean;
}[] = [
  { key: 'calls', label: 'Call pop-ups', paths: [
    'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z',
  ] },
  { key: 'messages', label: 'Message notifications', paths: [
    'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  ] },
  { key: 'alerts', label: 'Alert notifications', paths: [
    'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0',
  ] },
  { key: 'sound', label: 'Notification sounds', paths: [
    'M11 5 6 9H2v6h4l5 4V5Z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M19 5a10 10 0 0 1 0 14',
  ] },
  { key: 'openAtLogin', label: 'Open at login', loginOnly: true, paths: [
    'M12 2v10', 'M18.4 6.6a9 9 0 1 1-12.8 0',
  ] },
];

/** Tests only: forget the main-process window state (module-level). */
export function resetDesktopWindowForTests(): void { desktopWindow.set(null); }
