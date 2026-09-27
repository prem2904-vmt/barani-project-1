import { Injectable, inject, signal } from '@angular/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Network } from '@capacitor/network';
import { LocalNotifications } from '@capacitor/local-notifications';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { PlatformService } from './platform.service';

/**
 * Capacitor-side services.
 *
 *   - Network status drives the offline banner in the top strip.
 *   - Keyboard avoidance is delegated to Capacitor's native resize mode.
 *   - Android back-button collapses one route at a time, exits at root.
 *   - Camera wraps native QR/barcode scanning (replaces the @zxing
 *     web flow on devices).
 *   - Haptics + LocalNotifications expose handy signals for critical
 *     events (e.g. critical-result alerts when the app isn't focused).
 *
 * Safe to inject anywhere; init() is a no-op on non-native hosts.
 */
@Injectable({ providedIn: 'root' })
export class CapacitorService {
  private readonly platform = inject(PlatformService);

  readonly isOnline = signal<boolean>(true);
  private readonly _initialised = signal<boolean>(false);
  readonly initialised = this._initialised.asReadonly();

  /**
   * Wire up plugin listeners. Call once at app boot (app.ts ngOnInit).
   * Ignored on web/electron since the Capacitor plugins resolve to
   * stubs there but firing listeners is wasteful.
   */
  async init(): Promise<void> {
    if (this._initialised()) return;
    if (!this.platform.isCapacitor()) {
      // Web / Electron: no Network plugin, but the browser knows. Seed from
      // navigator.onLine and track the window online/offline events so the
      // shell's offline banner works on every host, not just native.
      try {
        this.isOnline.set(navigator.onLine);
        window.addEventListener('online', () => this.isOnline.set(true));
        window.addEventListener('offline', () => this.isOnline.set(false));
      } catch { /* SSR guard */ }
      this._initialised.set(true);
      return;
    }

    // Tag the root element so CSS can reserve a guaranteed status-bar
    // gap. WKWebView occasionally reports env(safe-area-inset-top) as 0
    // on the very first paint (before the splash hides), which let the
    // page header slide under the notch until an app restart. The
    // `.cap-native` class lets styles.scss apply a 50px floor via
    // max(env(safe-area-inset-top), 50px) — once iOS reports the real
    // inset it takes over, with no flash of overlap.
    document.documentElement.classList.add('cap-native');
    // Platform-specific class (cap-ios / cap-android) so CSS can fork
    // per-OS — e.g. lifting the floating nav pill above Android's
    // system navigation bar without touching the iOS layout.
    document.documentElement.classList.add('cap-' + Capacitor.getPlatform());

    try {
      const status = await Network.getStatus();
      this.isOnline.set(status.connected);
      Network.addListener('networkStatusChange', s => this.isOnline.set(s.connected));
    } catch { /* Network plugin missing on this build — non-fatal */ }

    // Keyboard avoidance is handled by Capacitor's `resize: 'native'` (see
    // capacitor.config.ts) — the WebView itself shrinks to the area above the
    // keyboard, so dvh layouts reflow and bottom-anchored composers rise above
    // it. We intentionally do NOT pad <body> here: that double-counts against
    // the native resize (gap/over-scroll) and didn't work against our dvh shell.

    try {
      // Android hardware back: collapse one history entry, exit at root.
      App.addListener('backButton', ({ canGoBack }) => {
        if (!canGoBack) App.exitApp();
        else window.history.back();
      });
    } catch { /* App plugin not present */ }

    // Status bar (style, colour, Android overlay) and the Android navigation
    // bar are NOT set here: they follow the ACTIVE theme from ThemeService
    // (system-bars.ts) — a fixed Style.Dark at boot left white clock text over
    // the light theme's top band. Only the platform class stays here.
    if (Capacitor.getPlatform() === 'android') {
      document.documentElement.classList.add('cap-android');
    }

    try {
      await LocalNotifications.requestPermissions();
    } catch { /* user can grant later — we don't block */ }

    this._initialised.set(true);
  }

  /**
   * Open the native camera for a QR/barcode scan. Returns the data
   * URL of the captured frame (caller decodes if needed) or null
   * when the user cancels.
   *
   * For pure barcode scanning a dedicated Capacitor plugin
   * (e.g. @capacitor-mlkit/barcode-scanning) gives a faster
   * decoded value; this version is the minimum-viable path that
   * doesn't add another native dependency.
   */
  async captureImage(): Promise<string | null> {
    if (!this.platform.isCapacitor()) return null;
    try {
      const image = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera
      });
      return image.dataUrl ?? null;
    } catch {
      return null;
    }
  }

  /** Light tap — for confirming a press. */
  async impact(style: ImpactStyle = ImpactStyle.Medium): Promise<void> {
    if (!this.platform.isCapacitor()) return;
    try { await Haptics.impact({ style }); } catch { /* no-op */ }
  }

  /** Generic vibrate — for warning / error. */
  async vibrate(): Promise<void> {
    if (!this.platform.isCapacitor()) return;
    try { await Haptics.vibrate(); } catch { /* no-op */ }
  }

  /**
   * Local push for a critical result. Fires immediately. The
   * caller should still surface the alert in-app — this is a
   * fallback for when the app is backgrounded.
   */
  async notifyCriticalValue(
    patientName: string,
    testName: string,
    value: string
  ): Promise<void> {
    if (!this.platform.isCapacitor()) return;
    try {
      await LocalNotifications.schedule({
        notifications: [{
          id: Date.now() % 2_000_000_000,
          title: '🔴 Critical Value Alert',
          body: `${patientName} — ${testName}: ${value}`,
          schedule: { at: new Date(Date.now() + 100) },
          sound: 'default',
          smallIcon: 'ic_stat_icon_config_sample'
        }]
      });
    } catch { /* permissions not granted, etc. — non-fatal */ }
  }
}
