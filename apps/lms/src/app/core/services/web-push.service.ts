import { Injectable, effect, inject, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import { AuthService } from '../auth/auth.service';
import { SessionScopeService } from '../auth/session-scope.service';
import { PlatformService } from './platform.service';

/** base64url VAPID key → the Uint8Array PushManager.subscribe wants. */
export function vapidKeyToBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const b64 = (base64url + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function toBase64Url(buf: ArrayBuffer | null): string {
  if (!buf) return '';
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Browser Web Push — the plain-web leg of OFFLINE CALLING. A colleague with
 * the app in a background tab (or the browser open with no Prefrontal tab)
 * gets an "Incoming call" system notification with Answer / Decline from the
 * service worker (public/pf-push-sw.js); a ring-stop push closes it (or turns
 * it into "Missed call").
 *
 * Plain web only — Capacitor rings through APNs/FCM, and Electron keeps its
 * own background socket (Electron has no browser push service). Never asks
 * for notification permission itself (the Messages page does, behind a user
 * gesture); it subscribes as soon as permission is granted and the server has
 * VAPID keys, and re-homes the subscription on an account switch. Logout
 * unsubscribes (PushService.unregister) so a signed-out browser never rings.
 */
@Injectable({ providedIn: 'root' })
export class WebPushService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly platform = inject(PlatformService);
  private readonly scope = inject(SessionScopeService);

  /** The worker ships in public/ → served next to index.html; resolve it
   *  against <base href> so a sub-path deployment works too. */
  private static swUrl(): string { return new URL('pf-push-sw.js', document.baseURI).pathname; }
  private static swScope(): string { return new URL('./', document.baseURI).pathname; }

  /** `${userId}|${endpoint}` last posted — skip identical re-posts. */
  private posted: string | null = null;
  private syncing: Promise<void> | null = null;

  constructor() {
    if (!this.supported()) return;
    effect(() => {
      const signedIn = !!this.auth.user();
      untracked(() => { if (signedIn) void this.sync(); });
    });
    // Account switch: the same browser subscription must now ring the NEW
    // account (the server upsert re-homes it by endpoint).
    this.scope.onChange(c => { this.posted = null; if (c.next) void this.sync(); });
    // Permission may be granted later (Messages page) — pick it up.
    window.addEventListener('focus', () => void this.sync());
    try {
      void navigator.permissions?.query({ name: 'notifications' as PermissionName })
        .then(st => { st.onchange = () => void this.sync(); })
        .catch(() => undefined);
    } catch { /* older browsers */ }
  }

  supported(): boolean {
    return typeof window !== 'undefined'
      && !this.platform.isCapacitor() && !this.platform.isElectron()
      && typeof navigator !== 'undefined' && 'serviceWorker' in navigator
      && 'PushManager' in window && typeof Notification !== 'undefined'
      && window.isSecureContext;
  }

  /** Subscribe this browser (idempotent). Never throws; never prompts. */
  sync(): Promise<void> {
    if (this.syncing) return this.syncing;
    this.syncing = this.doSync().catch(err => console.warn('[web-push] sync failed', err))
      .finally(() => { this.syncing = null; });
    return this.syncing;
  }

  private async doSync(): Promise<void> {
    const user = this.auth.user();
    if (!this.supported() || !user || Notification.permission !== 'granted') return;
    const cfg = await firstValueFrom(this.api.get<{ publicKey: string; enabled: boolean }>('/api/devices/web-push-key'));
    if (!cfg?.enabled || !cfg.publicKey) return;

    const reg = await navigator.serviceWorker.register(WebPushService.swUrl(), { scope: WebPushService.swScope() });
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    const key = vapidKeyToBytes(cfg.publicKey);
    if (sub && !sameKey(sub.options?.applicationServerKey ?? null, key)) {
      // Server rotated its VAPID keys — the old subscription can't be pushed to.
      await sub.unsubscribe().catch(() => undefined);
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });

    const marker = `${user.id}|${sub.endpoint}`;
    if (this.posted === marker) return;
    await firstValueFrom(this.api.post('/api/devices/web-subscribe', {
      endpoint: sub.endpoint,
      p256dh: toBase64Url(sub.getKey('p256dh')),
      auth: toBase64Url(sub.getKey('auth')),
    }));
    this.posted = marker;
  }

  /** Logout: drop the server row AND the browser subscription. */
  async unsubscribe(): Promise<void> {
    this.posted = null;
    if (!this.supported()) return;
    const reg = await navigator.serviceWorker.getRegistration(WebPushService.swScope()).catch(() => undefined);
    const sub = await reg?.pushManager.getSubscription().catch(() => null);
    if (!sub) return;
    try {
      await firstValueFrom(this.api.delete(`/api/devices/web-subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`));
    } catch { /* the server prunes it on the next 404/410 anyway */ }
    await sub.unsubscribe().catch(() => undefined);
  }
}

function sameKey(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  if (x.length !== b.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== b[i]) return false;
  return true;
}
