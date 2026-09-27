import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { clearReplyCredentials, parseChatOpenLink, syncReplyCredentials } from './chat-native-reply';

/**
 * Reply-from-notification, web half: the device-bound reply token is fetched
 * for THIS device's push token and handed ONLY to the native secure store;
 * a failure never stores anything; logout / account switch clears it; native
 * "open this conversation" links are parsed strictly.
 */
describe('chat-native-reply — reply token sync', () => {
  const plugin = () => ({ setCredentials: vi.fn(async () => undefined), clear: vi.fn(async () => undefined) });

  it('issues the token for this device and stores it natively (never returns / keeps it)', async () => {
    const p = plugin();
    const api = { post: vi.fn(() => of({ token: 'sealed-reply-token', expiresAt: '2026-10-28T00:00:00Z' })) };
    const ok = await syncReplyCredentials({
      api, apiUrl: 'https://med-fetch-dev.prefrontal.health', appToken: 'apns-abc', deviceId: 'd123', userId: 'u1', plugin: p,
    });
    expect(ok).toBe(true);
    expect(api.post).toHaveBeenCalledWith('/api/devices/reply-token', { appToken: 'apns-abc', deviceId: 'd123' });
    expect(p.setCredentials).toHaveBeenCalledWith({
      apiUrl: 'https://med-fetch-dev.prefrontal.health', token: 'sealed-reply-token',
      expiresAt: Date.parse('2026-10-28T00:00:00Z'), userId: 'u1',
    });
    // The caller only learns "stored" — the token itself is not handed back.
    expect(typeof ok).toBe('boolean');
  });

  it('stores nothing when the server refuses or answers garbage', async () => {
    const p = plugin();
    expect(await syncReplyCredentials({
      api: { post: vi.fn(() => throwError(() => new Error('404'))) }, apiUrl: 'x', appToken: 't', deviceId: null, userId: null, plugin: p,
    })).toBe(false);
    expect(await syncReplyCredentials({
      api: { post: vi.fn(() => of({ token: '', expiresAt: 'nope' })) }, apiUrl: 'x', appToken: 't', deviceId: null, userId: null, plugin: p,
    })).toBe(false);
    expect(p.setCredentials).not.toHaveBeenCalled();
  });

  it('a native store failure is reported, not thrown', async () => {
    const p = { setCredentials: vi.fn(async () => { throw new Error('keychain'); }), clear: vi.fn() };
    expect(await syncReplyCredentials({
      api: { post: vi.fn(() => of({ token: 'tok', expiresAt: '2026-10-28T00:00:00Z' })) }, apiUrl: 'x', appToken: 't', deviceId: null, userId: null, plugin: p,
    })).toBe(false);
  });

  it('clear wipes the native copy and never throws (old native shell without the plugin)', async () => {
    const p = plugin();
    await clearReplyCredentials(p);
    expect(p.clear).toHaveBeenCalledTimes(1);
    await expect(clearReplyCredentials({ clear: async () => { throw new Error('not implemented'); } })).resolves.toBeUndefined();
  });
});

describe('chat-native-reply — open links', () => {
  const id = '3f2b8a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
  it('parses prefrontal-chat://open?c=<uuid>', () => {
    expect(parseChatOpenLink(`prefrontal-chat://open?c=${id}`)).toBe(id);
    expect(parseChatOpenLink(`prefrontal-chat://open/?x=1&c=${id}`)).toBe(id);
  });
  it('rejects anything else', () => {
    expect(parseChatOpenLink(null)).toBeNull();
    expect(parseChatOpenLink('prefrontal-chat://open?c=not-a-uuid')).toBeNull();
    expect(parseChatOpenLink(`prefrontal-call://answer?callId=${id}`)).toBeNull();
    expect(parseChatOpenLink(`https://evil.example/open?c=${id}`)).toBeNull();
  });
});
