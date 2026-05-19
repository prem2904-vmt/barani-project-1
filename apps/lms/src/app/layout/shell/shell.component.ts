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
  RouterLink,
  RouterOutlet,
} from "@angular/router";
import { filter } from "rxjs/operators";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { ToastService } from "../../core/services/toast.service";
import { AmbientBgComponent } from "../../shared/components/ambient-bg/ambient-bg.component";
import { DialogHostComponent } from "../../shared/components/dialog-host/dialog-host.component";
import { BottomNavComponent } from "../bottom-nav/bottom-nav.component";
import { TopStripComponent } from "../top-strip/top-strip.component";
import { PatientProfileModalComponent } from "../../shared/components/patient-profile-modal/patient-profile-modal.component";
import { AppointmentBookingModalComponent } from "../../shared/components/appointment-booking-modal/appointment-booking-modal.component";
import { CallOverlayComponent } from "../../shared/components/call-overlay/call-overlay.component";
import { PeopleDrawerComponent } from "../../shared/components/people-drawer/people-drawer.component";
import { SignalingService } from "../../core/services/signaling.service";
import { ChatService } from "../../core/services/chat.service";
// Touching WebrtcService here ensures its signaling subscriptions wire up
// on first shell render (it's @Injectable providedIn root, so the inject()
// pull below boots it lazily without ever being read).
import { WebrtcService } from "../../core/services/webrtc.service";
import { AuthService } from "../../core/auth/auth.service";

@Component({
  selector: "pf-shell",
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    TopStripComponent,
    BottomNavComponent,
    DialogHostComponent,
    AmbientBgComponent,
    PatientProfileModalComponent,
    AppointmentBookingModalComponent,
    CallOverlayComponent,
    PeopleDrawerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Flowing ambient background: DNA gradients + drifting pulse/helix/glyphs. -->
    <pf-ambient-bg></pf-ambient-bg>

    <!-- Everything above sits in a stacking context on top of the ambient. -->
    <div class="shell-stack">
      <!-- Unified chrome card: single navbar row. Tenant + branch
           moved into the top-strip's right cluster; second row removed. -->
      <div class="pf-chrome">
        <pf-top-strip></pf-top-strip>
      </div>

      <main class="shell-main relative">
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
      </main>

      <pf-bottom-nav></pf-bottom-nav>

      <!-- Themed prompt / confirm overlay (replaces window.prompt/confirm). -->
      <pf-dialog-host></pf-dialog-host>

      <!-- Global voice-consult overlay: incoming ringer + active-call pill. -->
      <pf-call-overlay></pf-call-overlay>

      <!-- Tenant people drawer: contacts + 1:1 chat + call entry. -->
      <pf-people-drawer></pf-people-drawer>

      <!-- Patient profile modal — globally available; opens via
           PatientProfileService.open(patientId) from anywhere. -->
      <pf-patient-profile-modal></pf-patient-profile-modal>

      <!-- Appointment booking modal — globally available; opens via
           AppointmentBookingService.open(preset?). -->
      <pf-appointment-booking-modal></pf-appointment-booking-modal>

      <!-- Toasts — anchored top-right so they don't fight the floating
           bottom-nav pill or sit on top of action buttons (Next, Submit)
           which usually live at the bottom of the page. -->
      <div
        class="pointer-events-none fixed top-20 right-4 flex flex-col gap-3 z-[60] sm:top-24"
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
      .shell-stack {
        position: relative;
        z-index: 1;
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
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
        /* On iOS with the Dynamic Island / notch, env(safe-area-inset-top)
           is ~59px — the chrome must clear that or it sits behind the
           status icons. Add an 8px base inset so non-notched devices and
           web both get a visible top margin. */
        top: calc(env(safe-area-inset-top, 0px) + 8px);
        z-index: 40;
        flex-shrink: 0;
        /* Same safe-area treatment on the LEFT and RIGHT edges so the
           rounded card doesn't slide into the rounded screen corners or
           clip behind the wifi/battery indicators on landscape. */
        margin:
          calc(env(safe-area-inset-top, 0px) + 8px)
          calc(env(safe-area-inset-right, 0px) + 16px)
          0
          calc(env(safe-area-inset-left, 0px) + 16px);
        border-radius: 24px;
        background: var(--header-bg);
        border: 1px solid var(--header-border);
        backdrop-filter: blur(24px);
        -webkit-backdrop-filter: blur(24px);
      }

      /* Mobile (≤640px): drop the chrome entirely. It was only carrying
         branding + four user-action icons (branch, notif, people,
         profile) and ate ~80px of vertical space — too expensive on a
         small viewport where the content matters more. The shell-main
         absorbs safe-area-inset-top so pages still clear the notch. */
      @media (max-width: 640px) {
        .pf-chrome { display: none !important; }
        .shell-main {
          padding-top: calc(env(safe-area-inset-top, 0px) + 4px);
        }
      }

      .shell-main {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        padding-bottom: var(--tab-nav-total-height, 0px);
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
      @media (min-width: 1280px) {
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
        color: #34d399;
      }
      .toast-icon[data-level="error"] {
        background: rgba(239, 68, 68, 0.18);
        color: #f87171;
      }
      .toast-icon[data-level="warning"] {
        background: rgba(245, 158, 11, 0.18);
        color: #fbbf24;
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
    `,
  ],
})
export class ShellComponent {
  readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly signaling = inject(SignalingService);
  private readonly chat = inject(ChatService);
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
        const token = await this.auth.getAccessToken();
        if (token) {
          await this.signaling.connect();
          // Chat connects independently — its own hub, own reconnection.
          await this.chat.connect().catch(() => undefined);
        }
      } catch {
        /* hub will retry on next user action */
      }
    });
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
