import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy,
  computed, effect, inject, signal, viewChild, viewChildren
} from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { BranchLabConfigService } from '../../core/services/branch-lab-config.service';
import { MORE_NAV, NavItem, PRIMARY_NAV } from '../nav-items';

const DRAG_THRESHOLD_PX = 4;

@Component({
  selector: 'pf-bottom-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Desktop-only edge-trigger zone. Invisible 12px strip pinned
         to the left of the viewport; hovering it reveals the rail.
         Hidden on mobile + tablet where the bottom pill handles
         everything. -->
    <div class="pf-rail-trigger hidden xl:block"
         (mouseenter)="showRail()"
         aria-hidden="true"></div>

    <!-- Universal nav surface across web, tablet, and mobile.
         Mobile + tablet: floating pill (centered, ~16px above the bottom).
         Desktop (xl+): auto-hide vertical rail revealed by the trigger
         zone above; floats over content (shell padding stays at 0). -->
    <nav class="pf-bottom-nav fixed left-1/2 -translate-x-1/2 z-30 safe-area-bottom
                xl:left-0 xl:right-0 xl:translate-x-0"
         [class.pf-rail-visible]="railVisible()"
         (mouseenter)="showRail()"
         (mouseleave)="scheduleHideRail()"
         style="bottom: max(1rem, env(safe-area-inset-bottom)); max-width: calc(100vw - 16px);">
      <div #pill
           class="pf-pill flex items-center gap-0.5 sm:gap-1 p-1 sm:p-1.5 rounded-full shadow-2xl backdrop-blur-2xl overflow-x-auto
                  xl:rounded-none xl:shadow-none xl:p-2 xl:justify-center xl:gap-2"
           [class]="pillClasses"
           [class.pf-pill--dragging]="dragging()"
           (pointerdown)="onPillPointerDown($event)"
           (pointermove)="onPillPointerMove($event)"
           (pointerup)="onPillPointerUp($event)"
           (pointercancel)="onPillPointerUp($event)"
           (mousemove)="onRailMouseMove($event)"
           (mouseleave)="onRailMouseLeave()">
        <!-- Desktop-only pin toggle. Pinned = rail stays visible
             permanently and the page reserves 56px of left padding
             so content reflows. Unpinned = auto-hide; rail slides
             off until the user hovers the left-edge trigger zone. -->
        <button type="button"
                class="pf-rail-pin hidden xl:flex"
                (click)="togglePin()"
                [attr.aria-label]="pinned() ? 'Unpin (auto-hide sidebar)' : 'Pin sidebar open'"
                [attr.aria-pressed]="pinned()"
                [title]="pinned() ? 'Unpin · auto-hide' : 'Pin sidebar'">
          <svg width="18" height="18" viewBox="0 0 24 24"
               [attr.fill]="pinned() ? 'currentColor' : 'none'"
               stroke="currentColor" stroke-width="1.7"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 17v5"/>
            <path d="M9 10.76V6a3 3 0 0 1 6 0v4.76l3 4.24H6Z"/>
          </svg>
        </button>

        <!-- Sliding gradient indicator. One element shared across all
             tabs — its position + width is driven by the active button's
             offsetLeft / offsetWidth so it glides between tabs. During a
             drag, position follows the pointer 1:1 (transitions off);
             on release it springs to the snapped target. -->
        <!-- Liquid-glass slider. At rest it's the gradient highlight
             pill behind the active tab. While dragging it transforms
             into a translucent glass pill that glides across the bar —
             icons stay put underneath; the slider's own backdrop blur
             + tinted edges give the iOS Liquid-Glass feel as it slides
             over them. -->
        <span class="pf-nav-indicator"
              [class.pf-nav-indicator--ready]="indicatorReady()"
              [class.pf-nav-indicator--dragging]="dragging()"
              [style.transform]="indicatorTransform()"
              [style.width.px]="indicatorRenderedW()"
              [style.height.px]="indicatorRenderedH()"
              aria-hidden="true"></span>

        @for (n of primary(); track n.id; let i = $index) {
          <button #navBtn type="button"
                  (click)="onTabClick(i, $event)"
                  class="pf-nav-btn press rounded-full flex flex-col items-center justify-center gap-0.5
                         shrink-0 w-11 h-11 sm:w-16 sm:h-16 text-[10px] font-semibold leading-none transition-colors"
                  [class.pf-nav-btn--active]="activeIdx() === i">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path [attr.d]="n.iconPath"/>
            </svg>
            <span class="hidden sm:inline">{{ n.label }}</span>
          </button>
        }

        @if (more().length > 0) {
          <!-- Mobile + tablet only: divider + More button.
               Desktop renders all More items inline (block below). -->
          <div class="pf-rail-mobile-only w-px h-8 sm:h-10 mx-0.5 shrink-0"
               style="background: var(--border-muted);"></div>

          <button #navBtn type="button"
                  (click)="onMoreClick($event)"
                  class="pf-nav-btn pf-rail-mobile-only press rounded-full flex flex-col items-center justify-center gap-0.5
                         shrink-0 w-11 h-11 sm:w-16 sm:h-16 text-[10px] font-semibold leading-none transition-colors"
                  [class.pf-nav-btn--active]="moreActive()">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="5"  cy="12" r="1.8"/>
              <circle cx="12" cy="12" r="1.8"/>
              <circle cx="19" cy="12" r="1.8"/>
            </svg>
            <span class="hidden sm:inline">More</span>
          </button>
        }

        <!-- Desktop-only: render every More item inline in the rail
             (we have the vertical room). Hidden at < xl via CSS;
             the mobile/tablet sheet below handles those breakpoints. -->
        @for (n of more(); track n.id) {
          <a #navBtn
             [routerLink]="n.href"
             routerLinkActive="pf-nav-btn--active"
             class="pf-nav-btn pf-rail-more-item press rounded-full flex flex-col items-center justify-center gap-0.5
                    shrink-0 w-11 h-11 sm:w-16 sm:h-16 text-[10px] font-semibold leading-none transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              @for (path of n.iconPath; track $index) {
                <path [attr.d]="path"/>
              }
            </svg>
            <span class="hidden sm:inline">{{ n.label }}</span>
          </a>
        }
      </div>
    </nav>

    <!-- Mobile / tablet More sheet — hidden on desktop where the
         rail expands inline above. -->
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

    /* Inline More items render in the rail at xl; hide them on
     * mobile + tablet (where the bottom-sheet handles the same
     * group). The sheet itself is xl:hidden in the template. */
    .pf-rail-more-item { display: none; }

    /* ─── Desktop (≥1280px) — slim icon-only rail ───────────────
     * Linear / Cursor pattern. 56px wide, every nav item (primary
     * + the entire More group) renders inline as an icon button.
     * Labels appear as floating tooltips on hover so the layout
     * stays stable. Surface = top-strip's --header-bg so they form
     * one L-shaped chrome panel; light/dark theme follows the page
     * automatically. */
    @media (min-width: 1280px) {
      /* Edge-trigger zone — invisible 12px strip pinned to the
       * left of the viewport. Sits above content so it can catch
       * mouseenter, but pointer-events are otherwise transparent
       * to scrolling / clicking through it. */
      .pf-rail-trigger {
        position: fixed;
        top: 0;
        left: 0;
        bottom: 0;
        width: 12px;
        z-index: 34;
        background: transparent;
        cursor: default;
      }

      .pf-bottom-nav {
        /* Start below the top-strip so the rail's pin button isn't
         * overlapped by the brand pill. The top-strip is ~64px high
         * with ~12px outer top padding ≈ 76px. Bottom 0 keeps the
         * rail full-height down to the viewport floor. */
        top: 76px !important;
        bottom: 0 !important;
        left: 0 !important;
        right: auto !important;
        max-width: none !important;
        width: 56px;
        z-index: 35;
        overflow: visible;
        /* Start off-screen; the .pf-rail-visible class flips this
         * to translateX(0) when the user hovers the trigger zone
         * or the rail itself. */
        transform: translateX(-100%) !important;
        transition: transform 220ms cubic-bezier(0.4, 0, 0.2, 1);
      }
      .pf-bottom-nav.pf-rail-visible {
        transform: translateX(0) !important;
      }
      /* Hidden rail shouldn't catch stray clicks. Buttons stay
       * accessible via Tab key (transform hides them visually). */
      .pf-bottom-nav:not(.pf-rail-visible) {
        pointer-events: none;
      }
      .pf-bottom-nav.pf-rail-visible {
        pointer-events: auto;
      }
      .pf-bottom-nav .pf-pill {
        position: relative;
        flex-direction: column;
        width: 56px;
        height: 100%;
        /* Top padding reserves room for the pin button (36px tall
         * with 10px gutter above + 8px below). */
        padding: 56px 0 12px !important;
        gap: 4px !important;
        border-radius: 0 !important;
        border: none !important;
        background: var(--header-bg) !important;
        box-shadow: none !important;
        backdrop-filter: saturate(180%) blur(20px);
        -webkit-backdrop-filter: saturate(180%) blur(20px);
        transition: width 220ms cubic-bezier(0.4, 0, 0.2, 1),
                    padding 220ms cubic-bezier(0.4, 0, 0.2, 1);
        /* IMPORTANT: must be visible (no overflow:auto) so floating
         * tooltips on the bottom buttons aren't clipped by the
         * scroll container. With ≤12 nav items at 44px each the
         * cluster fits inside any reasonable viewport. */
        overflow: visible !important;
        align-items: center;
        /* Center the cluster vertically — feels balanced for the
         * usual handful of nav items. */
        justify-content: center;
      }


      /* Icon-only tile. Label is hidden inline; reposition as a
       * tooltip on hover (block below). The --mag CSS variable is
       * driven by onRailMouseMove for Mac-dock-style magnification;
       * defaults to 1 when the cursor is far away or on touch. */
      .pf-bottom-nav .pf-nav-btn {
        position: relative;
        width: 40px !important;
        height: 40px !important;
        gap: 0 !important;
        padding: 0;
        border-radius: 10px !important;
        color: var(--text-tertiary);
        transform: scale(var(--mag, 1));
        transform-origin: left center;
        transition: color 160ms ease,
                    background 160ms ease,
                    transform 80ms cubic-bezier(0.4, 0, 0.2, 1);
        will-change: transform;
      }
      .pf-bottom-nav .pf-nav-btn svg {
        width: 20px;
        height: 20px;
        stroke-width: 1.7;
      }

      /* Tooltip: take the inline label, anchor it to the right of
       * the button on hover. Layout never shifts. */
      .pf-bottom-nav .pf-nav-btn span {
        display: inline !important;
        position: absolute;
        left: calc(100% + 12px);
        top: 50%;
        transform: translateY(-50%) translateX(-4px);
        padding: 5px 10px;
        border-radius: 8px;
        background: var(--bg-card-solid);
        border: 1px solid var(--glass-border);
        color: var(--text-primary);
        font-size: 12px;
        font-weight: 500;
        letter-spacing: 0;
        text-transform: none;
        line-height: 1;
        white-space: nowrap;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
        transition: opacity 140ms ease, transform 140ms ease, visibility 0s linear 140ms;
        z-index: 100;
      }

      @media (hover: hover) and (pointer: fine) {
        .pf-bottom-nav .pf-nav-btn:hover {
          background: rgba(168, 85, 247, 0.06);
          color: var(--text-primary);
        }
        .pf-bottom-nav .pf-nav-btn:hover span {
          opacity: 1;
          visibility: visible;
          transform: translateY(-50%) translateX(0);
          transition: opacity 140ms ease, transform 140ms ease, visibility 0s linear 0s;
        }
      }

      /* Active state — subtle violet pill, brand-coloured icon. */
      .pf-bottom-nav .pf-nav-btn--active {
        background: rgba(168, 85, 247, 0.14) !important;
        color: var(--text-primary) !important;
      }
      .pf-bottom-nav .pf-nav-btn--active svg {
        color: #a855f7;
        filter: none;
        animation: none;
      }

      /* Show every More item inline at xl (rail-more-item is hidden
       * by default — that default exists only so they don't render
       * in the mobile pill where the bottom-sheet handles them). */
      .pf-bottom-nav .pf-rail-more-item {
        display: flex !important;
      }

      /* Hide the mobile-only divider + More button — at xl the More
       * group lives inline, no popover needed. */
      .pf-bottom-nav .pf-rail-mobile-only {
        display: none !important;
      }

      /* The horizontal-row JS slider isn't meaningful in a vertical
       * column. The CSS active state above does the highlighting. */
      .pf-bottom-nav .pf-nav-indicator {
        display: none !important;
      }

      /* Pin toggle — floats absolute at the rail's top, centered.
       * Sized to feel like a first-class touch target (36×36) so
       * it's easy to find and grab. Subtle by default, brightens
       * on hover; brand-coloured + slight glow when pinned. */
      .pf-rail-pin {
        position: absolute;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        width: 36px;
        height: 36px;
        align-items: center;
        justify-content: center;
        border-radius: 10px;
        background: transparent;
        border: 1px solid transparent;
        color: var(--text-secondary);
        cursor: pointer;
        z-index: 5;
        transition: color 140ms ease, background 140ms ease,
                    border-color 140ms ease, box-shadow 140ms ease;
      }
      .pf-rail-pin:hover {
        color: var(--text-primary);
        background: rgba(168, 85, 247, 0.12);
        border-color: rgba(168, 85, 247, 0.22);
      }
      .pf-rail-pin[aria-pressed="true"] {
        color: #a855f7;
        background: rgba(168, 85, 247, 0.14);
        border-color: rgba(168, 85, 247, 0.30);
        box-shadow: 0 0 12px rgba(168, 85, 247, 0.25);
      }

      /* Pinned: rail forced visible, trigger zone hidden. The page's
       * 56px shell padding (set in shell.component.ts via
       * :host-context(.is-rail-pinned)) makes room so content reflows
       * around it. */
      :root.is-rail-pinned .pf-bottom-nav {
        transform: translateX(0) !important;
        pointer-events: auto !important;
      }
      :root.is-rail-pinned .pf-rail-trigger {
        display: none !important;
      }
    }


    /* The pill is the positioning context for the indicator + the
       pointer-event surface for the drag gesture. touch-action: pan-y
       reserves vertical scrolling for the page so horizontal swipes
       become our drag (we cancel them via preventDefault on move). */
    .pf-pill {
      position: relative;
      touch-action: pan-y;
      user-select: none;
      -webkit-user-select: none;
      transition: box-shadow 200ms ease;
    }
    .pf-pill::-webkit-scrollbar { display: none; }
    .pf-pill { scrollbar-width: none; -ms-overflow-style: none; }
    /* While dragging the pill clips horizontal scroll (so our gesture
     * doesn't compete with native overflow-x) AND releases vertical
     * overflow so the magnified loupe can rise above the bar's top
     * edge — like a real magnifier lifting off the page. The clip
     * value on overflow-x is the only one that allows the OTHER axis
     * to stay visible (hidden / auto / scroll all force a single
     * overflow style). Modern Chrome/Firefox/Safari all support it. */
    .pf-pill--dragging {
      overflow-x: clip;
      overflow-y: visible;
      box-shadow:
        0 18px 48px rgba(0,0,0,0.6),
        0 0 0 1px rgba(168, 85, 247, 0.25) inset;
    }
    /* The wrapping <nav> is also overflow-clipped by default by the
     * fixed positioning — make sure the magnifier can poke above. */
    .pf-bottom-nav { overflow: visible; }

    /* ─── Sliding indicator ───────────────────────────────────
     * One shared pill that glides between tabs. Position + width are
     * bound to the active button's offsetLeft / offsetWidth so it lands
     * exactly under whichever icon is current. Spring-ish overshoot on
     * the snap (cubic-bezier(0.34, 1.56, 0.64, 1)) — disabled while
     * dragging so the indicator follows the finger 1:1. */
    .pf-nav-indicator {
      position: absolute;
      top: 50%;
      left: 0;
      transform: translateX(0);
      transform-origin: center center;
      border-radius: 9999px;
      background: var(--gradient-primary);
      box-shadow: 0 6px 16px rgba(124, 58, 237, 0.45);
      pointer-events: none;
      z-index: 0;
      will-change: transform, width, height, background, box-shadow;
      /* Clip the duplicate nav row to the loupe's rounded shape so the
         magnified content stretches out of view at the edges. */
      overflow: hidden;
      transition:
        background 220ms ease,
        box-shadow 220ms ease,
        border-color 220ms ease;
      border: 1px solid transparent;
    }
    .pf-nav-indicator--ready {
      transition:
        transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1),
        width     260ms cubic-bezier(0.34, 1.56, 0.64, 1),
        height    260ms cubic-bezier(0.34, 1.56, 0.64, 1),
        background 220ms ease,
        box-shadow 220ms ease,
        border-color 220ms ease;
    }
    /* Drag state — Liquid-Glass loupe.
     * Background goes from gradient to near-transparent with a faint
     * white inner glow so the duplicate icons inside the loupe read
     * as the real icons seen through glass. Multi-layer box-shadow
     * gives a heavy outer drop, a white rim, and two thin chromatic-
     * aberration rings (cyan inside, magenta outside) for the iOS
     * Liquid-Glass fringe. */
    .pf-nav-indicator--dragging {
      /* Liquid violet glass.
       *
       * Two stacked backgrounds give the slider weight + lens shine:
       *   1. A specular radial highlight at the top-left, soft and
       *      diffuse, like studio light sitting on curved glass.
       *   2. A monochromatic violet gradient — same hue family
       *      throughout (deep violet → bright lavender → soft mauve)
       *      so it reads as a single brand-coloured object, no
       *      "rainbow stripe" feel.
       *
       * Backdrop blur softens whatever's behind it (real refraction).
       * Edges use only soft white glints + a single violet halo —
       * no hard cyan/magenta chromatic rings any more, which read as
       * harsh next to the brand colour. */
      background:
        radial-gradient(120% 80% at 30% 20%,
          rgba(255, 255, 255, 0.42) 0%,
          rgba(255, 255, 255, 0.10) 38%,
          transparent 72%),
        linear-gradient(135deg,
          rgba(124, 58, 237, 0.62) 0%,
          rgba(168, 85, 247, 0.55) 45%,
          rgba(192, 132, 252, 0.50) 100%);
      backdrop-filter: blur(14px) saturate(160%);
      -webkit-backdrop-filter: blur(14px) saturate(160%);
      border-color: rgba(221, 214, 254, 0.55);
      box-shadow:
        0 16px 40px rgba(124, 58, 237, 0.48),
        0 0 0 1px rgba(255, 255, 255, 0.34) inset,
        0 -1px 0 1px rgba(255, 255, 255, 0.22) inset,
        0  8px 14px rgba(58, 12, 130, 0.22) inset,
        0 0 32px rgba(168, 85, 247, 0.55);
      transition:
        background 220ms ease,
        border-color 220ms ease,
        box-shadow 220ms ease,
        backdrop-filter 220ms ease;
    }

    /* ─── Tab buttons ─────────────────────────────────────────
     * No per-tab background — the indicator owns the highlight. Buttons
     * sit above the indicator and crossfade icon colour as the indicator
     * arrives. */
    .pf-nav-btn {
      position: relative;
      z-index: 1;
      color: var(--text-tertiary);
      transition: color 320ms cubic-bezier(0.4, 0, 0.2, 1);
      background: transparent;
      border: 0;
      cursor: pointer;
      /* Reserve vertical pan for the page; horizontal drag belongs to
         our pointer handler. Without this the browser may treat a
         finger-on-button + sideways-swipe as native overflow-x scroll
         and eat our pointermove events. */
      touch-action: pan-y;
    }
    .pf-nav-btn:hover {
      color: var(--text-primary);
    }
    .pf-nav-btn--active {
      color: #ffffff;
    }
    .pf-nav-btn--active svg {
      filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));
      animation: pf-nav-icon-bump 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    @keyframes pf-nav-icon-bump {
      0%   { transform: scale(1); }
      55%  { transform: scale(1.10); }
      100% { transform: scale(1); }
    }

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

    @media (prefers-reduced-motion: reduce) {
      .pf-nav-indicator--ready { transition: none; }
      .pf-nav-btn--active svg { animation: none; }
    }
  `]
})
export class BottomNavComponent implements AfterViewInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly labCfg = inject(BranchLabConfigService);
  private readonly router = inject(Router);

  private readonly btns = viewChildren<ElementRef<HTMLElement>>('navBtn');
  private readonly pillRef = viewChild<ElementRef<HTMLElement>>('pill');

  protected readonly moreOpen = signal(false);

  /**
   * Desktop-only auto-hide. The rail starts off-screen (translateX
   * -100%) and slides in when the user hovers the left-edge trigger
   * zone or the rail itself. Slides back out 180ms after the cursor
   * leaves both — short enough to feel instant, long enough that
   * moving the cursor between the trigger zone and the rail
   * doesn't flicker. Suppressed entirely when the rail is pinned.
   */
  protected readonly railVisible = signal(false);
  private hideRailTimer: number | null = null;

  /**
   * Pin override — when true, auto-hide is disabled and the page
   * reserves 56px of left padding so content reflows next to the
   * always-visible rail. Persisted to localStorage; mirrored onto
   * <html class="is-rail-pinned"> so global layout CSS can react.
   *
   * Defaults to PINNED on first visit (no key set) so users see the
   * navigation immediately. Only flips off when they explicitly
   * unpin — the explicit '0' value is preserved across reloads.
   */
  protected readonly pinned = signal<boolean>(
    typeof localStorage === 'undefined' ||
    localStorage.getItem('pf-rail-pinned') !== '0'
  );

  togglePin(): void {
    const next = !this.pinned();
    this.pinned.set(next);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('pf-rail-pinned', next ? '1' : '0');
    }
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('is-rail-pinned', next);
    }
  }

  protected showRail(): void {
    if (this.hideRailTimer !== null) {
      clearTimeout(this.hideRailTimer);
      this.hideRailTimer = null;
    }
    if (!this.railVisible()) this.railVisible.set(true);
  }

  protected scheduleHideRail(): void {
    // Pinned rail never auto-hides.
    if (this.pinned()) return;
    if (this.hideRailTimer !== null) clearTimeout(this.hideRailTimer);
    this.hideRailTimer = window.setTimeout(() => {
      this.railVisible.set(false);
      this.hideRailTimer = null;
    }, 180);
  }

  /**
   * Mac-dock magnification on the desktop rail. Scales each button
   * based on cursor distance: 1.0 at ≥80px, 1.4× directly under
   * the cursor. Origin = left center so the icons "pop out" toward
   * the content area instead of crowding the rail.
   */
  protected onRailMouseMove(ev: MouseEvent): void {
    if (typeof window === 'undefined') return;
    if (!window.matchMedia('(min-width: 1280px)').matches) return;
    const FALLOFF = 80;
    const PEAK = 1.4;
    for (const ref of this.btns()) {
      const el = ref.nativeElement;
      const rect = el.getBoundingClientRect();
      const center = rect.top + rect.height / 2;
      const distance = Math.abs(ev.clientY - center);
      const t = Math.max(0, 1 - distance / FALLOFF);
      const scale = 1 + (PEAK - 1) * t;
      el.style.setProperty('--mag', scale.toFixed(3));
    }
  }

  protected onRailMouseLeave(): void {
    for (const ref of this.btns()) {
      ref.nativeElement.style.removeProperty('--mag');
    }
  }

  // ─── Active state ────────────────────────────────────────────────
  protected readonly activeIdx = signal<number>(0);
  protected readonly moreActive = computed(() => this.activeIdx() === this.primary().length);

  // ─── Indicator geometry ──────────────────────────────────────────
  protected readonly indicator = signal<{ x: number; w: number; h: number }>({ x: 0, w: 56, h: 40 });
  protected readonly indicatorReady = signal(false);

  // ─── Loupe rendered geometry ─────────────────────────────────────
  // While dragging the loupe (1) gets a bigger CSS box so it captures
  // more world content (2 buttons-ish), (2) scales 1.35× via transform
  // for the magnification, and (3) re-centres on the user's drag
  // position so it doesn't drift off-axis when the active button width
  // differs from the rendered loupe width.

  /** Indicator's rendered width: ~1.25× during drag — modestly wider
   *  than the active button, just enough to read as an oval glass
   *  pill rather than a circle. */
  protected readonly indicatorRenderedW = computed(() => {
    const baseW = this.indicator().w;
    return this.dragging() ? Math.max(baseW * 1.25, 78) : baseW;
  });

  /** Indicator's rendered height: ~1.2× during drag — slightly taller
   *  than the bar so the glass oval lifts ~2–3 mm above. Always less
   *  than the rendered width so the silhouette stays a horizontal
   *  oval (not a circle or upright pill). */
  protected readonly indicatorRenderedH = computed(() => {
    const baseH = this.indicator().h;
    return this.dragging() ? baseH * 1.2 : baseH;
  });

  /** Indicator's rendered left: keeps the loupe centred on the same
   *  point the user is dragging (the active button's centre) even when
   *  rendered width != base width. */
  protected readonly indicatorRenderedX = computed(() => {
    const baseW = this.indicator().w;
    const renderedW = this.indicatorRenderedW();
    const cx = this.indicator().x + baseW / 2;
    return cx - renderedW / 2;
  });

  /** Composite transform: at rest the loupe stays vertically centred
   *  on the pill. Mid-drag we bias the centre slightly upward so the
   *  glass oval rises a couple of millimetres above the bar. Scale
   *  is light (1.05) — just enough to feel "lifted" off the surface
   *  without ballooning. */
  protected readonly indicatorTransform = computed(() => {
    const x = this.indicatorRenderedX();
    const scale = this.dragging() ? 1.05 : 1;
    const ty = this.dragging() ? '-55%' : '-50%';
    return `translate(${x}px, ${ty}) scale(${scale})`;
  });


  // ─── Drag state (transient, not used for change detection beyond the
  //     `dragging` signal that drives the CSS transition toggle) ─────
  protected readonly dragging = signal(false);
  private dragPointerId: number | null = null;
  private dragStartClientX = 0;
  private dragStartIndicatorW = 0;
  // Pill's left edge + current scrollLeft snapshot at pointerdown — used
  // to convert a pointer's clientX into a pill-content-relative X so the
  // indicator can lock its centre to wherever the finger is. Snapshotted
  // (not recomputed each move) because the pill is fixed-position and
  // scroll is clipped during drag, so it can't shift mid-gesture.
  private dragPillLeft = 0;
  private dragPillScrollLeft = 0;
  private dragMoved = false;
  private justDraggedAt = 0;        // performance.now() when the drag finished

  private routerSub?: Subscription;
  private resizeListener?: () => void;

  constructor() {
    this.labCfg.ensureLoaded();

    // Apply persisted pin state on first paint so the page doesn't
    // flash full-width before reflowing into the pinned-rail layout.
    if (typeof document !== 'undefined' && this.pinned()) {
      document.documentElement.classList.add('is-rail-pinned');
    }

    // Re-measure whenever the visible nav set changes (perm reload, mode
    // toggle, etc) so the indicator stays glued to the active button.
    effect(() => {
      const _btns = this.btns();
      const _idx = this.activeIdx();
      if (_btns.length === 0 || this.dragging()) return;
      requestAnimationFrame(() => this.measureToActive());
    });
  }

  ngAfterViewInit(): void {
    this.routerSub = this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe(() => this.recomputeActiveFromUrl());
    this.recomputeActiveFromUrl();

    this.resizeListener = () => this.measureToActive();
    window.addEventListener('resize', this.resizeListener);
  }

  ngOnDestroy(): void {
    this.routerSub?.unsubscribe();
    if (this.resizeListener) window.removeEventListener('resize', this.resizeListener);
  }

  // ─── Visible nav lists ───────────────────────────────────────────
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

  get pillClasses(): string {
    return 'bg-[var(--header-bg)] border border-[var(--header-border)]';
  }

  toggleMore() { this.moreOpen.update(v => !v); }
  closeMore()  { this.moreOpen.set(false); }

  // ─── Click → navigate ────────────────────────────────────────────
  onTabClick(idx: number, ev: MouseEvent): void {
    // Suppress the synthetic click that fires after a finger drag — the
    // drag-release path already navigated; a duplicate router call here
    // is harmless but we want the tap-vs-drag distinction to stay clean.
    if (performance.now() - this.justDraggedAt < 250) {
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    this.setActive(idx, /* navigate */ true);
  }

  onMoreClick(ev: MouseEvent): void {
    if (performance.now() - this.justDraggedAt < 250) {
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    this.activeIdx.set(this.primary().length);
    this.toggleMore();
  }

  // ─── Pointer drag ────────────────────────────────────────────────

  onPillPointerDown(ev: PointerEvent): void {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    // Skip the drag-to-slide gesture on the desktop vertical rail.
    // Capturing the pointer here would re-target click events to the
    // pill, swallowing nav clicks on each button. The vertical rail
    // doesn't use horizontal drag anyway, so just bail.
    if (typeof window !== 'undefined' &&
        window.matchMedia('(min-width: 1280px)').matches) return;
    this.dragPointerId = ev.pointerId;
    this.dragStartClientX = ev.clientX;
    this.dragStartIndicatorW = this.indicator().w;
    this.dragMoved = false;

    // Snapshot the pill's position so we can map clientX -> pill-content
    // X without re-querying layout on every pointermove.
    const pill = this.pillRef()?.nativeElement;
    if (pill) {
      const rect = pill.getBoundingClientRect();
      this.dragPillLeft = rect.left;
      this.dragPillScrollLeft = pill.scrollLeft;
    }

    // Capture immediately. We don't want to wait until the threshold is
    // crossed — if we do, a fast swipe whose finger leaves the pill
    // mid-flight (between pointerdown and threshold) will silently lose
    // its pointermove stream. Capturing now routes every subsequent
    // move/up to the pill regardless of where the finger is on screen,
    // so the slider can follow the finger from tab 1 all the way to
    // tab 5 without dropping events.
    pill?.setPointerCapture?.(ev.pointerId);
  }

  onPillPointerMove(ev: PointerEvent): void {
    if (this.dragPointerId !== ev.pointerId) return;
    const dx = ev.clientX - this.dragStartClientX;

    if (!this.dragMoved) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;
      // Crossed the threshold — promote to drag mode (turns off the
      // indicator's spring transition so it tracks the finger 1:1).
      this.dragMoved = true;
      this.dragging.set(true);
    }

    ev.preventDefault();

    // Lock the indicator's centre to the finger's X within the pill
    // content. This is what makes "tap on tab 5 and slide" work: on the
    // first qualifying move the indicator jumps under the finger and
    // tracks 1:1 from there, regardless of which tab was active before.
    const pointerXInPill = ev.clientX - this.dragPillLeft + this.dragPillScrollLeft;
    const halfW = this.dragStartIndicatorW / 2;
    const targetX = this.clampIndicatorX(pointerXInPill - halfW);
    this.indicator.update(g => ({ ...g, x: targetX }));

    // Active-idx live update — the icon the indicator centre sits over
    // goes white as the finger passes. Navigation itself is deferred to
    // pointerup so we don't router-thrash mid-drag.
    const centerX = targetX + halfW;
    const idx = this.idxAtCenter(centerX);
    if (idx !== this.activeIdx()) this.activeIdx.set(idx);
  }

  onPillPointerUp(ev: PointerEvent): void {
    if (this.dragPointerId !== ev.pointerId) return;
    const wasDrag = this.dragMoved;
    this.dragPointerId = null;
    this.dragMoved = false;

    if (wasDrag) {
      // Snap to the final active idx. Re-enabling the transition (by
      // dropping the --dragging class) lets the indicator spring to
      // measuredX with the cubic-bezier overshoot.
      this.dragging.set(false);
      this.justDraggedAt = performance.now();
      requestAnimationFrame(() => this.measureToActive());

      // Navigate to the snapped tab. If it's the More button index,
      // open the sheet instead.
      const idx = this.activeIdx();
      if (idx === this.primary().length) {
        this.toggleMore();
      } else {
        this.navigateTo(idx);
      }
    }
  }

  /** Map a (px) center X over the pill row to a button index. */
  private idxAtCenter(centerX: number): number {
    const btns = this.btns();
    if (btns.length === 0) return 0;
    for (let i = 0; i < btns.length; i++) {
      const el = btns[i].nativeElement;
      const left = el.offsetLeft;
      const right = left + el.offsetWidth;
      if (centerX >= left && centerX < right) return i;
    }
    // Past the last edge — clamp to nearest end.
    const first = btns[0].nativeElement;
    if (centerX < first.offsetLeft) return 0;
    return btns.length - 1;
  }

  /** Clamp the indicator's left edge so it never escapes the pill. */
  private clampIndicatorX(x: number): number {
    const btns = this.btns();
    if (btns.length === 0) return x;
    const first = btns[0].nativeElement;
    const last = btns[btns.length - 1].nativeElement;
    return Math.max(first.offsetLeft, Math.min(last.offsetLeft, x));
  }

  /** Navigate to the URL of the primary tab at `idx`. */
  private navigateTo(idx: number): void {
    const items = this.primary();
    if (idx < 0 || idx >= items.length) return;
    this.router.navigateByUrl(items[idx].href);
  }

  /** Tap-style commit: set active and navigate. */
  private setActive(idx: number, navigate: boolean): void {
    this.activeIdx.set(idx);
    if (navigate) this.navigateTo(idx);
  }

  // ─── URL → active idx ────────────────────────────────────────────

  private recomputeActiveFromUrl(): void {
    if (this.dragging()) return; // user is mid-drag — they own the indicator
    const url = this.router.url.split('?')[0];
    const primary = this.primary();
    const idx = primary.findIndex(n => this.matches(url, n));
    if (idx >= 0) {
      this.activeIdx.set(idx);
      return;
    }
    if (this.more().length > 0 && this.more().some(n => this.matches(url, n))) {
      this.activeIdx.set(primary.length);
      return;
    }
    this.activeIdx.set(0);
  }

  private matches(url: string, n: NavItem): boolean {
    if (n.exact) return url === n.href;
    return url === n.href || url.startsWith(n.href + '/');
  }

  /** Snap the indicator to the active button's measured box. Animated
   *  by CSS once `--ready` is on (and the drag class is off). */
  private measureToActive(): void {
    if (this.dragging()) return;
    const btns = this.btns();
    const ref = btns[this.activeIdx()];
    if (!ref) return;
    const el = ref.nativeElement;
    this.indicator.set({ x: el.offsetLeft, w: el.offsetWidth, h: el.offsetHeight });
    if (!this.indicatorReady()) {
      requestAnimationFrame(() => this.indicatorReady.set(true));
    }
  }
}
