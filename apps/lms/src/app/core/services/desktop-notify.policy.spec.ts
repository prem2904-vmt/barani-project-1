import {
  DEFAULT_DESKTOP_SETTINGS, appInFront, chatBadgeCount, decideBusinessAlert, decideChatAlert,
  mergeSettings, windowShown, type DesktopNotifySettings,
} from './desktop-notify.policy';

/**
 * Desktop notification rules (Electron). The page can't see whether anyone is
 * looking (background throttling off → always 'visible'), so these decide
 * from the main window's real state + the user's switches.
 */
const S = (patch: Partial<DesktopNotifySettings> = {}): DesktopNotifySettings => ({ ...DEFAULT_DESKTOP_SETTINGS, ...patch });
const front = { focused: true, visible: true, minimized: false };
const behind = { focused: false, visible: true, minimized: false };
const tray = { focused: false, visible: false, minimized: false };
const mini = { focused: false, visible: true, minimized: true };

describe('desktop-notify.policy — window state', () => {
  it('shown = visible and not minimised; in front = shown and focused', () => {
    expect(windowShown(front)).toBe(true);
    expect(windowShown(behind)).toBe(true);
    expect(windowShown(tray)).toBe(false);
    expect(windowShown(mini)).toBe(false);
    expect(windowShown(null)).toBe(false);
    expect(appInFront(front)).toBe(true);
    expect(appInFront(behind)).toBe(false);
    expect(appInFront(tray)).toBe(false);
    expect(appInFront({ focused: true, visible: true, minimized: true })).toBe(false);
  });
});

describe('desktop-notify.policy — chat message', () => {
  const base = { mutedForMe: false, onScreen: false, inFront: false, settings: S(), dnd: false };

  it('reading the thread in the app → soft tick only (no toast, no native)', () => {
    expect(decideChatAlert({ ...base, onScreen: true, inFront: true })).toEqual({ sound: 'soft', show: 'none' });
  });
  it('thread open but the app is behind another app / in the tray → native notification', () => {
    expect(decideChatAlert({ ...base, onScreen: true, inFront: false })).toEqual({ sound: 'ping', show: 'native' });
    expect(decideChatAlert({ ...base })).toEqual({ sound: 'ping', show: 'native' });
  });
  it('in the app on another screen → in-app pop-up + ping, never a native duplicate', () => {
    expect(decideChatAlert({ ...base, inFront: true })).toEqual({ sound: 'ping', show: 'popup' });
  });
  it('muted conversation (no @mention) → nothing at all', () => {
    expect(decideChatAlert({ ...base, mutedForMe: true })).toEqual({ sound: 'none', show: 'none' });
    expect(decideChatAlert({ ...base, mutedForMe: true, inFront: true })).toEqual({ sound: 'none', show: 'none' });
  });
  it('Messages switched off → no native, no sound while away (in-app pop-up still works in front)', () => {
    expect(decideChatAlert({ ...base, settings: S({ messages: false }) })).toEqual({ sound: 'none', show: 'none' });
    expect(decideChatAlert({ ...base, inFront: true, settings: S({ messages: false }) }).show).toBe('popup');
  });
  it('Sound off silences ping and tick but keeps the visuals', () => {
    expect(decideChatAlert({ ...base, settings: S({ sound: false }) })).toEqual({ sound: 'none', show: 'native' });
    expect(decideChatAlert({ ...base, inFront: true, onScreen: true, settings: S({ sound: false }) }).sound).toBe('none');
  });
  it('Do-not-disturb → no native and no ping', () => {
    expect(decideChatAlert({ ...base, dnd: true })).toEqual({ sound: 'none', show: 'none' });
    expect(decideChatAlert({ ...base, dnd: true, inFront: true })).toEqual({ sound: 'none', show: 'popup' });
  });
});

describe('desktop-notify.policy — bell alert', () => {
  const base = { inFront: false, settings: S(), dnd: false, critical: false };
  it('in front → toast; away → native', () => {
    expect(decideBusinessAlert({ ...base, inFront: true })).toBe('toast');
    expect(decideBusinessAlert(base)).toBe('native');
  });
  it('Alerts off → nothing native (the bell badge still moves)', () => {
    expect(decideBusinessAlert({ ...base, settings: S({ alerts: false }) })).toBe('none');
  });
  it('Do-not-disturb mutes ordinary alerts but never a critical one', () => {
    expect(decideBusinessAlert({ ...base, dnd: true })).toBe('none');
    expect(decideBusinessAlert({ ...base, dnd: true, critical: true })).toBe('native');
  });
});

describe('desktop-notify.policy — badge + settings', () => {
  it('counts unread chats, skipping muted conversations and junk', () => {
    expect(chatBadgeCount([
      { unreadCount: 2 }, { unreadCount: 5, isMuted: true }, { unreadCount: 1, isMuted: false },
      { unreadCount: -3 }, { unreadCount: null }, { unreadCount: 1.7 },
    ])).toBe(4);
    expect(chatBadgeCount([])).toBe(0);
  });
  it('merges only known boolean keys', () => {
    const m = mergeSettings(S(), { calls: false, sound: 'no', evil: true, openAtLogin: false });
    expect(m).toEqual({ ...S(), calls: false, openAtLogin: false });
    expect(mergeSettings(S(), null)).toEqual(S());
  });
});
