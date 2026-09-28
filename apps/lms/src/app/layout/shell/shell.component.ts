import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from "@angular/core";
import {
  NavigationEnd,
  Router,
  RouterOutlet,
} from "@angular/router";
import { filter } from "rxjs/operators";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { ToastService } from "../../core/services/toast.service";
import { AmbientBgComponent } from "../../shared/components/ambient-bg/ambient-bg.component";
import { DialogHostComponent } from "../../shared/components/dialog-host/dialog-host.component";
import { BottomNavComponent } from "../bottom-nav/bottom-nav.component";
import { TopStripComponent } from "../top-strip/top-strip.component";
import { ThemeService } from "../../core/services/theme.service";
import { PatientProfileModalComponent } from "../../shared/components/patient-profile-modal/patient-profile-modal.component";
import { CallOverlayComponent } from "../../shared/components/call-overlay/call-overlay.component";
import { PeopleDrawerComponent } from "../../shared/components/people-drawer/people-drawer.component";
import { ChatWindowsComponent } from "../../shared/components/chat-windows/chat-windows.component";
import { ChatPopupsComponent } from "../../shared/components/chat-popups/chat-popups.component";
import { SignalingService } from "../../core/services/signaling.service";
import { WorkEventsService } from '../../core/services/work-events.service';
import { ChatService } from "../../core/services/chat.service";
import { ChatNotifyService } from "../../core/services/chat-notify.service";
import { PlatformService } from "../../core/services/platform.service";
import { TenantEntitlementsService } from "../../core/services/tenant-entitlements.service";
// Touching WebrtcService here ensures its signaling subscriptions wire up
// on first shell render (it's @Injectable providedIn root, so the inject()
// pull below boots it lazily without ever being read).
import { WebrtcService } from "../../core/services/webrtc.service";
import { AuthService } from "../../core/auth/auth.service";
import { ScanService } from "../../core/services/scan.service";
import { KeyboardService } from "../../core/services/keyboard.service";
import { ApiService } from "../../core/services/api.service";
import { CapacitorService } from "../../core/services/capacitor.service";
import { BarcodeScannerModalComponent } from "../../shared/components/barcode-scanner/barcode-scanner-modal.component";
import { DesignModeBadgeComponent } from "../../shared/components/design-mode-badge/design-mode-badge.component";
import { DesignModeService } from "../../core/services/design-mode.service";
import { PatientTimelineComponent } from "../../features/frontdesk/patient-profile/patient-timeline.component";
import { PatientTimelineService } from "../../features/frontdesk/patient-profile/patient-timeline.service";
import { SwipeBackDirective } from "../../core/directives/swipe-back.directive";
import { BranchSwitchService } from "../../core/services/branch-switch.service";
import { BranchVeilComponent } from "../../shared/components/branch-veil/branch-veil.component";

@Component({
  selector: "pf-shell",
  standalone: true,
  imports: [
    RouterOutlet,
    TopStripComponent,
    BottomNavComponent,
    DialogHostComponent,
    AmbientBgComponent,
    PatientProfileModalComponent,
    CallOverlayComponent,
    PeopleDrawerComponent,
    ChatWindowsComponent,
    ChatPopupsComponent,
    BarcodeScannerModalComponent,
    PatientTimelineComponent,
    SwipeBackDirective,
    DesignModeBadgeComponent,
    BranchVeilComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Flowing ambient background: DNA gradients + drifting pulse/helix/glyphs. -->
    <pf-ambient-bg></pf-ambient-bg>

    <!-- Everything above sits in a stacking context on top of the ambient. -->
    <div class="shell-stack">
      <!-- Offline banner — slim fixed strip pinned to the very top of the
           viewport (above the chrome AND on phones/native where the chrome
           is hidden). Driven by CapacitorService.isOnline: the Network
           plugin on native, window online/offline events on web. -->
      @if (capacitor.initialised() && !capacitor.isOnline()) {
        <div class="pf-offline-banner" role="status" aria-live="polite">
          <span class="pf-offline-banner__dot" aria-hidden="true"></span>
          <span>No connection — changes won't save until you're back online</span>
        </div>
      }

      <!-- Unified chrome card: single navbar row. Tenant + branch
           moved into the top-strip's right cluster; second row removed. -->
      <div class="pf-chrome" [class.pf-chrome--kbd]="kbd.visible()">
        <pf-top-strip></pf-top-strip>
      </div>

      <main class="shell-main relative" pfSwipeBack data-pf-keys-host [class.shell-main--kbd]="kbd.visible()"
            [attr.data-bs]="branchSwitch.busy() ? branchSwitch.phase() : null"
            [attr.aria-busy]="branchSwitch.veil() ? 'true' : null">
        <!-- Auto breadcrumb — appears on every page that isn't itself
             a top-level landing (Admin/Frontdesk/Lab/Results/etc.).
             Label switches to the matching section so admin sub-pages
             read "← Admin", frontdesk sub-pages "← Frontdesk", etc.
             Covers off-/admin/* targets too — TAT lives at /dashboard,
             Setup wizard at /setup, but both are reached from the
             Admin grid so they get "← Admin". -->
        <!--  @if (backLink(); as back) {
          <a [routerLink]="back.href" class="pf-back-chip press">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6"/>
            </svg>
            Back
          </a>
        } -->
        <router-outlet></router-outlet>
        <!-- Branch switch (BranchSwitchService): the destination skeleton
             rises over the receding screen, holds while the new branch's
             data loads, then lifts as the new screen zooms up. -->
        @if (branchSwitch.busy()) { <pf-branch-veil></pf-branch-veil> }
      </main>
      <p class="sr-only" role="status" aria-live="polite">{{ branchSwitch.announcement() }}</p>

      <pf-bottom-nav></pf-bottom-nav>

      <!-- Themed prompt / confirm overlay (replaces window.prompt/confirm). -->
      <pf-dialog-host></pf-dialog-host>

      <!-- Chat/calls only exist when the Messages module is in the plan. Gate
           the overlay + people drawer so a disabled tenant has no trace. -->
      @if (messagesEnabled()) {
        <!-- Global voice-consult overlay: incoming ringer + active-call pill. -->
        <pf-call-overlay></pf-call-overlay>

        <!-- Tenant people drawer: contacts + 1:1 chat + call entry. -->
        <pf-people-drawer></pf-people-drawer>

        <!-- Messenger-style floating chat windows (new design, >=768px).
             Phones/classic keep the drawer above as the chat surface. -->
        <pf-chat-windows></pf-chat-windows>
        <!-- "New message" pop-ups (bottom-right web, top on phones). -->
        <pf-chat-popups></pf-chat-popups>
      }

      <!-- Patient profile modal — globally available; opens via
           PatientProfileService.open(patientId) from anywhere. -->
      <pf-patient-profile-modal></pf-patient-profile-modal>

      <!-- Design mode (designer capture prep) — badge lives at shell root so
           it floats over every screen while the mode is on. -->
      @if (designMode.enabled()) {
        <pf-design-mode-badge></pf-design-mode-badge>
      }

      <!-- Full-screen Patient Timeline — rendered at shell root so it covers the
           nav. A fixed element nested inside .shell-main is trapped below the
           chrome's stacking context and can't overlay it. -->
      @if (patientTimeline.isOpen() && patientTimeline.patientId(); as pid) {
        <pf-patient-timeline [patientId]="pid" (close)="patientTimeline.close()"></pf-patient-timeline>
      }

      <!-- Global order-QR scanner. Rendered HERE (shell root), not in the
           top-strip: the top-strip sits inside .pf-chrome whose backdrop-filter
           becomes the containing block for position:fixed, which squashed the
           modal into the navbar. At root it overlays the full viewport.
           @defer keeps the @zxing reader out of the eager shell bundle. -->
      @if (scan.scanning()) {
        @defer (on immediate) {
          <pf-barcode-scanner-modal title="Scan order QR"
                                    (matched)="onScanOrder($event)"
                                    (cancelled)="scan.close()"></pf-barcode-scanner-modal>
        }
      }



      <!-- Toasts — anchored top-right so they don't fight the floating
           bottom-nav pill or sit on top of action buttons (Next, Submit)
           which usually live at the bottom of the page. -->
      <div
        class="pf-toasts pointer-events-none fixed top-20 right-4 flex flex-col gap-3 z-[60] sm:top-24 md:top-auto md:right-auto md:bottom-8 md:left-1/2 md:-translate-x-1/2 md:items-center"
      >
        @for (t of toasts.toasts(); track t.id) {
          <div
            class="pointer-events-auto toast-item flex items-center w-full max-w-xs p-4 rounded-lg shadow-lg"
            role="alert"
          >
            <!-- Icon badge -->
            <div
              class="toast-icon inline-flex items-center justify-center flex-shrink-0 w-8 h-8 rounded-lg"
              [attr.data-level]="t.level"
            >
              @switch (t.level) {
                @case ("success") {
                  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      d="M10 .5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 10 .5Zm3.707 8.207-4 4a1 1 0 0 1-1.414 0l-2-2a1 1 0 0 1 1.414-1.414L9 10.586l3.293-3.293a1 1 0 0 1 1.414 1.414Z"
                    />
                  </svg>
                }
                @case ("error") {
                  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      d="M10 .5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 10 .5Zm3.707 11.793a1 1 0 1 1-1.414 1.414L10 11.414l-2.293 2.293a1 1 0 0 1-1.414-1.414L8.586 10 6.293 7.707a1 1 0 0 1 1.414-1.414L10 8.586l2.293-2.293a1 1 0 0 1 1.414 1.414L11.414 10l2.293 2.293Z"
                    />
                  </svg>
                }
                @case ("warning") {
                  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      d="M10 .5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 10 .5ZM10 15a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm1-4a1 1 0 0 1-2 0V6a1 1 0 0 1 2 0v5Z"
                    />
                  </svg>
                }
                @default {
                  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      d="M10 .5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 10 .5ZM10 15a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm1-4a1 1 0 0 1-2 0V6a1 1 0 0 1 2 0v5Z"
                    />
                  </svg>
                }
              }
            </div>

            <!-- Message -->
            <div class="ms-3 text-sm font-normal toast-msg">
              {{ t.message }}
            </div>

            <!-- Close -->
            <button
              type="button"
              class="toast-close ms-auto -mx-1.5 -my-1.5 inline-flex items-center justify-center h-8 w-8 rounded-lg p-1.5"
              (click)="toasts.dismiss(t.id)"
              aria-label="Close"
            >
              <svg class="w-3 h-3" fill="none" viewBox="0 0 14 14">
                <path
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="m1 1 6 6m0 0 6 6M7 7l6-6M7 7l-6 6"
                />
              </svg>
            </button>
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
    @use '../../shared/styles/device-tier' as dt;
      .shell-stack {
        position: relative;
        z-index: 1;
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      /* ── Offline banner ── slim glass strip fixed to the top of the
         viewport. position:fixed (not in-flow) so it never pushes the
         chrome or page content around when connectivity flaps. The
         banner carries its own env(safe-area-inset-top) padding: fixed
         elements anchor to the viewport, above the body's global
         safe-area padding, so it must clear the notch itself. */
      .pf-offline-banner {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 70; /* above toasts (60) — connectivity trumps everything */
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: calc(env(safe-area-inset-top, 0px) + 6px) 16px 6px;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.01em;
        color: #fecaca;
        background: rgba(127, 29, 29, 0.55);
        border-bottom: 1px solid rgba(248, 113, 113, 0.35);
        backdrop-filter: blur(16px) saturate(140%);
        -webkit-backdrop-filter: blur(16px) saturate(140%);
      }
      .pf-offline-banner__dot {
        width: 7px;
        height: 7px;
        border-radius: 9999px;
        flex-shrink: 0;
        background: #f87171;
        box-shadow: 0 0 8px rgba(248, 113, 113, 0.8);
        animation: pf-offline-pulse 1.6s ease-in-out infinite;
      }
      @keyframes pf-offline-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.35; }
      }
      @media (prefers-reduced-motion: reduce) {
        .pf-offline-banner__dot { animation: none; }
      }

      /* Chrome card — the single navbar row sits inside this floating
     * rounded container. Sticky so it stays at the top as content
     * scrolls below it. NOTE: no overflow:hidden — the navbar's
     * dropdown popovers (branch picker, profile menu, more) need to
     * escape the card. The card's rounded corners still clip via the
     * border-radius itself; only inner backgrounds with sharp edges
     * would notice, and there are none. */
      .pf-chrome {
        position: sticky;
        /* CLASSIC design (base): the floating glass pill. The body element
           in styles.scss already absorbs env(safe-area-inset-top) globally
           for Capacitor's full-bleed WebView, so no extra offset here. */
        top: 8px;
        z-index: 40;
        flex-shrink: 0;
        margin: 4px 16px 0;
        border-radius: 24px;
        background: var(--header-bg);
        border: 1px solid var(--header-border);
        backdrop-filter: blur(24px);
        -webkit-backdrop-filter: blur(24px);
      }
      /* ── Bottom-navbar EXPERIMENT (desktop, new design, opt-in via
         avatar menu → "Bottom bar"): the REAL top bar — brand, pages,
         branch, bell, avatar — docks to the bottom edge instead. ── */
      :host-context(.design-new.nav-bottom) .pf-chrome {
        position: fixed;
        left: 0; right: 0; bottom: 0; top: auto;
        border-top: 1px solid var(--header-border);
        border-bottom: none;
      }
      /* Content clears the docked bar; the band now starts at the very top. */
      :host-context(.design-new.nav-bottom) .shell-main {
        padding-bottom: calc(var(--pf-botbar-h, 57px) + 12px) !important;
      }

      /* NEW design (Figma 446-113): a FLUSH full-width bar — no
         floating-pill margin, radius, or gap; content (the hero band)
         sits directly against its bottom edge. */
      :host-context(.design-new) .pf-chrome {
        top: 0;
        margin: 0;
        border-radius: 0;
        border: none;
        border-bottom: 1px solid var(--header-border);
      }

      /* Phone + iPad (≤1279px): drop the top chrome entirely.
         • Phone uses the floating bottom pill.
         • iPad uses a full-height left nav rail — having a top chrome
           AND a side rail is redundant, so the rail owns navigation
           and its More popover owns the user-actions (notifications,
           people, theme, logout) that used to live in the chrome.
         Desktop (≥1280px) keeps the chrome + its top-strip nav.
         The body already absorbs env(safe-area-inset-top), so pages
         start at the top of the safe area with no double-padding. */
      @include dt.tablet-tier {
        .pf-chrome { display: none !important; }
      }

      /* Native (Capacitor) is always a touch device — never show the desktop
         top-strip, even on a wide iPad Pro (1366pt ≥ 1280). The bottom-nav
         rail owns navigation at every native width. Web/Electron desktop is
         unaffected (this is scoped to html.cap-native). */
      :host-context(html.cap-native) .pf-chrome { display: none !important; }
      @media (min-width: 641px) {
        :host-context(html.cap-native) .shell-main {
          padding-left: 64px;   /* clear the full-height left rail */
          padding-bottom: 16px; /* slim gap; no bottom pill on tablet */
        }
      }

      /* ── Branch switch motion (BranchSwitchService) ─────────────────
         out: the screen recedes and dims under the rising veil; loading:
         the re-created screen waits unseen; in: it zooms up into place.
         The routed page host is not in this component's view, hence
         ::ng-deep (scoped to <main data-bs> only while a switch runs). */
      .shell-main[data-bs] { overflow: hidden; }
      .shell-main[data-bs] ::ng-deep > :not(router-outlet):not(pf-branch-veil) {
        transform-origin: 50% var(--pf-bs-top, 0px);
        transition: transform 280ms cubic-bezier(0.32, 0.72, 0, 1), opacity 280ms cubic-bezier(0.32, 0.72, 0, 1), filter 280ms ease;
      }
      .shell-main[data-bs='out'] ::ng-deep > :not(router-outlet):not(pf-branch-veil) {
        transform: scale(0.965); opacity: 0.35; filter: saturate(0.7);
      }
      .shell-main[data-bs='loading'] ::ng-deep > :not(router-outlet):not(pf-branch-veil) {
        opacity: 0; transition: none;
      }
      .shell-main[data-bs='in'] ::ng-deep > :not(router-outlet):not(pf-branch-veil) {
        animation: pf-bs-zoom-in 420ms cubic-bezier(0.32, 0.72, 0, 1) both;
      }
      pf-branch-veil { top: var(--pf-bs-top, 0px); bottom: auto; height: var(--pf-bs-h, 100%); }
      @keyframes pf-bs-zoom-in {
        from { opacity: 0; transform: scale(0.97); }
        to { opacity: 1; transform: none; }
      }
      @keyframes pf-bs-fade-in { from { opacity: 0; } to { opacity: 1; } }
      @media (prefers-reduced-motion: reduce) {
        .shell-main[data-bs] ::ng-deep > :not(router-outlet):not(pf-branch-veil) { transition: opacity 120ms linear; transform: none !important; filter: none !important; }
        .shell-main[data-bs='in'] ::ng-deep > :not(router-outlet):not(pf-branch-veil) { animation: pf-bs-fade-in 120ms linear both; }
      }
      .sr-only {
        position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
        overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
      }

      .shell-main {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        padding-bottom: var(--tab-nav-total-height, 0px);
      }
      /* Soft keyboard up → the floating nav is hidden, so its reserved space
         must collapse or it leaves a gap between content and the keyboard. */
      .shell-main--kbd { padding-bottom: 0 !important; }
      /* WhatsApp-style immersive chat thread (phone): the bottom-nav is hidden
         in-thread, so shell-main drops its nav-clearance padding and the
         composer reaches the true bottom — flush above the keyboard, and just
         the home-indicator inset above the screen edge when idle. */
      :host-context(html.pf-chat-immersive) .shell-main { padding-bottom: 0 !important; }

      /* Immersive sample-collection: while a patient's collection drawer is OPEN
         (tube-tapping view) the screen owns the whole viewport — hide the desktop
         top chrome and drop the main's bottom-nav clearance. The queue list (drawer
         closed) keeps the normal chrome. Toggled by SampleCollectionComponent via
         html.pf-collect-immersive; bottom-nav hides itself in its own stylesheet. */
      :host-context(html.pf-collect-immersive) .pf-chrome { display: none !important; }
      :host-context(html.pf-collect-immersive) .shell-main { padding-bottom: 0 !important; }

      /* iPad band (641–1279px): the bottom-nav docks as a vertical
         icon-only rail on the left edge (see bottom-nav.component).
         • padding-left clears the ~60px rail + its 8px margin.
         • padding-bottom is a slim 16px — NOT the ~100px the bottom
           pill needed (no pill on iPad → that was dead space), but
           not 0 either: a flush-to-edge content area made the
           frontdesk panes' bottom border sit on the literal screen
           edge and read as "cut off". 16px gives the border a clear
           gap so the panes visibly end within the screen. */
      @include dt.tablet-band {
        .shell-main {
          /* Clear the 64px full-height left rail. Each routed page
             keeps its own Tailwind lg:px-10 gutter on top of this, so
             content sits a uniform ~40px off the rail — frontdesk
             included (its old padding-left:8px override was removed
             so every screen now has the same left gutter). */
          padding-left: 64px;
          padding-bottom: 16px;
        }
      }

      /* Admin breadcrumb — slim glass pill anchored top-left of the main
       content area. Shows only on /admin/* sub-routes (controlled by
       showAdminBack signal). Sticky so it stays visible as the page
       scrolls; pushed below the chrome card with a small inset. */
      .pf-back-chip {
        position: sticky;
        top: 8px;
        z-index: 5;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin: 12px 0 0 16px;
        padding: 6px 12px;
        border-radius: 9999px;
        background: var(--glass-bg);
        border: 1px solid var(--glass-border);
        color: var(--text-secondary);
        font-size: 12.5px;
        font-weight: 600;
        text-decoration: none;
        backdrop-filter: blur(8px);
        transition:
          color 0.15s,
          border-color 0.15s,
          background 0.15s;
        width: fit-content;
      }
      .pf-back-chip:hover {
        color: var(--text-primary);
        border-color: rgba(168, 85, 247, 0.4);
        background: rgba(168, 85, 247, 0.06);
      }
      @media (min-width: 640px) {
        .pf-back-chip {
          margin-left: 24px;
        }
      }
      @include dt.desktop-only {
        .shell-main {
          padding-bottom: 0;
        }
      }

      /* Toast */
      .toast-item {
        background: var(--bg-card-solid);
        border: 1px solid var(--glass-border);
        color: var(--text-secondary);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        animation: toast-in 0.22s cubic-bezier(0.2, 0.8, 0.2, 1) both;
      }

      .toast-msg {
        color: var(--text-primary);
      }

      /* Icon badge per level */
      .toast-icon[data-level="success"] {
        background: rgba(16, 185, 129, 0.18);
        color: var(--green-text);
      }
      .toast-icon[data-level="error"] {
        background: rgba(239, 68, 68, 0.18);
        color: var(--red-text);
      }
      .toast-icon[data-level="warning"] {
        background: rgba(245, 158, 11, 0.18);
        color: var(--amber-text);
      }
      .toast-icon[data-level="info"] {
        background: rgba(99, 102, 241, 0.18);
        color: #818cf8;
      }

      /* Close button */
      .toast-close {
        color: var(--text-muted);
        background: transparent;
        border: none;
        cursor: pointer;
        transition:
          background 0.15s ease,
          color 0.15s ease;
      }
      .toast-close:hover {
        background: var(--glass-bg-hover);
        color: var(--text-primary);
      }

      @keyframes toast-in {
        from {
          opacity: 0;
          transform: translateX(16px) scale(0.97);
        }
        to {
          opacity: 1;
          transform: translateX(0) scale(1);
        }
      }
    
      /* ── Bottom-navbar experiment, ALL viewports (owner: same thing on
         iPad and mobile; new design only, classic untouched). Placed
         last so it out-cascades the ≤1279px display:none rules. ── */
      :host-context(.design-new.nav-bottom) .pf-chrome {
        display: block !important;
        position: fixed;
        left: 0; right: 0; bottom: 0; top: auto;
        margin: 0;
        border-radius: 0;
        border: none;
        border-top: 1px solid var(--header-border);
        /* Icons centred in the WHOLE bar (owner, iPad): the reserved
           home-indicator space is split evenly above and below. */
        padding-block: calc(var(--pf-home-inset) / 2);
        z-index: 40;
        /* The bar's surface lives in styles.scss as --pf-navbar-* (light
           = the band's wash; dark = its own VERTICAL violet fade, owner).
           Glassmorphism (owner): translucent base + a blur of whatever is
           scrolling underneath, so the bar frosts the page instead of
           capping it. The wash rides on top of the frost. */
        background-color: var(--pf-navbar-bg-glass);
        background-image: var(--pf-navbar-wash);
        backdrop-filter: blur(18px) saturate(1.3);
        -webkit-backdrop-filter: blur(18px) saturate(1.3);
      }
      /* Phones: the home-indicator space goes UNDER the icons (not split
         above/below), and the ends keep clear of the rounded screen corners. */
      :host-context(html.device-phone.design-new.nav-bottom) .pf-chrome {
        padding-top: 0;
        padding-bottom: var(--pf-home-inset);
        padding-inline: max(8px, env(safe-area-inset-left)) max(8px, env(safe-area-inset-right));
      }
      @media (max-width: 640px) {
        :host-context(.design-new.nav-bottom) .pf-chrome {
          padding-top: 0;
          padding-bottom: var(--pf-home-inset);
          padding-inline: max(8px, env(safe-area-inset-left)) max(8px, env(safe-area-inset-right));
        }
      }
      /* Blur is the costliest GPU op on a phone — keep it modest there. */
      @media (max-width: 640px) {
        :host-context(.design-new.nav-bottom) .pf-chrome {
          backdrop-filter: blur(10px) saturate(1.2);
          -webkit-backdrop-filter: blur(10px) saturate(1.2);
        }
      }
      /* No backdrop-filter support → fall back to the opaque bar rather
         than a see-through one with unreadable icons. */
      @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
        :host-context(.design-new.nav-bottom) .pf-chrome {
          background-color: var(--pf-navbar-bg);
        }
      }
      :host-context(.dark.design-new.nav-bottom) .pf-chrome {
        border-top-color: var(--pf-navbar-edge);
        /* Faint violet glow off the top edge, paired with the band's. */
        box-shadow: var(--pf-navbar-glow, none);
      }
      /* Soft keyboard up (iPad / phones): the docked bar would ride on top
         of the keyboard and squeeze the page to a sliver (owner: test search
         on the iPad). Hide it while typing and give the page its space. */
      :host-context(.design-new.nav-bottom) .pf-chrome.pf-chrome--kbd { display: none !important; }
      :host-context(.design-new.nav-bottom) .shell-main.shell-main--kbd { padding-bottom: 12px !important; }
      /* One bottom surface only: the phone pill / iPad rail steps aside. */
      :host-context(.design-new.nav-bottom) pf-bottom-nav { display: none !important; }
      :host-context(.design-new.nav-bottom) .shell-main {
        padding-bottom: calc(var(--pf-botbar-h, 58px) + 12px) !important;
        padding-left: 0 !important;
      }
      /* Toasts clear the docked bar (md+ anchors them bottom-center). */
      @media (min-width: 768px) {
        :host-context(.design-new.nav-bottom) .pf-toasts {
          bottom: calc(var(--pf-botbar-h, 58px) + 16px) !important;
        }
      }
`,
  ],
})
export class ShellComponent {
  readonly toasts = inject(ToastService);
  /** Bottom-bar experiment (new design, opt-in via avatar menu). */
  protected readonly theme = inject(ThemeService);
  readonly scan = inject(ScanService);
  readonly patientTimeline = inject(PatientTimelineService);
  protected readonly designMode = inject(DesignModeService);
  /** Drives the offline banner (Network plugin on native, window events on web). */
  protected readonly capacitor = inject(CapacitorService);
  /** When the soft keyboard is up the bottom-nav hides, so shell-main drops its
   *  nav-clearance padding — otherwise that reserved space becomes a dead gap
   *  between the content (e.g. the chat composer) and the keyboard. */
  protected readonly kbd = inject(KeyboardService);
  /** In-app branch switch: drives the veil + the content zoom out/in. */
  protected readonly branchSwitch = inject(BranchSwitchService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  /** A scanned QR / barcode → open what it points at. Patient ID cards
   *  encode the app's /p/{id} route and order QRs /o/{id} — those resolve
   *  LOCALLY; everything else goes to the order resolver (which also strips
   *  ids out of /track/{token} URLs). The old version sent every scan to the
   *  ORDER resolver, so patient ID cards did nothing, silently (OPS-50). */
  onScanOrder(code: string) {
    this.scan.close();
    const app = /\/(p|o)\/([0-9a-f]{8}-[0-9a-f-]{27,})/i.exec(code);
    if (app) {
      this.router.navigate([`/${app[1].toLowerCase()}`, app[2]]);
      return;
    }
    this.api.get<{ orderId: string }>(`/api/orders/resolve?code=${encodeURIComponent(code)}`).subscribe({
      next: r => { if (r?.orderId) this.router.navigate(['/o', r.orderId]); },
      error: () => this.toasts.warning('Scanned code not recognized — try the order QR or the patient ID card.')
    });
  }
  private readonly signaling = inject(SignalingService);
  private readonly chat = inject(ChatService);
  /** Live work screens: one branch-scoped socket (/hubs/work) for every
   *  signed-in user — independent of the Messages module. */
  private readonly workEvents = inject(WorkEventsService);
  private readonly chatNotify = inject(ChatNotifyService);
  private readonly platform = inject(PlatformService);
  protected readonly entitlements = inject(TenantEntitlementsService);
  /** Messages module in the tenant's plan — gates the call overlay, people
   *  drawer, and the chat/signaling hub connection (a gated tenant never
   *  connects, so no calls/presence ever reach it). */
  protected readonly messagesEnabled = computed(() => this.entitlements.moduleEnabled('messages'));
  // Boots the WebRTC service so it subscribes to signaling events.
  // The variable is unused on purpose — the side effect is what we want.
  private readonly _webrtc = inject(WebrtcService);

  /** Tracks the current URL so the back-chip reacts to navigation. */
  private readonly _url = signal<string>(this.router.url);
  constructor() {
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((e) => this._url.set(e.urlAfterRedirects));

    // Lazy-connect to the signaling hub once we have an authenticated user.
    // Fire-and-forget; SignalingService.connect() is idempotent + handles its
    // own reconnect via withAutomaticReconnect.
    queueMicrotask(async () => {
      try {
        // Wait for entitlements so we decide on real data. The SIGNALING hub
        // (calls/presence) stays gated on the messages module, but the CHAT
        // hub always connects: it is also the delivery rail for business
        // notifications (BusinessNotification → live bell + desktop/browser
        // OS notifications), which every tenant has regardless of plan.
        await this.entitlements.ensureLoaded().catch(() => undefined);
        const token = await this.auth.getAccessToken();
        if (token) {
          if (this.entitlements.moduleEnabled('messages')) {
            await this.signaling.connect();
          }
          // Work events first: queues go live even if chat is slow to come up.
          void this.workEvents.start().catch(() => undefined);
          // Chat connects independently — its own hub, own reconnection.
          await this.chat.connect().catch(() => undefined);
        }
      } catch {
        /* hub will retry on next user action */
      }
    });

    // Desktop/browser OS notifications need Notification permission, and
    // browsers penalise requesting it on load (permanent auto-deny) — so ask
    // once behind the first user gesture. Native apps have their own push
    // permission flow (PushService.init) and are left alone.
    if (!this.platform.isCapacitor() && typeof document !== 'undefined') {
      document.addEventListener('pointerdown', () => {
        void this.chatNotify.ensurePermission();
      }, { once: true, capture: true });
    }
  }

  /** Pages that are themselves top-level landings — no back chip on these. */
  private static readonly LANDING_ROUTES = new Set<string>([
    "/",
    "/login",
    "/admin",
    "/frontdesk",
    "/lab/my-work",
    "/sample-collection",
    "/billing-counter",
    "/reports",
    "/pathologist",
  ]);

  /** Routes reachable from the Admin grid that DON'T live under /admin/*.
   *  Without this list, the back chip on /dashboard or /setup would
   *  default to "Frontdesk" (closest non-admin landing) when in fact
   *  the user arrived via the Admin dashboard. */
  private static readonly ADMIN_REACHABLE = new Set<string>([
    "/dashboard",
    "/setup",
  ]);

  /** Returns the back-link target based on the current URL, or null
   *  if no chip should show. Label is always just "Back" — the
   *  destination is implicit (whichever module landing you came from)
   *  and "Back" reads more naturally than "Admin" / "Frontdesk" when
   *  the user is mid-task. */
  readonly backLink = computed<{ href: string } | null>(() => {
    const u = this._url().split("?")[0];
    if (ShellComponent.LANDING_ROUTES.has(u)) return null;
    if (u.startsWith("/admin/") || ShellComponent.ADMIN_REACHABLE.has(u))
      return { href: "/admin" };
    if (u.startsWith("/frontdesk/")) return { href: "/frontdesk" };
    if (u.startsWith("/lab/")) return { href: "/lab/my-work" };
    if (u.startsWith("/reports/")) return { href: "/reports" };
    if (u.startsWith("/pathologist/")) return { href: "/pathologist" };
    if (u.startsWith("/sample-collection/"))
      return { href: "/sample-collection" };
    if (u.startsWith("/billing-counter/")) return { href: "/billing-counter" };
    // Unknown deep route — generic Back pointing at /admin.
    return { href: "/admin" };
  });
}
