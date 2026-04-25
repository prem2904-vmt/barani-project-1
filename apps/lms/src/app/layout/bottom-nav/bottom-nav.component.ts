import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { BranchLabConfigService } from '../../core/services/branch-lab-config.service';
import { MORE_NAV, NavItem, PRIMARY_NAV } from '../nav-items';

@Component({
  selector: 'pf-bottom-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Floating pill — mobile + tablet. Desktop uses the top strip.
         Scrolls horizontally on narrow viewports so all nav items stay reachable
         without overflowing off-screen. -->
    <nav class="pf-bottom-nav xl:hidden fixed left-1/2 -translate-x-1/2 z-30 safe-area-bottom"
         style="bottom: max(1rem, env(safe-area-inset-bottom)); max-width: calc(100vw - 16px);">
      <div class="pf-pill flex items-center gap-0.5 sm:gap-1 p-1 sm:p-1.5 rounded-full shadow-2xl backdrop-blur-2xl overflow-x-auto"
           [class]="pillClasses">
        @for (n of primary(); track n.id) {
          <a [routerLink]="n.href"
             routerLinkActive="pf-nav-active"
             [routerLinkActiveOptions]="{ exact: !!n.exact }"
             class="pf-nav-btn press rounded-full flex flex-col items-center justify-center gap-0.5
                    shrink-0 w-10 h-10 sm:w-16 sm:h-14 text-[10px] font-semibold leading-none transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path [attr.d]="n.iconPath"/>
            </svg>
            <span class="hidden sm:inline">{{ n.label }}</span>
          </a>
        }

        @if (more().length > 0) {
          <div class="w-px h-8 sm:h-10 mx-0.5 shrink-0" style="background: var(--border-muted);"></div>

          <button type="button"
                  (click)="toggleMore()"
                  class="pf-nav-btn press rounded-full flex flex-col items-center justify-center gap-0.5
                         shrink-0 w-10 h-10 sm:w-16 sm:h-14 text-[10px] font-semibold leading-none transition-colors"
                  [class.pf-nav-active]="moreOpen()">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="5"  cy="12" r="1.8"/>
              <circle cx="12" cy="12" r="1.8"/>
              <circle cx="19" cy="12" r="1.8"/>
            </svg>
            <span class="hidden sm:inline">More</span>
          </button>
        }
      </div>
    </nav>

    <!-- More sheet — mobile only. -->
    @if (moreOpen()) {
      <div class="xl:hidden fixed inset-0 z-40 flex items-end justify-center glass-modal-backdrop fade-in"
           (click)="closeMore()">
        <div class="m-4 mb-28 p-4 rounded-[28px] min-w-[320px] max-w-[520px] w-[calc(100%-2rem)] slide-up glass-card-elevated grid grid-cols-3 sm:grid-cols-4 gap-2"
             (click)="$event.stopPropagation()">
          @for (n of more(); track n.id) {
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

    /* Hide horizontal scrollbar but keep the scroll behavior */
    .pf-pill::-webkit-scrollbar { display: none; }
    .pf-pill { scrollbar-width: none; -ms-overflow-style: none; }

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
  private readonly auth = inject(AuthService);
  private readonly labCfg = inject(BranchLabConfigService);

  constructor() { this.labCfg.ensureLoaded(); }

  private readonly visible = (items: NavItem[]): NavItem[] => {
    const cMode = this.labCfg.collectionMode();
    const bMode = this.labCfg.billingMode();
    return items.filter(i => {
      if (i.permissions?.length && !this.auth.hasAnyPermission(i.permissions)) return false;
      if (i.collectionModes && !i.collectionModes.includes(cMode)) return false;
      if (i.billingModes && !i.billingModes.includes(bMode)) return false;
      return true;
    });
  };

  readonly primary = computed(() => this.visible(PRIMARY_NAV));
  readonly more = computed(() => this.visible(MORE_NAV));

  protected readonly moreOpen = signal(false);

  get pillClasses(): string {
    return 'bg-[var(--header-bg)] border border-[var(--header-border)]';
  }

  toggleMore() { this.moreOpen.update(v => !v); }
  closeMore()  { this.moreOpen.set(false); }
}
