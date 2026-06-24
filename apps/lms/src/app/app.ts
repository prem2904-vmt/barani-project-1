import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './core/services/theme.service';
import { CapacitorService } from './core/services/capacitor.service';
import { PushService } from './core/services/push.service';
import { PlatformService } from './core/services/platform.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<router-outlet></router-outlet>`
})
export class App implements OnInit {
  // Eager-inject so the theme listener attaches on boot.
  private readonly _theme = inject(ThemeService);
  private readonly _capacitor = inject(CapacitorService);
  private readonly _push = inject(PushService);
  private readonly _platform = inject(PlatformService);

  async ngOnInit() {
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
