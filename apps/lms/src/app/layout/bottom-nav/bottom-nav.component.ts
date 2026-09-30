import { DESKTOP_NOTIFY_ITEMS, DesktopNotifyService } from '../../core/services/desktop-notify.service';
import { DesktopWindowService } from '../../core/services/desktop-window.service';
import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostListener, NgZone, OnDestroy,
  Injector, computed, effect, inject, signal, viewChild, viewChildren
} from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { filter } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { ModuleScopeService } from '../../core/services/module-scope.service';
import { StoredAccount } from '../../core/auth/accounts.service';
import { BranchRef } from '../../core/auth/mock-user';
import { LockService } from '../../core/auth/lock.service';
import { BranchLabConfigService } from '../../core/services/branch-lab-config.service';
import { TenantEntitlementsService } from '../../core/services/tenant-entitlements.service';
import { DialogService } from '../../core/services/dialog.service';
import { TenantStateService } from '../../core/services/tenant-state.service';
import { brandingSrc } from '../../core/services/uploads.service';
import { PeopleDrawerService } from '../../core/services/people-drawer.service';
import { ThemeService } from '../../core/services/theme.service';
import { DesignModeService } from '../../core/services/design-mode.service';
import { KeyboardService } from '../../core/services/keyboard.service';
import { PresenceService } from '../../core/services/presence.service';
import { PRESENCE_OPTIONS, PresenceOption, presenceLabel } from '../../shared/models/presence.model';
import { SessionService } from '../../core/auth/session.service';
import { DOCTOR_NAV, ADMIN_NAV, MORE_NAV, NavItem, PRIMARY_NAV, WorkflowNavCtx, menusFromWorkflow, NavVisibilityCtx, navItemVisible, withCollectionFallback } from '../nav-items';
import { RouteAccessCtx } from '../../core/auth/route-access';
import { ProcessWorkflowService } from '../../core/services/process-workflow.service';
import { BranchSwitchService } from '../../core/services/branch-switch.service';

const DRAG_THRESHOLD_PX = 4;

@Component({
  selector: 'pf-bottom-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './bottom-nav.component.html',
  styleUrl: './bottom-nav.component.scss'
})
export class BottomNavComponent implements AfterViewInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly moduleScope = inject(ModuleScopeService);
  private readonly labCfg = inject(BranchLabConfigService);
  private readonly dialog = inject(DialogService);
  private readonly entitlements = inject(TenantEntitlementsService);
  private readonly router = inject(Router);
  /** Theme + people drawer are now reachable from the bottom-nav More
   *  popover instead of the top chrome (which is hidden on mobile). */
  protected readonly theme = inject(ThemeService);
  /** Design version / bottom-bar / capture toggles. The top chrome is
   *  hidden below 1280px, so when the bar sits at the TOP this popover is
   *  the ONLY place these live on phone and iPad (owner). */
  protected readonly designMode = inject(DesignModeService);
  /** Desktop app: notification switches in the more menu. */
  protected readonly desktopNotify = inject(DesktopNotifyService);
  protected readonly desktopItems = DESKTOP_NOTIFY_ITEMS;
  /** Desktop app, windowed: "Full screen" item (same as the top bar's). */
  protected readonly desktopWindow = inject(DesktopWindowService);
  protected readonly fullScreenKey =
    typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent) ? '⌃⌘F' : 'F11';
  protected enterFullScreen(): void {
    this.closeMore();
    void this.desktopWindow.setFullScreen(true);
  }
  protected readonly peopleDrawer = inject(PeopleDrawerService);
  /** Teams-style presence — my status dot on the account button + the
   *  status picker row in the account popover. */
  protected readonly presence = inject(PresenceService);
  /** Hide the floating pill while the soft keyboard is up (phone typing). */
  protected readonly kbd = inject(KeyboardService);
  /** Push token must be unregistered on sign-out (mirrors the top-strip's
   *  logout) — otherwise the device keeps receiving this user's pushes. */
  private readonly session = inject(SessionService);
  /** Scroll listener is registered runOutsideAngular (it fires very often),
   *  so signal writes that must trigger OnPush re-render re-enter the zone. */
  private readonly zone = inject(NgZone);

  private readonly btns = viewChildren<ElementRef<HTMLElement>>('navBtn');
  private readonly pillRef = viewChild<ElementRef<HTMLElement>>('pill');
  /** Inner scrollable strip (phone only). Used for drag-offset snapshotting
   *  and scroll-into-view so only the nav items scroll, not the fixed dock. */
  private readonly navScrollRef = viewChild<ElementRef<HTMLElement>>('navScroll');

  protected readonly moreOpen = signal(false);

  /** Scroll-reactive minimize (phone only). True while the user is
   *  scrolling DOWN (content rising) → the pill shrinks/condenses;
   *  back to false on an upward scroll or near the top → pill restores.
   *  The class binding gates this on !railMode() so the iPad rail and
   *  desktop are never minimized. */
  protected readonly minimized = signal(false);

  /** Rail mode — on the iPad band (641–1279px) the nav docks as a
   *  vertical rail on the left edge instead of a floating bottom pill.
   *  Phones (≤640px) keep the bottom pill; desktop (≥1280px) hides the
   *  whole component (xl:hidden) and uses the top-strip nav; touch-first
   *  devices (html.device-touch) keep the rail at every width. */
  protected readonly railMode = signal<boolean>(this.computeRailMode());
  /** Show all primary items — the pill is now a horizontally-scrollable
   *  slider so every tab is always reachable without a "More" overflow. */
  protected readonly displayedItems = computed(() => this.primary());
  /** No overflow items — all tabs are in the scrollable pill. */
  protected readonly overflowItems = computed(() => [] as {item: import('../nav-items').NavItem; index: number}[]);
  protected readonly isOverflowActive = computed(() => false);
  private computeRailMode(): boolean {
    if (typeof window === 'undefined') return false;
    const w = window.innerWidth;
    // Native (Capacitor) is always a touch device — never the desktop
    // top-strip. So any tablet-width native build (incl. a 12.9" iPad Pro at
    // 1366pt, which is ≥1280) uses the left rail, not the desktop layout.
    const isNative = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor?.isNativePlatform?.();
    // Same for any touch-first device on the web (Android tablet, iPad Pro
    // in landscape): html.device-touch, set in index.html before first paint.
    const isTouch = document.documentElement.classList.contains('device-touch');
    if (isNative || isTouch) return w >= 641;
    return w >= 641 && w < 1280;
  }

  /** Tenant (client) identity for the rail TOP brand. Prefer the live tenant
   *  state (carries the uploaded logo) and fall back to the auth user's tenant
   *  name. */
  private readonly tenantState = inject(TenantStateService);
  protected readonly tenantName = computed(() =>
    this.tenantState.tenant()?.name || this.auth.user()?.tenantName || '');
  private readonly injector = inject(Injector);
  /** A private "/uploads/…" logo shows through the session (blob: URL). */
  protected readonly tenantLogo = computed(() => brandingSrc(this.injector, this.tenantState.tenant()?.logoUrl));
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

  /** Branch switcher — the chrome's branch picker folds into the account
   *  popover. Parity with the desktop top-strip (OPS-65): the REAL branches
   *  this user may switch between (from /api/auth/me), shown as a pick-list
   *  and performing a real re-scope via auth.setActiveBranch — not the old
   *  hardcoded mock that cycled and never actually switched. */
  protected readonly branches = computed(() => this.auth.user()?.branches ?? []);
  /** Show the switcher only when there's more than one branch to pick. */
  protected readonly canSwitchBranch = computed(() => this.branches().length > 1);
  protected readonly activeBranchId = computed(() => this.auth.activeBranchId());
  /** Current active branch name for the row's value label. */
  protected readonly currentBranch = computed(() =>
    this.branchSwitch.target()?.name ?? this.auth.activeBranch()?.name ?? this.auth.user()?.branchName ?? '');
  /** In-app branch switch (veil + zoom; no page reload). */
  protected readonly branchSwitch = inject(BranchSwitchService);
  /** Whether the in-popover branch pick-list is expanded. */
  protected readonly branchListOpen = signal(false);

  /** Toggle the branch pick-list (no-op for single-branch users). */
  protected toggleBranchList(): void {
    if (!this.canSwitchBranch()) return;
    this.branchListOpen.update(v => !v);
  }
  /** Pick a branch → confirm → real re-scope. Tapping the active branch just
   *  collapses the list. */
  protected async selectBranch(b: BranchRef): Promise<void> {
    if (b.id === this.activeBranchId()) { this.branchListOpen.set(false); return; }
    const ok = await this.dialog.confirm({
      title: 'Switch active branch?',
      message: `Are you sure you want to switch the active branch to "${b.name}"?`,
      confirmLabel: 'Yes, switch branch',
      cancelLabel: 'Cancel',
      tone: 'primary'
    });
    if (!ok) return;
    this.branchListOpen.set(false);
    this.closeMore();
    void this.branchSwitch.switchTo(b.id);
  }

  // ─── Presence status picker ───────────────────────────────────────
  protected readonly statusOptions = PRESENCE_OPTIONS;
  protected readonly statusListOpen = signal(false);
  protected readonly myStatusLabel = computed(() => presenceLabel(this.presence.myStatus()));
  protected toggleStatusList(ev?: Event): void {
    ev?.stopPropagation?.();
    this.statusListOpen.update(v => !v);
  }
  protected pickStatus(o: PresenceOption): void {
    this.statusListOpen.set(false);
    this.closeMore();
    void this.presence.setStatus(o.key);
  }

  // ─── More popover handlers ────────────────────────────────────────
  protected toggleMore(ev?: Event): void {
    ev?.stopPropagation?.();
    this.moreOpen.update(v => !v);
    if (!this.moreOpen()) this.statusListOpen.set(false);
  }
  protected closeMore(): void { this.moreOpen.set(false); this.statusListOpen.set(false); }

  /** Per-station Print settings — same gating as the desktop profile menu, so
   *  the mobile/iPad "More" menu has parity. */
  protected canPrint(): boolean {
    return this.auth.hasAnyPermission([
      'create_order', 'register_patient', 'collect_sample',
      'enter_result', 'deliver_report', 'view_report', 'manage_lab_settings',
    ]);
  }
  protected goPrinting(): void { this.closeMore(); this.router.navigate(['/printing']); }
  protected goSignature(): void { this.closeMore(); this.router.navigate(['/signature']); }
  protected goSetup(): void { this.closeMore(); this.router.navigate(['/setup']); }

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
  protected async onMoreLogout(): Promise<void> {
    this.closeMore();
    // The ONE ordered sign-out (revoke → push → sockets → timers → clear →
    // /login, history replaced) — same as the avatar menu.
    await this.session.logout();
  }

  // ─── Multi-account switching + PIN (mobile/iPad — mirrors the top strip) ──
  protected readonly lock = inject(LockService);
  protected readonly otherAccounts = computed(() =>
    this.auth.accounts.accounts().filter(a => a.userId !== this.auth.user()?.id));
  protected readonly hasPin = computed(() => !!this.auth.user()?.hasPin);
  protected accountInitials(a: StoredAccount): string { return this.auth.accounts.initials(a); }

  protected onSwitchAccount(a: StoredAccount): void {
    this.closeMore();
    this.lock.switchTarget.set(a); // full-screen switch screen takes over
  }
  protected onAddAccount(): void {
    this.closeMore();
    void this.router.navigateByUrl('/login?add=1');
  }
  protected onLockScreen(): void {
    this.closeMore();
    this.lock.lock();
  }

  protected readonly pinFormOpen = signal(false);
  protected pinCurrent = '';
  protected pinNew = '';
  protected readonly pinBusy = signal(false);
  protected readonly pinError = signal<string | null>(null);
  protected readonly pinSaved = signal(false);

  protected onSetPin(): void {
    this.pinFormOpen.set(true);
    this.pinCurrent = '';
    this.pinNew = '';
    this.pinError.set(null);
    this.pinSaved.set(false);
  }
  protected sanitizePin(v: string): string { return (v ?? '').replace(/\D/g, '').slice(0, 4); }

  protected async savePin(): Promise<void> {
    if (this.pinBusy() || !/^\d{4}$/.test(this.pinNew)) { this.pinError.set('PIN must be exactly 4 digits.'); return; }
    this.pinBusy.set(true);
    this.pinError.set(null);
    try {
      await this.auth.setPin(this.pinNew, this.hasPin() ? this.pinCurrent : undefined);
      this.pinSaved.set(true);
      setTimeout(() => this.pinFormOpen.set(false), 900);
    } catch (e) {
      this.pinError.set((e as Error).message || 'Could not update the PIN.');
    } finally {
      this.pinBusy.set(false);
    }
  }

  /** Tap outside the popover closes it. The transparent .pf-more-bd
   *  div catches most taps; this listener catches anything else. */
  @HostListener('document:click', ['$event'])
  onDocClick(_ev: MouseEvent): void {
    if (!this.moreOpen()) return;
    // The popover is responsible for stopPropagation on inside clicks,
    // so any click that bubbles to document means "outside" → close.
    this.closeMore();
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

  // ─── Scroll-reactive minimize state ───────────────────────────────
  /** Capture-phase scroll handler on document — catches nested scrollers
   *  (most pages scroll inside .shell-main, some inner panes scroll) since
   *  scroll events don't bubble but DO reach a capture listener. */
  private scrollListener?: (ev: Event) => void;
  /** The element that fired the most recent scroll (null = window/document
   *  document-scrolling). Read inside the rAF tick so we always sample the
   *  freshest scrollTop, not a stale value from the frame's first event. */
  private lastScroller: HTMLElement | null = null;
  /** Last committed scrollTop of the active scroller, for direction + delta. */
  private lastScrollTop = 0;
  /** rAF throttle latch — at most one direction eval per frame. */
  private scrollRafPending = false;
  /** Ignore sub-threshold scroll jitter (px) so the pill doesn't flicker. */
  private static readonly SCROLL_DELTA = 6;
  /** Always restore (grow) the pill when within this many px of the top. */
  private static readonly NEAR_TOP = 24;

  constructor() {
    this.labCfg.ensureLoaded();
    this.entitlements.ensureLoaded();
    this.tenantState.ensureLoaded();
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

    // Scroll-reactive minimize. Registered runOutsideAngular (scroll fires
    // very often) + passive (we never preventDefault) + capture (so nested
    // scrollers, not just the document, are observed). setMinimized() re-
    // enters the zone only on an actual state flip so OnPush updates.
    if (typeof document !== 'undefined') {
      this.scrollListener = (ev: Event) => this.onDocScroll(ev);
      this.zone.runOutsideAngular(() => {
        document.addEventListener('scroll', this.scrollListener!, { capture: true, passive: true });
      });
    }
  }

  ngOnDestroy(): void {
    this.routerSub?.unsubscribe();
    if (this.resizeListener) window.removeEventListener('resize', this.resizeListener);
    if (this.scrollListener) {
      document.removeEventListener('scroll', this.scrollListener, { capture: true });
    }
  }

  // ─── Scroll-reactive minimize logic ───────────────────────────────
  /** Snapshot which element scrolled, then throttle the direction eval to
   *  one run per animation frame (rAF). */
  private onDocScroll(ev: Event): void {
    const t = ev.target;
    this.lastScroller =
      t instanceof HTMLElement && t !== document.documentElement && t !== document.body
        ? t
        : null;
    if (this.scrollRafPending) return;
    this.scrollRafPending = true;
    requestAnimationFrame(() => this.evalScroll());
  }

  /** Compare the active scroller's scrollTop with the last sample to derive
   *  direction. Down → minimize; up or near-top → restore. A small delta
   *  threshold (and NOT updating lastScrollTop until it's crossed) lets slow
   *  scrolls accumulate instead of being eaten as jitter. */
  private evalScroll(): void {
    this.scrollRafPending = false;
    const el = this.lastScroller;
    const st = el
      ? el.scrollTop
      : (window.scrollY || document.documentElement.scrollTop || 0);

    // Near the very top: always full-size, and re-baseline.
    if (st < BottomNavComponent.NEAR_TOP) {
      this.lastScrollTop = st < 0 ? 0 : st;
      this.setMinimized(false);
      return;
    }

    const delta = st - this.lastScrollTop;
    if (Math.abs(delta) < BottomNavComponent.SCROLL_DELTA) return; // jitter — keep baseline so it accumulates
    this.lastScrollTop = st;
    this.setMinimized(delta > 0); // down → minimize, up → restore
  }

  /** Commit a minimize change, re-entering Angular's zone only on a real
   *  flip (the listener runs outside the zone). */
  private setMinimized(v: boolean): void {
    if (v === this.minimized()) return;
    this.zone.run(() => this.minimized.set(v));
  }

  // ─── Visible nav lists ───────────────────────────────────────────
  private readonly process = inject(ProcessWorkflowService);
  /** People (contacts + chat + calls) is part of the Messages capability —
   *  hide its rail/menu button when the Messages work-area is disabled. */
  readonly canMessages = computed(() => this.process.isEnabled('messages') && this.entitlements.moduleEnabled('messages'));
  /** The route-guard context (same rule the guards + landing use). */
  private routeCtx(): RouteAccessCtx {
    return {
      hasAny: p => this.auth.hasAnyPermission(p),
      hasAnyEffective: p => this.auth.hasAnyEffectivePermission(p),
      isEnabled: a => this.process.isEnabled(a),
      isSuper: this.auth.permissions().includes('*'),
    };
  }
  /** Shared nav rule (nav-items.navItemVisible): an item shows only when its
   *  destination route's guard admits the user, plus its mode/module/action gates. */
  private readonly visible = (items: NavItem[]): NavItem[] => {
    const ctx: NavVisibilityCtx = {
      ...this.routeCtx(),
      collectionMode: this.labCfg.collectionMode(),
      billingMode: this.labCfg.billingMode(),
      inventoryEnabled: this.labCfg.inventoryEnabled(),
      moduleEnabled: m => this.entitlements.moduleEnabled(m),
    };
    return items.filter(i => navItemVisible(i, ctx));
  };

  private navCtx(): WorkflowNavCtx {
    return {
      roles: this.auth.user()?.roles ?? [],
      // Effective = the route guards' check (mode-aware collect_sample), so a
      // work area never shows to someone its screen would bounce.
      hasAnyPermission: (p) => this.auth.hasAnyEffectivePermission(p),
      hasAnyRawPermission: (p) => this.auth.hasAnyPermission(p),
      isSuper: this.auth.permissions().includes('*'),
      moduleEnabled: (m) => this.entitlements.moduleEnabled(m),
    };
  }
  // Live nav = the active workflow's work-areas (admin names + order, role-gated),
  // each opening its real screen; falls back to PRIMARY_NAV when none is active.
  readonly primary = computed(() => {
    const items = this.withCollection(this.withInventory(this.visible(menusFromWorkflow(this.process.active(), this.navCtx()) ?? PRIMARY_NAV)));
    // OPD: doctors get their Consult Room — but only once the OPD module is
    // actually usable (tenant entitlement, or the dev preview flag). Keeps the
    // in-progress consult build invisible on shared environments.
    return this.auth.isDoctor() && this.moduleScope.opdUsable() ? [...items, DOCTOR_NAV] : items;
  });

  /** NO-WORKFLOW FALLBACK ONLY: guarantee a reachable "Collect" for anyone who
   *  can draw samples when the tenant has no process workflow (PRIMARY_NAV).
   *  With a workflow active, Collect is the system Collect WORK AREA
   *  (menusFromWorkflow, normalised in for older workflows) — the nav follows
   *  the workflow, so this never adds a second Collect. Mirrors withInventory. */
  private withCollection(items: NavItem[]): NavItem[] {
    return withCollectionFallback(items, {
      hasWorkflow: !!this.process.active()?.categories?.length,
      canCollect: this.auth.hasEffectivePermission('collect_sample'),
      collectionEnabled: this.process.isEnabled('sample_collection'),
    });
  }

  /** Workflow-derived nav has no Stores work area; append it when inventory is
   *  enabled and the user can use it (idempotent vs the PRIMARY_NAV fallback). */
  private withInventory(items: NavItem[]): NavItem[] {
    if (!this.entitlements.moduleEnabled('inventory') || !this.labCfg.inventoryEnabled()) return items;
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

    // Snapshot the scroll container's position so we can map clientX
    // -> content X. In slider mode the scrollable strip (navScroll) is
    // the coordinate origin, not the outer pill.
    const navScroll = this.navScrollRef()?.nativeElement;
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
   *  by CSS once `--ready` is on (and the drag class is off). Also
   *  scrolls the inner nav strip so the active tab is fully in view. */
  private measureToActive(): void {
    if (this.dragging()) return;
    const btns = this.btns();
    const idx = this.activeIdx();
    const ref = btns[idx];
    if (!ref) return;
    const el = ref.nativeElement;
    this.indicator.set({ x: el.offsetLeft, w: el.offsetWidth, h: el.offsetHeight });
    if (!this.indicatorReady()) {
      requestAnimationFrame(() => this.indicatorReady.set(true));
    }
    // Scroll the inner strip (not the pill) so the active tab is visible.
    const scroller = this.navScrollRef()?.nativeElement;
    if (scroller && !this.railMode()) {
      const elLeft = el.offsetLeft;
      const elRight = elLeft + el.offsetWidth;
      const scrollW = scroller.clientWidth;
      const scrollLeft = scroller.scrollLeft;
      if (elLeft < scrollLeft) {
        scroller.scrollTo({ left: elLeft - 8, behavior: 'smooth' });
      } else if (elRight > scrollLeft + scrollW) {
        scroller.scrollTo({ left: elRight - scrollW + 8, behavior: 'smooth' });
      }
    }
  }
}
