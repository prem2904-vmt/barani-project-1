/**
 * Desktop (Electron) notification decisions — pure, so every rule is pinned by
 * a unit test. The main process mirrors the window part in electron/notify-core.js.
 *
 * Why the window state comes from the main process: the desktop app keeps
 * background throttling OFF (so the SignalR socket survives in the tray), and
 * with that Chromium reports document.visibilityState 'visible' even while the
 * window is minimised or hidden. The page can't tell on its own whether anyone
 * is looking.
 */

export interface DesktopWindowState {
  focused: boolean;
  visible: boolean;
  minimized: boolean;
}

export interface DesktopNotifySettings {
  calls: boolean;
  messages: boolean;
  alerts: boolean;
  sound: boolean;
  openAtLogin: boolean;
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopNotifySettings = {
  calls: true, messages: true, alerts: true, sound: true, openAtLogin: true,
};

/** The window is on screen (not hidden in the tray, not minimised). */
export function windowShown(s: DesktopWindowState | null | undefined): boolean {
  return !!s && s.visible && !s.minimized;
}

/** The user is working IN the app right now. */
export function appInFront(s: DesktopWindowState | null | undefined): boolean {
  return windowShown(s) && !!s!.focused;
}

export interface ChatAlertInput {
  /** The conversation is muted and the message doesn't @mention me. */
  mutedForMe: boolean;
  /** A reader / docked window shows this conversation on a shown window. */
  onScreen: boolean;
  inFront: boolean;
  settings: DesktopNotifySettings;
  /** My presence is Do-not-disturb / In surgery. */
  dnd: boolean;
}

export interface ChatAlertDecision {
  sound: 'none' | 'soft' | 'ping';
  show: 'none' | 'popup' | 'native';
}

/**
 * One incoming chat message on the desktop app:
 *  - muted (no @mention) → nothing (the unread count still moves);
 *  - thread on screen AND app in front → soft tick only (they are reading it);
 *  - app in front, other thread → in-app pop-up + ping;
 *  - app not in front (tray / minimised / another app) → native notification
 *    + ping, unless Messages is off or I'm on Do-not-disturb (badge only);
 *  - Sound off silences the ping / tick everywhere.
 */
export function decideChatAlert(i: ChatAlertInput): ChatAlertDecision {
  if (i.mutedForMe) return { sound: 'none', show: 'none' };
  const sound = (s: 'soft' | 'ping'): ChatAlertDecision['sound'] => (i.settings.sound ? s : 'none');
  if (i.inFront) {
    if (i.onScreen) return { sound: sound('soft'), show: 'none' };
    return { sound: i.dnd ? 'none' : sound('ping'), show: 'popup' };
  }
  if (!i.settings.messages || i.dnd) return { sound: 'none', show: 'none' };
  return { sound: sound('ping'), show: 'native' };
}

export interface BusinessAlertInput {
  inFront: boolean;
  settings: DesktopNotifySettings;
  dnd: boolean;
  critical: boolean;
}

/**
 * One bell (NotificationCatalog) event on the desktop app:
 *  - app in front → the in-app toast (the bell badge moves too);
 *  - otherwise → native notification, unless Alerts is off, or I'm on
 *    Do-not-disturb and it isn't critical (critical = patient safety: always).
 */
export function decideBusinessAlert(i: BusinessAlertInput): 'toast' | 'native' | 'none' {
  if (i.inFront) return 'toast';
  if (!i.settings.alerts) return 'none';
  if (i.dnd && !i.critical) return 'none';
  return 'native';
}

/** Dock / taskbar badge share of chat: unread in conversations that aren't muted. */
export function chatBadgeCount(convs: readonly { unreadCount?: number | null; isMuted?: boolean | null }[]): number {
  let n = 0;
  for (const c of convs) if (!c.isMuted) n += Math.max(0, Math.floor(c.unreadCount ?? 0));
  return n;
}

/** Only known boolean keys survive (the main process sanitises again). */
export function mergeSettings(base: DesktopNotifySettings, raw: unknown): DesktopNotifySettings {
  const out = { ...base };
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(DEFAULT_DESKTOP_SETTINGS) as (keyof DesktopNotifySettings)[]) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === 'boolean') out[k] = v;
    }
  }
  return out;
}
