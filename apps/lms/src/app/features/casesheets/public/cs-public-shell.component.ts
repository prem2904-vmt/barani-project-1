import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DialogHostComponent } from '../../../shared/components/dialog-host/dialog-host.component';
import { CsBottomNavComponent } from './cs-bottom-nav.component';

/**
 * The public case-sheet site's signed-in shell (plan §4.4): whatever page is routed (Departments / Cases / a case /
 * Settings — WP5's pages, or the placeholders until they land) + the three-item bottom nav + the app's dialog host
 * (DialogService: confirm / prompt — never window.confirm).
 *
 * Nothing else: no LMS shell, top strip, chat, calls, presence, people drawer, branch switch or nav loaders.
 * Reached only through casesheetsSignedInGuard (public-access.ts).
 */
@Component({
  selector: 'pf-cs-public-shell',
  standalone: true,
  imports: [RouterOutlet, CsBottomNavComponent, DialogHostComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cs-shell">
      <main class="cs-shell__main">
        <router-outlet />
      </main>
      <pf-cs-bottom-nav />
      <pf-dialog-host />
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .cs-shell {
      min-height: 100dvh;
      background: var(--bg-primary);
      color: var(--text-primary);
    }
    /* Clear the floating nav (44px pill + padding + 8px gap + safe area). */
    .cs-shell__main {
      min-height: 100dvh;
      padding-top: env(safe-area-inset-top, 0px);
      padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 80px);
    }
  `],
})
export class CsPublicShellComponent {}
