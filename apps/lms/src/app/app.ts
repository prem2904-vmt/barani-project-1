import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './core/services/theme.service';
import { CapacitorService } from './core/services/capacitor.service';

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

  async ngOnInit() {
    // Native macOS titlebar — no body class needed since the chrome
    // is owned by the OS, not the renderer.
    await this._capacitor.init();
  }
}
