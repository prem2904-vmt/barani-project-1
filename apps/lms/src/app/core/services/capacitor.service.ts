import { Injectable, inject, signal } from '@angular/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Keyboard } from '@capacitor/keyboard';
import { Network } from '@capacitor/network';
import { LocalNotifications } from '@capacitor/local-notifications';
import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { PlatformService } from './platform.service';

/**
 * Capacitor-side services.
 *
 *   - Network status drives the offline banner in the top strip.
 *   - Keyboard listeners pad the body so inputs aren't covered.
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
      this._initialised.set(true);
      return;
    }

    try {
      const status = await Network.getStatus();
      this.isOnline.set(status.connected);
      Network.addListener('networkStatusChange', s => this.isOnline.set(s.connected));
    } catch { /* Network plugin missing on this build — non-fatal */ }

    try {
      Keyboard.addListener('keyboardWillShow', info => {
        document.body.style.paddingBottom = `${info.keyboardHeight}px`;
      });
      Keyboard.addListener('keyboardWillHide', () => {
        document.body.style.paddingBottom = '0';
      });
    } catch { /* Keyboard plugin not present on web */ }

    try {
      // Android hardware back: collapse one history entry, exit at root.
      App.addListener('backButton', ({ canGoBack }) => {
        if (!canGoBack) App.exitApp();
        else window.history.back();
      });
    } catch { /* App plugin not present */ }

    try {
      await StatusBar.setStyle({ style: Style.Dark });
      // setBackgroundColor is Android-only; ignore the iOS no-op.
      await StatusBar.setBackgroundColor({ color: '#1B3A6B' }).catch(() => undefined);
    } catch { /* StatusBar plugin only available on native */ }

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
