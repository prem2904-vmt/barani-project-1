import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy,
  computed, effect, inject, signal, viewChild, viewChildren
} from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { BranchLabConfigService } from '../../core/services/branch-lab-config.service';
import { PeopleDrawerService } from '../../core/services/people-drawer.service';
import { ThemeService } from '../../core/services/theme.service';
import { ADMIN_NAV, MORE_NAV, NavItem, PRIMARY_NAV, WorkflowNavCtx, menusFromWorkflow } from '../nav-items';
import { ProcessWorkflowService } from '../../core/services/process-workflow.service';

const DRAG_THRESHOLD_PX = 4;

@Component({
  selector: 'pf-bottom-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Floating pill — mobile + tablet. Desktop uses the top strip.
         Scrolls horizontally on narrow viewports so all nav items stay
         reachable without overflowing off-screen.
         The bottom inline style is a flat 8px — the pill hugs the
         screen bottom edge with no floating gap (per the user's
         "bring it to the bottom, no space" call). 8px keeps the icon
         tap-targets — vertically centred in the ~56px pill — clear of
         the iOS home-indicator gesture zone while the pill sits snug
         at the edge. -->
    <nav class="pf-bottom-nav xl:hidden fixed z-30"
         [class.pf-bottom-nav--rail]="railMode()">
      <div #pill
           class="pf-pill flex items-center gap-0.5 sm:gap-1 p-1 sm:p-1.5 shadow-2xl backdrop-blur-2xl"
           [class.pf-pill--rail]="railMode()"
           [class]="pillClasses"
           [class.pf-pill--dragging]="dragging()"
           (pointerdown)="onPillPointerDown($event)"
           (pointermove)="onPillPointerMove($event)"
           (pointerup)="onPillPointerUp($event)"
           (pointercancel)="onPillPointerUp($event)">
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
        <!-- Sliding indicator — horizontal-pill only. In rail mode the
             active state is a static highlight on the button itself
             (the indicator's offsetLeft/offsetWidth geometry doesn't
             translate to a vertical axis). -->
        @if (!railMode()) {
          <span class="pf-nav-indicator"
                [class.pf-nav-indicator--ready]="indicatorReady()"
                [class.pf-nav-indicator--dragging]="dragging()"
                [style.transform]="indicatorTransform()"
                [style.width.px]="indicatorRenderedW()"
                [style.height.px]="indicatorRenderedH()"
                aria-hidden="true"></span>
        }

        <!-- Rail brand mark — the PF glyph at the top of the rail.
             On iPad there's no top chrome, so the rail carries the
             brand. Icon-only (no "PREFRONTAL" wordmark). -->
        @if (railMode()) {
          <span class="pf-rail-brand" aria-label="Prefrontal">
            <svg viewBox="0 0 228 292" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <defs>
                <linearGradient id="pfRailBrandGradient" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%"   stop-color="#7c3aed" />
                  <stop offset="25%"  stop-color="#8b5cf6" />
                  <stop offset="50%"  stop-color="#a855f7" />
                  <stop offset="75%"  stop-color="#d946ef" />
                  <stop offset="100%" stop-color="#ec4899" />
                </linearGradient>
              </defs>
              <path d="M0 131.126V292H30.1634C29.572 247.788 28.744 156.113 30.1634 143.106C31.5829 130.099 40.2179 118.861 44.358 114.867C79.8444 80.639 117.696 104.599 132.187 120.857V81.4947C125.799 74.649 101.136 70.0852 89.6031 68.659C39.9222 63.1824 9.16731 108.022 0 131.126Z" fill="url(#pfRailBrandGradient)" />
              <path d="M99 204C76.2887 212.215 47.6109 193.023 38.1479 182.469V220.976C126.154 259.996 162.35 199.583 169.447 164.499H227.113V136.26L171.222 137.116V72.0819C177.609 35.1151 211.735 26.4439 228 26.7291V0.201972C161.463 -4.07659 142.833 60.9576 140.171 68.659C137.51 76.3604 141.058 161.932 136.623 172.2L136.585 172.287C132.16 182.532 127.31 193.76 99 204Z" fill="url(#pfRailBrandGradient)" />
            </svg>
          </span>
          <div class="pf-rail-sep" aria-hidden="true"></div>
        }

        @for (n of primary(); track n.id; let i = $index) {
          <!-- Buttons auto-scale to the visible-tab count. With many
               tabs (≥4) we stay icon-only on mobile to keep the pill
               compact; with few tabs (≤3) we always show the label
               on every viewport so a 2-button pill doesn't look like
               a tiny debug widget floating at the bottom. -->
          <button #navBtn type="button"
                  (click)="onTabClick(i, $event)"
                  class="pf-nav-btn press rounded-full flex items-center justify-center gap-1.5
                         shrink-0 text-[11px] font-semibold leading-none transition-colors"
                  [class.pf-nav-btn--compact]="compactMode()"
                  [class.pf-nav-btn--active]="activeIdx() === i">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                 @for(path of n.iconPath; track path) {
                  <path [attr.d]="path"/>
                 }
            </svg>
            <span class="pf-nav-btn__lbl">{{ n.label }}</span>
          </button>
        }

        @if (showAdminTab()) {
          <div class="w-px h-8 sm:h-10 mx-0.5 shrink-0" style="background: var(--border-muted);"></div>

          <!-- Admin = direct navigation to /admin (the categorised
               dashboard), not a popover. The old "More" sheet listed
               every admin page; that's now what the 2-panel /admin
               page itself shows, so the popover became redundant. -->
          <a #navBtn routerLink="/admin" routerLinkActive="pf-nav-btn--active"
             class="pf-nav-btn press rounded-full flex items-center justify-center gap-1.5
                    shrink-0 text-[11px] font-semibold leading-none transition-colors no-underline"
             [class.pf-nav-btn--compact]="compactMode()"
             aria-label="Admin">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.7l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.7-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.7.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.7 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.7.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.7-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.7V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>
            </svg>
            <span class="pf-nav-btn__lbl">Admin</span>
          </a>
        }

        <!-- Rail bottom group — the chrome's whole right-side cluster
             folds in here as distinct icons: vendor badge, notification
             bell, people drawer, then the user-avatar (More) button.
             margin-top:auto on the leading separator pushes the group
             to the bottom of the rail. -->
        @if (railMode()) {
          <div class="pf-rail-sep pf-rail-sep--foot" aria-hidden="true"></div>
          <span class="pf-rail-vendor" [title]="tenantName()">{{ tenantInitial() }}</span>
          <button type="button" class="pf-rail-action press"
                  (click)="onMoreNotifications()" aria-label="Notifications">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
            </svg>
          </button>
          @if (canMessages()) {
            <button type="button" class="pf-rail-action press"
                    (click)="onMorePeople()" aria-label="People">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </button>
          }
        }

        <!-- "More" trigger. Phone: PF glyph pill at the end of the row.
             iPad rail: the account/actions button at the bottom — its
             popover carries notifications, theme, people, sign-out. -->
        <button #navBtn type="button"
                class="pf-nav-btn press pf-nav-btn--more rounded-full flex items-center justify-center
                       shrink-0 transition-colors"
                [class.pf-nav-btn--compact]="compactMode()"
                [class.pf-nav-btn--more-on]="moreOpen()"
                (click)="toggleMore($event)"
                [attr.aria-label]="railMode() ? 'Account & more' : 'More'"
                [attr.aria-expanded]="moreOpen()">
          @if (railMode()) {
            <!-- iPad rail: the More button IS the user badge — the
                 chrome's profile avatar folds in here. Tapping opens
                 the account popover (notifications / people / theme /
                 sign-out). -->
            <span class="pf-rail-avatar">{{ userInitials() }}</span>
          } @else {
            <!-- Phone: PF brand glyph (the only branding on a phone). -->
            <svg class="pf-more-brand" viewBox="0 0 228 292" fill="none"
                 xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <defs>
                <linearGradient id="pfMoreBrandGradient" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%"   stop-color="#7c3aed" />
                  <stop offset="25%"  stop-color="#8b5cf6" />
                  <stop offset="50%"  stop-color="#a855f7" />
                  <stop offset="75%"  stop-color="#d946ef" />
                  <stop offset="100%" stop-color="#ec4899" />
                </linearGradient>
              </defs>
              <path
                d="M0 131.126V292H30.1634C29.572 247.788 28.744 156.113 30.1634 143.106C31.5829 130.099 40.2179 118.861 44.358 114.867C79.8444 80.639 117.696 104.599 132.187 120.857V81.4947C125.799 74.649 101.136 70.0852 89.6031 68.659C39.9222 63.1824 9.16731 108.022 0 131.126Z"
                fill="url(#pfMoreBrandGradient)" />
              <path
                d="M99 204C76.2887 212.215 47.6109 193.023 38.1479 182.469V220.976C126.154 259.996 162.35 199.583 169.447 164.499H227.113V136.26L171.222 137.116V72.0819C177.609 35.1151 211.735 26.4439 228 26.7291V0.201972C161.463 -4.07659 142.833 60.9576 140.171 68.659C137.51 76.3604 141.058 161.932 136.623 172.2L136.585 172.287C132.16 182.532 127.31 193.76 99 204Z"
                fill="url(#pfMoreBrandGradient)" />
            </svg>
          }
        </button>
      </div>

      <!-- More popover — opens upward from above the pill. Tap a
           backdrop or any item to close. -->
      @if (moreOpen()) {
        <div class="pf-more-bd" (click)="closeMore()"></div>
        <div class="pf-more-pop" role="menu" aria-label="More actions"
             (click)="$event.stopPropagation()">
          <!-- Notifications + People are standalone rail buttons in
               iPad rail mode, so the popover only lists them on phone
               (where the bottom pill has no room for extra icons). -->
          @if (!railMode()) {
            <button type="button" role="menuitem" class="pf-more-item press"
                    (click)="onMoreNotifications()">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
                <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
              </svg>
              <span>Notifications</span>
            </button>
            @if (canMessages()) {
              <button type="button" role="menuitem" class="pf-more-item press"
                      (click)="onMorePeople()">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                <span>People</span>
              </button>
            }
          }
          <!-- Theme: cycles System → Light → Dark. "System" follows the
               OS appearance live; Light/Dark pin an explicit choice. -->
          <button type="button" role="menuitem" class="pf-more-item press"
                  (click)="onMoreTheme()">
            @switch (theme.mode()) {
              @case ('system') {
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="2" y="3" width="20" height="14" rx="2"/>
                  <path d="M8 21h8M12 17v4"/>
                </svg>
              }
              @case ('light') {
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="4"/>
                  <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>
                </svg>
              }
              @default {
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/>
                </svg>
              }
            }
            <span>Theme</span>
            <span class="pf-more-item__val">
              {{ theme.mode() === 'system' ? 'System' : theme.mode() === 'light' ? 'Light' : 'Dark' }}
            </span>
          </button>
          <!-- Branch — tap to cycle through the lab's branches. The
               current branch shows in the trailing chip. -->
          <button type="button" role="menuitem" class="pf-more-item press"
                  (click)="onMoreBranch()">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
              <circle cx="12" cy="10" r="3"/>
            </svg>
            <span>Branch</span>
            <span class="pf-more-item__val">{{ currentBranch() }}</span>
          </button>
          <div class="pf-more-sep"></div>
          <button type="button" role="menuitem" class="pf-more-item pf-more-item--danger press"
                  (click)="onMoreLogout()">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <path d="M16 17l5-5-5-5"/>
              <path d="M21 12H9"/>
            </svg>
            <span>Sign out</span>
          </button>
        </div>
      }
    </nav>

    <!-- The mobile/iPad "More" sheet (formerly listed every admin
         page) has been removed. The Admin tab now navigates straight
         to /admin which already shows the same items in a richer
         2-panel layout — one destination instead of two competing
         menus. -->
  `,
  styles: [`
    /* Default (phone) — floating bottom pill, horizontally centred,
       8px above the screen edge. Positioning lives here in CSS now
       (was Tailwind utility classes) so rail mode can fully override. */
    .pf-bottom-nav {
      bottom: 8px;
      left: 50%;
      transform: translateX(-50%);
      max-width: calc(100vw - 16px);
    }

    /* ── Rail mode (iPad band, 641–1279px) — a full-height sidebar
       docked flush to the left edge. Runs top→bottom.
       top starts at the safe-area inset, NOT 0: a panel that ran
       edge-to-edge behind the status bar put its tinted glass +
       right-edge seam directly under the clock, which read as a
       messy rectangle around the status-bar text. Beginning the
       rail just below the clock keeps the status bar on the clean
       page background. ───────────────────────────────────────────── */
    .pf-bottom-nav--rail {
      left: 0;
      top: env(safe-area-inset-top, 0px);
      bottom: 0;
      transform: none;
      max-width: none;
    }

    /* The pill is the positioning context for the indicator + the
       pointer-event surface for the drag gesture. touch-action: pan-y
       reserves vertical scrolling for the page so horizontal swipes
       become our drag (we cancel them via preventDefault on move). */
    .pf-pill {
      position: relative;
      border-radius: 9999px;
      overflow-x: auto;
      touch-action: pan-y;
      user-select: none;
      -webkit-user-select: none;
      transition: box-shadow 200ms ease;
    }
    /* Rail pill — a full-height vertical column. The rail container
       already starts at the safe-area inset, so the pill's own
       padding-top is a plain 10px (no safe-area term — that would
       double-count and shove the brand glyph too far down). The
       More button is pushed to the bottom with margin-top:auto. */
    .pf-pill--rail {
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      height: 100%;
      width: 64px;
      /* Square — a full-height edge-docked sidebar reads as a clean
         rectangle (Slack / VS Code style). Rounded corners on a
         flush full-bleed panel just get clipped by the screen edge. */
      border-radius: 0;
      overflow-x: visible;
      overflow-y: auto;
      gap: 3px;
      padding: 10px 8px 12px;
      touch-action: auto;
      scrollbar-width: none;
    }
    .pf-pill--rail::-webkit-scrollbar { display: none; }

    /* ── Rail brand mark (top) — the PF glyph, icon-only. ────────── */
    .pf-rail-brand {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 38px;
      height: 38px;
      flex-shrink: 0;
    }
    .pf-rail-brand svg { width: 24px; height: 30px; }

    /* Hairline separators between the rail's three zones. */
    .pf-rail-sep {
      width: 28px;
      height: 1px;
      flex-shrink: 0;
      background: var(--glass-border, rgba(255, 255, 255, 0.1));
      margin: 2px 0;
    }
    /* The footer separator carries margin-top:auto, pushing the
       vendor badge + More button to the bottom of the rail. */
    .pf-rail-sep--foot { margin-top: auto; }

    /* ── Rail vendor badge (bottom) — the tenant logo, just the
       initial. Folds in the chrome's "W Micro World" pill. ───────── */
    .pf-rail-vendor {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      flex-shrink: 0;
      border-radius: 10px;
      background: var(--gradient-primary);
      color: #fff;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.01em;
      box-shadow: 0 4px 12px rgba(124, 58, 237, 0.36);
    }

    /* ── Rail action buttons (notification bell, people) — distinct
       icon buttons in the rail bottom group, mirroring the chrome's
       right-side icon cluster. ──────────────────────────────────── */
    .pf-rail-action {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      flex-shrink: 0;
      border: 0;
      border-radius: 11px;
      background: transparent;
      color: var(--text-secondary, #cbd5e1);
      cursor: pointer;
      transition: background 0.14s, color 0.14s;
    }
    .pf-rail-action:hover {
      background: rgba(255, 255, 255, 0.06);
      color: var(--text-primary, #f1f5f9);
    }

    /* ── Rail user avatar — the More button's content in rail mode.
       Folds in the chrome's profile badge; its popover holds
       notifications / people / theme / sign-out. ────────────────── */
    .pf-rail-avatar {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border-radius: 9999px;
      background: linear-gradient(135deg, #6366f1, #a855f7);
      color: #fff;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.02em;
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
    }
    .pf-nav-btn--more-on .pf-rail-avatar {
      box-shadow: 0 0 0 2px var(--color-violet-400, #a78bfa);
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
      touch-action: pan-y;
      /* Default (label-visible) sizing — used when there are few
         tabs so the pill never looks like a sad widget. The icon +
         text sit side-by-side; height stays a pill-friendly 44px. */
      height: 44px;
      padding: 0 16px;
      min-width: 88px;
    }
    /* Compact mode — applied when there are 4+ visible items. Icon
       only on mobile, icon+label from sm:up. Matches the original
       look when the bar is dense. */
    .pf-nav-btn--compact {
      width: 44px; min-width: 44px;
      padding: 0;
      flex-direction: column;
      gap: 2px;
      font-size: 10px;
    }
    .pf-nav-btn--compact .pf-nav-btn__lbl { display: none; }
    @media (min-width: 640px) {
      .pf-nav-btn { height: 56px; min-width: 110px; padding: 0 18px; }
      .pf-nav-btn--compact { width: 64px; min-width: 64px; padding: 0; }
      .pf-nav-btn--compact .pf-nav-btn__lbl { display: inline; }
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

    /* ── Rail-mode buttons — icon-only, compact. The sliding indicator
       is absent in rail mode, so the active button carries its own
       gradient highlight. ───────────────────────────────────────── */
    .pf-pill--rail .pf-nav-btn {
      width: 44px;
      min-width: 44px;
      height: 42px;
      padding: 0;
      border-radius: 12px;
    }
    /* Icon-only — hide the label entirely in the rail. */
    .pf-pill--rail .pf-nav-btn .pf-nav-btn__lbl {
      display: none !important;
    }
    .pf-pill--rail .pf-nav-btn--active {
      background: var(--gradient-primary);
      color: #fff;
      box-shadow: 0 6px 16px rgba(124, 58, 237, 0.4);
    }
    .pf-pill--rail .pf-nav-btn:not(.pf-nav-btn--active):hover {
      background: rgba(255, 255, 255, 0.06);
    }
    /* The More (avatar) button matches the icon-only button size. */
    .pf-pill--rail .pf-nav-btn--more {
      width: 44px;
      min-width: 44px;
      height: 42px;
    }
    /* Admin divider — a horizontal hairline in the vertical rail. */
    .pf-pill--rail > div[style*="background"] {
      width: 80% !important;
      height: 1px !important;
      margin: 4px auto !important;
    }
    /* In rail mode the More popover opens to the RIGHT of the rail,
       anchored near its bottom (where the More button sits). */
    .pf-bottom-nav--rail .pf-more-pop {
      bottom: 8px;
      top: auto;
      left: calc(100% + 10px);
      right: auto;
      transform-origin: left bottom;
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

    /* ── More button (PF glyph at end of pill) + popover ──────────── */
    /* The More button shows on phone (bottom pill, PF glyph) AND iPad
       (rail, user avatar — opens the account popover with branch /
       theme / sign-out). Desktop hides the whole nav via xl:hidden,
       so no per-button hide rule is needed.
       NOTE: an earlier @media(min-width:641px){display:none} rule
       used to hide this — it was from when iPad still had the top
       chrome. The chrome is gone on iPad now, so the rule was
       removed; it was what made the avatar + branch "disappear". */
    .pf-nav-btn--more {
      width: 44px; min-width: 44px;
      height: 44px;
      padding: 0;
      background: transparent;
    }
    /* The brand glyph is gradient-filled (matches the top-strip's
       chrome logo), so we don't tint it via the color property; only
       scale on hover/active to acknowledge the tap. */
    .pf-more-brand {
      width: 22px;
      height: 28px;
      transition: transform 180ms ease, filter 180ms ease;
    }
    .pf-nav-btn--more:hover .pf-more-brand,
    .pf-nav-btn--more-on .pf-more-brand {
      transform: scale(1.08);
      filter: drop-shadow(0 2px 6px rgba(168, 85, 247, 0.45));
    }

    /* Backdrop covers the screen so taps outside dismiss the menu.
       z-index sits just below the popover (29) and just above the
       page content (1). The pill itself stays interactive via its
       own higher z-index inside .pf-bottom-nav. */
    .pf-more-bd {
      position: fixed;
      inset: 0;
      background: transparent;
      z-index: 29;
    }

    /* The popover floats ABOVE the pill (bottom: 100% + 12px). */
    .pf-more-pop {
      position: absolute;
      bottom: calc(100% + 10px);
      right: 4px;
      min-width: 220px;
      padding: 6px;
      border-radius: 14px;
      background: var(--bg-card-solid, rgba(15, 15, 25, 0.96));
      border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.1));
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(20px) saturate(160%);
      -webkit-backdrop-filter: blur(20px) saturate(160%);
      z-index: 31;
      display: flex; flex-direction: column; gap: 2px;
      animation: pf-more-in 180ms cubic-bezier(0.32, 0.72, 0, 1);
      transform-origin: bottom right;
    }
    @keyframes pf-more-in {
      from { opacity: 0; transform: translateY(6px) scale(0.97); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    /* Replace any older .pf-more-item styles with popover-row visuals. */
    .pf-more-pop .pf-more-item {
      all: unset;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border-radius: 10px;
      font-size: 14px;
      color: var(--text-primary, #f1f5f9);
      cursor: pointer;
      background: transparent !important;
      border: 0 !important;
      transition: background 0.12s ease, color 0.12s ease;
    }
    .pf-more-pop .pf-more-item:hover {
      background: var(--bg-hover, rgba(255, 255, 255, 0.06)) !important;
    }
    .pf-more-pop .pf-more-item svg {
      flex-shrink: 0;
      color: var(--text-tertiary, rgba(148, 163, 184, 0.7));
    }
    .pf-more-pop .pf-more-item:hover svg {
      color: var(--color-violet-300, #c4b5fd);
    }
    .pf-more-pop .pf-more-item--danger {
      color: #fca5a5;
    }
    .pf-more-pop .pf-more-item--danger:hover {
      background: rgba(239, 68, 68, 0.12) !important;
      color: #fecaca;
    }
    .pf-more-pop .pf-more-item--danger svg { color: #fca5a5; }
    /* Trailing value chip — e.g. the current theme mode on the Theme
       row. Pushed to the right edge of the menu item. */
    .pf-more-pop .pf-more-item__val {
      margin-left: auto;
      font-size: 12px;
      font-weight: 600;
      color: var(--color-violet-300, #c4b5fd);
      padding: 2px 8px;
      border-radius: 999px;
      background: rgba(168, 85, 247, 0.14);
    }
    .pf-more-sep {
      height: 1px;
      background: var(--glass-border, rgba(255, 255, 255, 0.08));
      margin: 4px 8px;
    }
  `]
})
export class BottomNavComponent implements AfterViewInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly labCfg = inject(BranchLabConfigService);
  private readonly router = inject(Router);
  /** Theme + people drawer are now reachable from the bottom-nav More
   *  popover instead of the top chrome (which is hidden on mobile). */
  protected readonly theme = inject(ThemeService);
  protected readonly peopleDrawer = inject(PeopleDrawerService);

  private readonly btns = viewChildren<ElementRef<HTMLElement>>('navBtn');
  private readonly pillRef = viewChild<ElementRef<HTMLElement>>('pill');

  protected readonly moreOpen = signal(false);

  /** Rail mode — on the iPad band (641–1279px) the nav docks as a
   *  vertical rail on the left edge instead of a floating bottom pill.
   *  Phones (≤640px) keep the bottom pill; desktop (≥1280px) hides the
   *  whole component (xl:hidden) and uses the top-strip nav. */
  protected readonly railMode = signal<boolean>(this.computeRailMode());
  private computeRailMode(): boolean {
    if (typeof window === 'undefined') return false;
    const w = window.innerWidth;
    return w >= 641 && w < 1280;
  }

  /** Tenant (vendor) name + a 1-letter badge for the rail bottom. The
   *  chrome's vendor pill folds into the rail as just this badge. */
  protected readonly tenantName = computed(() => this.auth.user()?.tenantName ?? '');
  protected readonly tenantInitial = computed(() => {
    const n = this.tenantName().trim();
    return n ? n[0].toUpperCase() : 'P';
  });

  /** Current user's initials — the rail's More button renders the user
   *  avatar (the chrome's profile badge folds in here); tapping it opens
   *  the account popover (notifications / people / theme / sign-out). */
  protected readonly userInitials = computed(() => {
    const u = this.auth.user();
    const name = (u?.displayName || u?.firstName || '').trim();
    if (!name) return 'U';
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  });

  /** Branch switcher — the chrome's branch picker folds into the
   *  account popover. NOTE: this is a UI-only switch, mirroring the
   *  top-strip's existing mocked branch list (no backend re-scope
   *  yet). Tapping the Branch row cycles to the next branch. */
  protected readonly branches = ['Chennai Main', 'Anna Nagar', 'T. Nagar', 'OMR'];
  private readonly _branch = signal<string>(this.auth.user()?.branchName ?? 'Chennai Main');
  protected readonly currentBranch = this._branch.asReadonly();
  protected onMoreBranch(): void {
    const list = this.branches;
    const i = list.indexOf(this._branch());
    this._branch.set(list[(i + 1) % list.length]);
  }

  // ─── More popover handlers ────────────────────────────────────────
  protected toggleMore(ev?: Event): void {
    ev?.stopPropagation?.();
    this.moreOpen.update(v => !v);
  }
  protected closeMore(): void { this.moreOpen.set(false); }

  protected onMoreNotifications(): void {
    this.closeMore();
    // Notifications live at /notifications when that route exists;
    // until then we route to /admin which surfaces them via the bell.
    // Fall back to opening the people drawer as a placeholder.
    void this.router.navigateByUrl('/notifications').catch(() => undefined);
  }
  protected onMorePeople(): void {
    this.closeMore();
    this.peopleDrawer.open.set(true);
  }
  protected onMoreTheme(): void {
    // Cycle System → Light → Dark → System. "System" follows the OS
    // appearance live; Light/Dark pin an explicit choice. The popover
    // stays open so the user can keep tapping to land on the mode
    // they want and see each one preview.
    const next: Record<string, 'system' | 'light' | 'dark'> = {
      system: 'light', light: 'dark', dark: 'system'
    };
    this.theme.setMode(next[this.theme.mode()]);
  }
  protected onMoreLogout(): void {
    this.closeMore();
    void this.auth.signOut().then(() => this.router.navigateByUrl('/login'));
  }

  /** Tap outside the popover closes it. The transparent .pf-more-bd
   *  div catches most taps; this listener catches anything else. */
  @HostListener('document:click', ['$event'])
  onDocClick(_ev: MouseEvent): void {
    if (!this.moreOpen()) return;
    // The popover is responsible for stopPropagation on inside clicks,
    // so any click that bubbles to document means "outside" → close.
    this.moreOpen.set(false);
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
    this.process.loadActive();

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

    this.resizeListener = () => {
      this.railMode.set(this.computeRailMode());
      this.measureToActive();
    };
    window.addEventListener('resize', this.resizeListener);
  }

  ngOnDestroy(): void {
    this.routerSub?.unsubscribe();
    if (this.resizeListener) window.removeEventListener('resize', this.resizeListener);
  }

  // ─── Visible nav lists ───────────────────────────────────────────
  private readonly process = inject(ProcessWorkflowService);
  /** People (contacts + chat + calls) is part of the Messages capability —
   *  hide its rail/menu button when the Messages work-area is disabled. */
  readonly canMessages = computed(() => this.process.isEnabled('messages'));
  private readonly visible = (items: NavItem[]): NavItem[] => {
    const cMode = this.labCfg.collectionMode();
    const bMode = this.labCfg.billingMode();
    return items.filter(i => {
      if (i.permissions?.length && !this.auth.hasAnyPermission(i.permissions)) return false;
      if (i.collectionModes && !i.collectionModes.includes(cMode)) return false;
      if (i.billingModes && !i.billingModes.includes(bMode)) return false;
      // Inventory work area only appears when the branch has it enabled.
      if (i.requiresInventory && !this.labCfg.inventoryEnabled()) return false;
      // Hide a nav item whose action is switched off in /admin/process.
      if (i.action && !this.process.isEnabled(i.action)) return false;
      return true;
    });
  };

  private navCtx(): WorkflowNavCtx {
    return {
      roles: this.auth.user()?.roles ?? [],
      hasAnyPermission: (p) => this.auth.hasAnyPermission(p),
      isSuper: this.auth.permissions().includes('*'),
    };
  }
  // Live nav = the active workflow's work-areas (admin names + order, role-gated),
  // each opening its real screen; falls back to PRIMARY_NAV when none is active.
  readonly primary = computed(() => this.withInventory(menusFromWorkflow(this.process.active(), this.navCtx()) ?? this.visible(PRIMARY_NAV)));

  /** Workflow-derived nav has no Stores work area; append it when inventory is
   *  enabled and the user can use it (idempotent vs the PRIMARY_NAV fallback). */
  private withInventory(items: NavItem[]): NavItem[] {
    if (!this.labCfg.inventoryEnabled()) return items;
    if (items.some(i => i.id === 'stores' || i.href === '/stores')) return items;
    const inv = PRIMARY_NAV.find(i => i.id === 'stores');
    if (!inv || !this.auth.hasAnyPermission(inv.permissions ?? [])) return items;
    return [...items, inv];
  }
  /** More-popover items. On mobile/iPad the desktop top-strip is
   *  hidden (`xl:flex`), so the new top-strip Admin icon isn't
   *  reachable there. We prepend ADMIN_NAV into More so admins on
   *  tablet/phone still have one tap to /admin. The permission
   *  filter (`visible`) already gates it for non-admins. */
  readonly more = computed(() => this.visible([ADMIN_NAV, ...MORE_NAV]));
  /** The Admin tab on the floating pill renders only when the user
   *  has at least one manage_* permission (i.e. ADMIN_NAV would
   *  appear in their visible list). Non-admin users see only their
   *  workflow tabs and no admin tab at all. */
  readonly showAdminTab = computed(() =>
    !ADMIN_NAV.permissions || this.auth.hasAnyPermission(ADMIN_NAV.permissions)
  );

  /** Compact (icon-only on mobile) when 4+ buttons are visible. With
   *  fewer the bar would otherwise look like a tiny floating widget;
   *  showing labels at low counts gives each button room to breathe. */
  readonly compactMode = computed(() => {
    const total = this.primary().length + (this.showAdminTab() ? 1 : 0);
    return total >= 4;
  });

  get pillClasses(): string {
    return 'bg-[var(--header-bg)] border border-[var(--header-border)]';
  }

  // (Old single-line toggleMore/closeMore removed — the new versions
  // earlier in the class take an event arg and add stopPropagation.)

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
    // No drag gesture in rail mode — the rail is a static vertical
    // dock; horizontal-drag geometry doesn't apply.
    if (this.railMode()) return;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
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
