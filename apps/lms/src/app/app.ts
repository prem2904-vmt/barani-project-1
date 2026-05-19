import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './core/services/theme.service';
import { CapacitorService } from './core/services/capacitor.service';
import { PushService } from './core/services/push.service';

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

  async ngOnInit() {
    // Native macOS titlebar — no body class needed since the chrome
    // is owned by the OS, not the renderer.
    await this._capacitor.init();
    // Push + CallKit init lives in its own service so the surface area
    // (token registration, payload routing) stays out of capacitor.service.
    // No-op on web/electron.
    void this._push.init();
  }
}
