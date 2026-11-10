import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { IconName, PfIconComponent } from '@prefrontal/forms-engine';
import { FormBarService } from '../data/form-bar/form-bar.service';

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
 * While a case sheet is open its Back · Pages · Next take the three areas' place (one bar, like the LMS top strip's
 * `pf-formbar` slot; FormBarService) — without it the public filler had no way to turn a page or finish (WP11).
 */
@Component({
  selector: 'pf-cs-bottom-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, PfIconComponent, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (formBar.template(); as formTpl) {
    <div class="csn csn--form" data-formbar>
      <div class="csn__pill csn__pill--form">
        <ng-container [ngTemplateOutlet]="formTpl" />
      </div>
    </div>
    } @else {
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
    }
  `,
  styles: [`
    :host { display: contents; }
    /* The layer: the LMS bottom-nav layer, so dialogs, sheets (the patient step) and the filler's drawers stay ABOVE it (WP11). */
    .csn {
      position: fixed;
      z-index: var(--pf-z-bottom-nav, 35);
    }
    /* The placement, kept apart from the layer exactly like the LMS pill (layout/bottom-nav: '.pf-bottom-nav' holds only
       bottom/left/transform; 'fixed' + z come from the element). This bar IS the nav that --pf-nav-h measures, so it sits on the
       screen edge + safe area; things that must clear it use --pf-nav-h (nav-clearance.spec.ts). */
    .csn {
      bottom: calc(env(safe-area-inset-bottom, 0px) + 8px);
      left: 50%;
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
    .csn--form { width: min(640px, calc(100vw - 16px)); }
    .csn__pill--form { position: relative; overflow: hidden; min-height: 54px; padding: 4px 8px; }
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
  protected readonly formBar = inject(FormBarService);
}
