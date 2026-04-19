import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

interface NavItem {
  id: string;
  label: string;
  href: string;
  exact?: boolean;
  iconPath: string;
}

const PRIMARY: NavItem[] = [
  {
    id: 'home',
    label: 'Home',
    href: '/admin',
    exact: true,
    iconPath: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1Z'
  },
  {
    id: 'reception',
    label: 'Reception',
    href: '/reception',
    iconPath: 'M5 21v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1'
  },
  {
    id: 'lab',
    label: 'Lab',
    href: '/lab/my-work',
    iconPath: 'M10 3h4v5l5 9a2.5 2.5 0 0 1-2.3 3.5H7.3A2.5 2.5 0 0 1 5 17l5-9V3Zm-2 9h8'
  },
  {
    id: 'validate',
    label: 'Validate',
    href: '/pathologist',
    iconPath: 'M20 6 9 17l-5-5'
  },
  {
    id: 'reports',
    label: 'Reports',
    href: '/reports',
    iconPath: 'M4 5h16v14H4zM8 10h8M8 14h5'
  }
];

const MORE: NavItem[] = [
  { id: 'tat',       label: 'TAT Board',     href: '/dashboard',              iconPath: 'M3 20V10l9-7 9 7v10M9 20v-6h6v6' },
  { id: 'users',     label: 'Users',         href: '/admin/users',            iconPath: 'M9 8a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20a6.5 6.5 0 0 1 13 0' },
  { id: 'tests',     label: 'Tests',         href: '/admin/tests',            iconPath: 'M11 4h3v9m-3-9v9h3m-3 0c-4-1-4-7 0-9M6 21h14M9 17h8' },
  { id: 'branches',  label: 'Branches',      href: '/admin/branches',         iconPath: 'M4 21V7l8-4 8 4v14M9 21v-5h6v5' },
  { id: 'billing',   label: 'Billing',       href: '/admin/billing',          iconPath: 'M3 5h18v14H3zM3 10h18M7 15h3' },
  { id: 'reports-t', label: 'Report theme',  href: '/admin/reports',          iconPath: 'M4 5h16v14H4zM8 10h8M8 14h5' },
  { id: 'notifs',    label: 'Notifications', href: '/admin/notifications',    iconPath: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2Zm5 4a1 1 0 0 0 2 0' },
  { id: 'workflows', label: 'Workflows',     href: '/admin/workflows',        iconPath: 'M3 4h6v6H3zM15 4h6v6h-6zM9 14h6v6H9zM9 7h6M12 14V10' },
  { id: 'setup',     label: 'Setup',         href: '/setup',                  iconPath: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z' }
];

@Component({
  selector: 'pf-bottom-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Floating pill — mobile only. Desktop uses the top strip. -->
    <nav class="pf-bottom-nav md:hidden fixed left-1/2 -translate-x-1/2 z-30 safe-area-bottom"
         style="bottom: max(1rem, env(safe-area-inset-bottom));">
      <div class="flex items-center gap-1 p-1.5 rounded-full shadow-2xl backdrop-blur-2xl"
           [class]="pillClasses">
        @for (n of primary; track n.id) {
          <a [routerLink]="n.href"
             routerLinkActive="pf-nav-active"
             [routerLinkActiveOptions]="{ exact: !!n.exact }"
             class="pf-nav-btn press rounded-full flex flex-col items-center justify-center gap-0.5
                    w-14 h-14 sm:w-16 sm:h-14 text-[10px] font-semibold leading-none transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path [attr.d]="n.iconPath"/>
            </svg>
            <span>{{ n.label }}</span>
          </a>
        }

        <div class="w-px h-10 mx-0.5" style="background: var(--border-muted);"></div>

        <button type="button"
                (click)="toggleMore()"
                class="pf-nav-btn press rounded-full flex flex-col items-center justify-center gap-0.5
                       w-14 h-14 sm:w-16 sm:h-14 text-[10px] font-semibold leading-none transition-colors"
                [class.pf-nav-active]="moreOpen()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5"  cy="12" r="1.8"/>
            <circle cx="12" cy="12" r="1.8"/>
            <circle cx="19" cy="12" r="1.8"/>
          </svg>
          <span>More</span>
        </button>
      </div>
    </nav>

    <!-- More sheet — mobile only. -->
    @if (moreOpen()) {
      <div class="md:hidden fixed inset-0 z-40 flex items-end justify-center glass-modal-backdrop fade-in"
           (click)="closeMore()">
        <div class="m-4 mb-28 p-4 rounded-[28px] min-w-[320px] max-w-[520px] w-[calc(100%-2rem)] slide-up glass-card-elevated grid grid-cols-3 sm:grid-cols-4 gap-2"
             (click)="$event.stopPropagation()">
          @for (n of more; track n.id) {
            <a [routerLink]="n.href"
               routerLinkActive="pf-more-active"
               (click)="closeMore()"
               class="pf-more-item flex flex-col items-center gap-2 px-2 py-3 rounded-2xl press transition-colors">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path [attr.d]="n.iconPath"/>
              </svg>
              <span class="text-[12px] font-medium text-center leading-tight">{{ n.label }}</span>
            </a>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    .pf-bottom-nav {}

    .pf-nav-btn {
      color: var(--text-tertiary);
    }
    .pf-nav-btn:hover {
      color: var(--text-primary);
      background: var(--bg-hover);
    }
    .pf-nav-active {
      background: var(--gradient-primary) !important;
      color: #ffffff !important;
      box-shadow: 0 6px 16px rgba(124, 58, 237, 0.35);
    }
    .pf-nav-active svg { filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3)); }

    .pf-more-item {
      color: var(--text-secondary);
      background: var(--glass-bg);
      border: 1px solid transparent;
    }
    .pf-more-item:hover {
      color: var(--text-primary);
      background: var(--glass-bg-hover);
      border-color: var(--glass-border);
    }
    .pf-more-active {
      background: var(--gradient-primary) !important;
      color: #ffffff !important;
      border-color: transparent !important;
    }
  `]
})
export class BottomNavComponent {
  readonly primary = PRIMARY;
  readonly more = MORE;

  protected readonly moreOpen = signal(false);

  get pillClasses(): string {
    return 'bg-[var(--header-bg)] border border-[var(--header-border)]';
  }

  toggleMore() { this.moreOpen.update(v => !v); }
  closeMore()  { this.moreOpen.set(false); }
}
