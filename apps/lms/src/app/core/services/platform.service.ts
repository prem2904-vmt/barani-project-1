import { Injectable, computed, signal } from '@angular/core';
import { environment } from '../../../environments/environment';

/**
 * Single source of truth for "what kind of host am I running in".
 *
 * Detects:
 *   electron  — preload.js exposed window.electronAPI.isElectron
 *   capacitor — Capacitor.isNativePlatform() returns true on iOS/Android
 *   mobile    — capacitor OR a phone-shaped user-agent on the web
 *   desktop   — electron OR a browser that isn't mobile
 *
 * Drives the API URL pick (mobile devices can't reach localhost),
 * the offline banner, native-camera barcode scanning, safe-area
 * padding, etc. Inject anywhere instead of repeating the
 * window.electronAPI / Capacitor checks per file.
 */
@Injectable({ providedIn: 'root' })
export class PlatformService {
  readonly isElectron = signal<boolean>(
    typeof window !== 'undefined' && !!(window as unknown as { electronAPI?: { isElectron?: boolean } }).electronAPI?.isElectron
  );

  readonly isCapacitor = signal<boolean>(
    typeof window !== 'undefined' && !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()
  );

  readonly isMobile = signal<boolean>(
    (typeof window !== 'undefined' && !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()) ||
    (typeof navigator !== 'undefined' && /Android|iPhone|iPad/i.test(navigator.userAgent))
  );

  readonly isDesktop = computed<boolean>(() =>
    this.isElectron() || (!this.isCapacitor() && !this.isMobile())
  );

  readonly platform = computed<'electron' | 'capacitor' | 'mobile' | 'web'>(() => {
    if (this.isElectron()) return 'electron';
    if (this.isCapacitor()) return 'capacitor';
    if (this.isMobile()) return 'mobile';
    return 'web';
  });

  /**
   * Resolve the API base URL for this host.
   *
   * Capacitor explicitly cannot use localhost — the device is on a
   * different machine. Electron can talk to localhost when the user
   * is running the API on the same box. Web uses whatever the build
   * was configured with.
   *
   * The environment file picked by Nx's fileReplacements per profile
   * already carries the right value; this is a final guard so even
   * a misconfigured build doesn't let mobile silently 404 against
   * localhost.
   */
  getApiUrl(): string {
    const url = environment.apiUrl;
    if (this.isCapacitor() && url.includes('localhost')) {
      // Misconfigured Capacitor build — point this out loudly so
      // the dev knows to swap environment.capacitor.ts to a LAN IP
      // or the deployed API URL before re-running cap sync.
      console.warn(
        '[PlatformService] Capacitor build is pointing at localhost — ' +
        'mobile devices cannot reach this. Update environment.capacitor.ts.'
      );
    }
    return url;
  }
}
