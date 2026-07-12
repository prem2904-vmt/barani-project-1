import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './core/services/theme.service';
import { CapacitorService } from './core/services/capacitor.service';
import { PushService } from './core/services/push.service';
import { PlatformService } from './core/services/platform.service';
import { VersionService } from './core/services/version.service';
import { LockService } from './core/auth/lock.service';
import { LockScreenComponent } from './shared/components/lock-screen.component';
import { SwitchScreenComponent } from './shared/components/switch-screen.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, LockScreenComponent, SwitchScreenComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <router-outlet></router-outlet>

    <!-- 15-minute idle lock (shared lab machines) — PIN to resume. -->
    <pf-lock-screen />

    <!-- Full-screen profile switch (Windows-style) — target's PIN gates it. -->
    <pf-switch-screen />

    <!-- Version gate: shown only when the API's minClientVersion outruns this
         bundle (see VersionService). Persistent + blocking by design — an
         out-of-date installed app must not keep writing against a newer API. -->
    @if (version.updateRequired()) {
      <div class="pf-vg-root" role="alertdialog" aria-modal="true" aria-label="Update required">
        <div class="pf-vg-backdrop"></div>
        <div class="pf-vg-card">
          <span class="pf-vg-glow" aria-hidden="true"></span>
          <header class="pf-vg-head">
            <span class="pf-vg-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </span>
            <div class="pf-vg-head-text">
              <h2 class="pf-vg-title">Update required</h2>
              <p class="pf-vg-message">
                This version of the app is no longer supported —
                please install the latest version to continue.
              </p>
            </div>
          </header>
        </div>
      </div>
    }
  `,
  styles: [`
    /* Mirrors the pf-dialog-host card so the gate reads like the app's
       own dialogs — minus the actions row (nothing to confirm/dismiss). */
    .pf-vg-root {
      position: fixed;
      inset: 0;
      z-index: 200; /* above every overlay — nothing may outrank the gate */
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .pf-vg-backdrop {
      position: absolute;
      inset: 0;
      background:
        radial-gradient(1200px 800px at 50% 100%, rgba(124, 58, 237, 0.15), transparent 60%),
        rgba(5, 5, 15, 0.72);
      backdrop-filter: blur(14px) saturate(1.2);
      -webkit-backdrop-filter: blur(14px) saturate(1.2);
    }
    .pf-vg-card {
      position: relative;
      width: 100%;
      max-width: 26rem;
      padding: 24px;
      border-radius: 20px;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      box-shadow:
        0 1px 0 0 rgba(255, 255, 255, 0.04) inset,
        0 30px 70px rgba(0, 0, 0, 0.55),
        0 0 0 1px rgba(168, 85, 247, 0.08);
      overflow: hidden;
    }
    .pf-vg-glow {
      position: absolute;
      top: -80px;
      left: -40px;
      width: 260px;
      height: 200px;
      pointer-events: none;
      background: radial-gradient(closest-side, rgba(168, 85, 247, 0.35), transparent 70%);
      filter: blur(20px);
      opacity: 0.9;
    }
    .pf-vg-head {
      position: relative;
      display: flex;
      align-items: flex-start;
      gap: 14px;
    }
    .pf-vg-icon {
      flex-shrink: 0;
      width: 40px;
      height: 40px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 12px;
      background: linear-gradient(135deg, rgba(168, 85, 247, 0.22), rgba(236, 72, 153, 0.12));
      border: 1px solid rgba(168, 85, 247, 0.3);
      color: #c4b5fd;
      box-shadow:
        0 6px 18px rgba(124, 58, 237, 0.25),
        0 0 0 4px rgba(124, 58, 237, 0.06);
    }
    .pf-vg-head-text { flex: 1; min-width: 0; }
    .pf-vg-title {
      font-size: 16px;
      font-weight: 600;
      line-height: 1.35;
      letter-spacing: -0.011em;
      color: var(--text-primary);
      margin: 0;
    }
    .pf-vg-message {
      margin: 6px 0 0;
      font-size: 13.5px;
      line-height: 1.55;
      color: var(--text-secondary);
    }
  `]
})
export class App implements OnInit {
  // Eager-inject so the theme listener attaches on boot.
  private readonly _theme = inject(ThemeService);
  private readonly _capacitor = inject(CapacitorService);
  private readonly _push = inject(PushService);
  private readonly _platform = inject(PlatformService);
  protected readonly version = inject(VersionService);
  private readonly _lock = inject(LockService);

  async ngOnInit() {
    // Idle-lock timer for shared lab machines (arms only for PIN-enabled users).
    this._lock.start();
    // Version handshake — best-effort, fire-and-forget (errors are ignored
    // inside the service so an offline boot never hangs on it).
    void this.version.init();
    // Electron (Windows/macOS) marker class so pages can fork CSS the same
    // way Capacitor does with html.cap-native — e.g. ':host-context(html.electron) …'.
    // Mirrors capacitor.service adding html.cap-native/cap-<platform>.
    if (this._platform.isElectron()) {
      document.documentElement.classList.add('electron');
    }
    // Native macOS titlebar — no body class needed since the chrome
    // is owned by the OS, not the renderer.
    await this._capacitor.init();
    // Push + CallKit init lives in its own service so the surface area
    // (token registration, payload routing) stays out of capacitor.service.
    // No-op on web/electron.
    void this._push.init();
  }
}
