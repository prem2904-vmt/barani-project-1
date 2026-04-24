import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { NotificationBellComponent } from '../../shared/components/notification-bell/notification-bell.component';

@Component({
  selector: 'pf-header',
  standalone: true,
  imports: [NotificationBellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="h-16 border-b border-[var(--color-border)] bg-white flex items-center justify-between px-5">
      <div class="flex items-center gap-3">
        <div class="flex flex-col">
          <span class="text-[13px] font-semibold text-slate-900">{{ tenantName() }}</span>
          <span class="text-xs text-slate-500">{{ branchName() }}</span>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <pf-notification-bell></pf-notification-bell>
        <div class="flex items-center gap-2 pl-3 ml-2 border-l border-slate-200">
          <div class="h-8 w-8 rounded-full bg-[var(--color-accent)] text-white flex items-center justify-center font-semibold text-sm">
            {{ initials() }}
          </div>
          <div class="hidden sm:flex flex-col">
            <span class="text-sm font-medium leading-tight">{{ userName() }}</span>
            <span class="text-[11px] text-slate-500 leading-tight">admin (mock)</span>
          </div>
        </div>
      </div>
    </header>
  `
})
export class HeaderComponent {
  private readonly auth = inject(AuthService);
  readonly tenantName = () => this.auth.user()?.tenantName ?? '—';
  readonly branchName = () => this.auth.user()?.branchName ?? '—';
  readonly userName   = () => this.auth.user()?.displayName || 'User';
  readonly initials   = () => {
    const u = this.auth.user();
    const first = (u?.firstName || '').trim();
    const fathers = (u?.fathersName || '').trim();
    if (first || fathers) {
      return ((first[0] || '') + (fathers[0] || '')).toUpperCase() || 'U';
    }
    const n = (u?.displayName || '').trim();
    return n.split(/\s+/).filter(Boolean).map(p => p[0]).join('').slice(0, 2).toUpperCase() || 'U';
  };
}
