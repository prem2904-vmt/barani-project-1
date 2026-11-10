import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { IconName, PfIconComponent } from '@prefrontal/forms-engine';

export interface CsNavItem {
  id: 'departments' | 'cases' | 'settings';
  label: string;
  href: string;
  icon: IconName;
  /** Departments is '/', so it is active only on an exact match. */
  exact: boolean;
}

/** The public case-sheet site's three areas (plan §4.4) — exactly these, nothing from the LMS nav. */
export const CS_NAV: readonly CsNavItem[] = [
  { id: 'departments', label: 'Departments', href: '/', icon: 'forms', exact: true },
  { id: 'cases', label: 'Cases', href: '/cases', icon: 'cases', exact: false },
  { id: 'settings', label: 'Settings', href: '/settings', icon: 'settings', exact: false },
];

/**
 * The LMS bottom nav's floating pill (layout/bottom-nav: same tokens — `--header-bg` glass, `--gradient-primary`
 * active pill, `--text-tertiary` idle), with only the three case-sheet areas. Deliberately NOT the LMS
 * `<pf-bottom-nav>` itself: that one is wired to presence, branches, chat, the More menu and the LMS nav loaders,
 * none of which may start on the case-sheet site. Bottom on every size (no side rail); SVG icons; light + dark.
 */
@Component({
  selector: 'pf-cs-bottom-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="csn" aria-label="Case sheets">
      <div class="csn__pill">
        @for (n of items; track n.id) {
          <a class="csn__btn press"
             [routerLink]="n.href"
             routerLinkActive="csn__btn--on"
             [routerLinkActiveOptions]="{ exact: n.exact }"
             ariaCurrentWhenActive="page"
             [attr.data-nav]="n.id">
            <pf-icon [name]="n.icon" [size]="20" />
            <span class="csn__lbl">{{ n.label }}</span>
          </a>
        }
      </div>
    </nav>
  `,
  styles: [`
    :host { display: contents; }
    .csn {
      position: fixed;
      z-index: 2000;
      left: 50%;
      bottom: calc(env(safe-area-inset-bottom, 0px) + 8px);
      transform: translateX(-50%);
      max-width: calc(100vw - 16px);
    }
    .csn__pill {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 5px;
      border-radius: 9999px;
      background: var(--header-bg);
      border: 1px solid var(--header-border);
      box-shadow: 0 18px 40px -12px rgba(0, 0, 0, 0.35);
      backdrop-filter: blur(40px) saturate(1.4);
      -webkit-backdrop-filter: blur(40px) saturate(1.4);
    }
    .csn__btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      height: 44px;
      min-width: 88px;
      padding: 0 16px;
      border-radius: 9999px;
      color: var(--text-tertiary);
      font-size: 12px;
      font-weight: 600;
      line-height: 1;
      text-decoration: none;
      white-space: nowrap;
      transition: color 200ms ease, background 200ms ease, box-shadow 200ms ease;
    }
    .csn__btn:hover { color: var(--text-primary); }
    .csn__btn:focus-visible { outline: 2px solid var(--color-primary, #7c3aed); outline-offset: 2px; }
    .csn__btn--on,
    .csn__btn--on:hover {
      color: #fff;
      background: var(--gradient-primary);
      box-shadow: 0 6px 16px rgba(124, 58, 237, 0.45);
    }
    @media (max-width: 380px) {
      .csn__btn { min-width: 0; padding: 0 12px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .csn__btn { transition: none; }
    }
  `],
})
export class CsBottomNavComponent {
  protected readonly items = CS_NAV;
}
