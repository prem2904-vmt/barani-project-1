import { registerPlugin } from '@capacitor/core';
import { firstValueFrom, type Observable } from 'rxjs';

/**
 * Reply-from-notification — the web half (lazy chunk, Capacitor only).
 *
 * The native layer (iOS ChatReply.swift / Android chat/ChatReplyReceiver)
 * answers a chat notification's "Reply" / "Mark as read" WITHOUT opening this
 * app. It authenticates with a device-bound REPLY TOKEN the server issues for
 * this device's push registration (POST /api/devices/reply-token) — never the
 * session itself. This module:
 *   • fetches that token after the device is registered and hands it to the
 *     native store (Keychain / EncryptedSharedPreferences) — it is never kept
 *     in web storage and never logged;
 *   • wipes it on logout / account switch (the server also revokes it: the
 *     token only works while this device's push row belongs to that user);
 *   • opens the conversation when a native chat notification (Android) or a
 *     "Couldn't send — tap to open" notice is tapped (prefrontal-chat://open?c=).
 */

export interface PfChatReplyPlugin {
  setCredentials(o: { apiUrl: string; token: string; expiresAt: number; userId?: string | null }): Promise<void>;
  clear(): Promise<void>;
  status(): Promise<{ stored: boolean; userId: string | null; expiresAt: number }>;
  dismissConversation(o: { conversationId: string }): Promise<void>;
  /** iOS: the APNs environment of this build's push tokens (newer native shells). */
  apnsEnvironment(): Promise<{ environment: string | null }>;
}

export const PfChatReply = registerPlugin<PfChatReplyPlugin>('PfChatReply');

export interface ReplyTokenApi {
  post(url: string, body: unknown): Observable<unknown>;
}

export interface SyncReplyInput {
  api: ReplyTokenApi;
  apiUrl: string;
  appToken: string;
  deviceId: string | null;
  userId: string | null;
  plugin?: Pick<PfChatReplyPlugin, 'setCredentials' | 'clear'>;
}

/** Issue + store this device's reply token. Returns true when stored. Never
 *  throws; a failure only means Reply falls back to "tap to open". */
export async function syncReplyCredentials(i: SyncReplyInput): Promise<boolean> {
  const plugin = i.plugin ?? PfChatReply;
  try {
    const res = await firstValueFrom(i.api.post(
      '/api/devices/reply-token', { appToken: i.appToken, deviceId: i.deviceId })) as { token?: string; expiresAt?: string } | null;
    const expiresAt = Date.parse(res?.expiresAt ?? '');
    if (!res?.token || !Number.isFinite(expiresAt)) return false;
    await plugin.setCredentials({ apiUrl: i.apiUrl, token: res.token, expiresAt, userId: i.userId });
    return true;
  } catch {
    return false;
  }
}

/** Logout / account switch: the native copy goes first. Never throws. */
export async function clearReplyCredentials(plugin: Pick<PfChatReplyPlugin, 'clear'> = PfChatReply): Promise<void> {
  try { await plugin.clear(); } catch { /* plugin missing on an old native build */ }
}

export type ApnsEnvironment = 'production' | 'development';

/** iOS: which APNs gateway this build's push tokens are valid on ("production"
 *  for TestFlight / App Store, "development" for an Xcode Debug build), for the
 *  device registration. Null when unknown — an older native shell without the
 *  method, or an unreadable profile; the server then learns it from the first
 *  push. Never throws. */
export async function readApnsEnvironment(
  plugin: Pick<PfChatReplyPlugin, 'apnsEnvironment'> = PfChatReply,
): Promise<ApnsEnvironment | null> {
  try {
    const env = (await plugin.apnsEnvironment())?.environment;
    return env === 'production' || env === 'development' ? env : null;
  } catch {
    return null; // "not implemented" on an older native shell
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** prefrontal-chat://open?c=<conversation id> → the id (or null). */
export function parseChatOpenLink(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /^prefrontal-chat:\/\/open\/?\?(?:.*&)?c=([^&#]+)/i.exec(url);
  if (!m) return null;
  const id = decodeURIComponent(m[1]);
  return UUID.test(id) ? id : null;
}

/** Route taps on native chat notifications into the conversation. */
export async function wireChatOpenLinks(open: (conversationId: string) => void): Promise<void> {
  try {
    const { App } = await import('@capacitor/app');
    await App.addListener('appUrlOpen', e => {
      const id = parseChatOpenLink(e.url);
      if (id) open(id);
    });
    const launch = await App.getLaunchUrl();
    const id = parseChatOpenLink(launch?.url);
    if (id) open(id);
  } catch (err) {
    console.warn('[chat-reply] App plugin unavailable', err);
  }
}
