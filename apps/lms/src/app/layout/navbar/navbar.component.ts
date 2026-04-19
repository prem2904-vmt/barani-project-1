import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LogoMarkComponent } from '../../shared/primitives/logo-mark.component';

@Component({
  selector: 'pf-navbar',
  standalone: true,
  imports: [RouterLink, LogoMarkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="flex items-center justify-between px-6 py-3"
         style="border-bottom: 1px solid var(--border-muted); background: var(--bg-card-solid);">
      <a routerLink="/">
        <pf-logo-mark size="sm" variant="badge" [withWordmark]="true"></pf-logo-mark>
      </a>
      <div class="flex items-center gap-4 text-sm">
        <a routerLink="/login" style="color: var(--text-secondary);" class="hover:underline">Sign in</a>
      </div>
    </nav>
  `
})
export class NavbarComponent {}
