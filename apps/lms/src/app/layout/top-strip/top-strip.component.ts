import { SetPinDialogService } from '../../core/services/set-pin-dialog.service';
import { DESKTOP_NOTIFY_ITEMS, DesktopNotifyService } from '../../core/services/desktop-notify.service';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  Injector,
  OnDestroy,
  OnInit,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from "@angular/core";
import { PeopleDrawerService } from "../../core/services/people-drawer.service";
import { ChatWindowsService } from "../../core/services/chat-windows.service";
import {
  DirectoryService,
  DirectoryUser,
} from "../../core/services/directory.service";
import { MessagesPanelService } from "../../core/services/messages-panel.service";
import {
  conversationDisambiguator,
  conversationInitials,
  conversationPeerId,
  conversationTitle,
} from "../../shared/models/conversation-name";
import { PresenceAvatarComponent } from "../../shared/components/presence-avatar/presence-avatar.component";
import { Conversation } from "../../shared/models/chat.model";
import {
  DraftChip,
  DraftShelfService,
} from "../../core/services/draft-shelf.service";
import { BranchSwitchService } from "../../core/services/branch-switch.service";
import { ZoomSourceDirective } from "../../core/navigation/zoom.directive";
import { ZoomTransitionService } from "../../core/navigation/zoom-transition";
import {
  ActionsMenuComponent,
  ActionsMenuTriggerDirective,
} from "../../shared/components/actions-menu/actions-menu.component";
import { draftCap, draftMenuActions, draftSplit, draftTitle } from "./draft-tray";
import { NgTemplateOutlet } from "@angular/common";
import { FormBarService } from "../../features/casesheets/data/form-bar/form-bar.service";
import { NavActionsService } from "../nav-actions/nav-actions.service";
import { BetaFeaturesService } from "../../core/services/beta-features.service";
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from "@angular/router";
import { filter } from "rxjs/operators";
import { FormsModule } from "@angular/forms";
import { AuthService } from "../../core/auth/auth.service";
import { OpdGateService } from "../../features/opd/shared/opd-gate.service";
import { CasesheetGateService } from "../../features/casesheets/shared/casesheet-gate.service";
import { CASESHEET_FILL, CASESHEET_VIEW } from "../../features/casesheets/shared/casesheet-permissions";
import { StoredAccount } from "../../core/auth/accounts.service";
import { LockService } from "../../core/auth/lock.service";
import { BranchRef } from "../../core/auth/mock-user";
import { BranchLabConfigService } from "../../core/services/branch-lab-config.service";
import { TenantEntitlementsService } from "../../core/services/tenant-entitlements.service";
import { CapacitorService } from "../../core/services/capacitor.service";
import { TenantStateService } from "../../core/services/tenant-state.service";
import { brandingSrc } from "../../core/services/uploads.service";
import { ThemeService } from "../../core/services/theme.service";
import { DesignModeService } from "../../core/services/design-mode.service";
import { NotificationBellComponent } from "../../shared/components/notification-bell/notification-bell.component";
import { DialogService } from "../../core/services/dialog.service";
import { ChatService } from "../../core/services/chat.service";
import { SignalingService } from "../../core/services/signaling.service";
import { PresenceService } from "../../core/services/presence.service";
import {
  PRESENCE_OPTIONS,
  PresenceOption,
  presenceLabel,
} from "../../shared/models/presence.model";
import { SessionService } from "../../core/auth/session.service";
import {
  DOCTOR_NAV,
  OPD_NAV,
  prepareNav,
  withPrepare,
  opdNavActive,
  ADMIN_NAV,
  MORE_NAV,
  NavItem,
  PRIMARY_NAV,
  WorkflowNavCtx,
  menusFromWorkflow,
  withExpenses,
  withInsights,
  NavVisibilityCtx,
  navItemVisible,
  withCollectionFallback,
} from "../nav-items";
import { opdAreasFor } from "../../features/opd/shared/opd-nav";
import { RouteAccessCtx } from "../../core/auth/route-access";
import { ProcessWorkflowService } from "../../core/services/process-workflow.service";
import { isOpdOnly, pickLanding } from "../../core/auth/landing.guard";
import { DesktopWindowService } from "../../core/services/desktop-window.service";
import { UpdaterService } from "../../core/services/updater.service";
import { DesktopClockComponent } from "./desktop-clock.component";
import { StartMenuComponent } from "../start-menu/start-menu.component";
import { NavPrefsService } from "../start-menu/nav-prefs.service";
import { computeNavLayout } from "../start-menu/nav-pins";

@Component({
  selector: "pf-top-strip",
  standalone: true,
  imports: [
    RouterLink,
    RouterLinkActive,
    FormsModule,
    NotificationBellComponent,
    PresenceAvatarComponent,
    ZoomSourceDirective,
    DesktopClockComponent,
    ActionsMenuComponent,
    ActionsMenuTriggerDirective,
    NgTemplateOutlet,
    StartMenuComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./top-strip.component.html",
  styleUrl: "./top-strip.component.scss",
})
export class TopStripComponent implements OnInit, OnDestroy {
  protected readonly themeService = inject(ThemeService);
  /** Case sheets (dark build): an OPEN case sheet lends its Back · Pages · Next to this bar (one bar, owner
   *  2026-11-02). Null everywhere else, so the lab's bar is unchanged. */
  protected readonly formBar = inject(FormBarService);
  /** A page's contextual actions (e.g. a case sheet's Back / Next), shown on the right of the bar. */
  protected readonly navActions = inject(NavActionsService);
  /** Bottom-bar draft shelf (published by the active work screen). */
  protected readonly draftShelf = inject(DraftShelfService);
  private readonly zoom = inject(ZoomTransitionService);
  /** Viewport width — drives how many draft chips sit inline (draftCap). */
  private readonly viewportW = signal(typeof window !== "undefined" ? window.innerWidth : 1440);
  @HostListener("window:resize")
  onViewportResize(): void {
    this.viewportW.set(window.innerWidth);
  }
  /** Measured fit: the width rule is the ceiling, but the work-area tabs
   *  share the bar, so after each layout the tray drops one chip at a time
   *  until its chips stop overflowing (null = not measured yet). */
  private readonly draftFit = signal<number | null>(null);
  private readonly _draftFitReset = effect(() => {
    this.draftShelf.items();
    this.viewportW();
    untracked(() => {
      this.draftFit.set(null);
      this.fitDraftsSoon();
    });
  });
  private fitDraftsSoon(): void {
    afterNextRender(() => {
      const box = this.host.nativeElement.querySelector(".pf-draftshelf__scroll") as HTMLElement | null;
      if (!box) return;
      const cap = this.draftSplit().shown.length;
      if (box.scrollWidth > box.clientWidth + 1 && cap > 0) {
        this.draftFit.set(cap - 1);
        this.fitDraftsSoon();
      }
    }, { injector: this.injector });
  }
  /** Inline chips + how many sit behind "+N". */
  readonly draftSplit = computed(() => {
    const fit = this.draftFit();
    const cap = Math.min(draftCap(this.viewportW()), fit ?? Infinity);
    return draftSplit(this.draftShelf.items(), cap, fit !== null);
  });
  /** The "+N" menu: every draft (sample number · patient · time). */
  readonly draftMenu = computed(() => draftMenuActions(this.draftShelf.items(), this.draftShelf.activeId()));
  /** Tooltip + accessible name (carries the patient name the chip omits). */
  draftTitle(d: DraftChip, on: boolean): string {
    return draftTitle(d, on);
  }
  /** A draft chip zooms into the screen it resumes: it answers to its own id
   *  ("fd:<patientId>", "lab:<sampleId>") and the bare record id the
   *  destination's zoom target carries. */
  chipZoomKeys(d: DraftChip): string[] {
    const bare = d.id.includes(":") ? d.id.slice(d.id.indexOf(":") + 1) : "";
    return bare ? [d.id, bare] : [d.id];
  }
  /** The on-stage draft sits behind the "+N" chip (not one of the inline chips). */
  readonly activeDraftInOverflow = computed(() => {
    const id = this.draftShelf.activeId();
    return !!id && !this.draftSplit().shown.some((d) => d.id === id);
  });
  /** A draft picked from the "+N" menu: the same navigation a chip makes
   *  (link + query + slide state). The "+N" chip is the zoom source, so the
   *  resume still zooms. Picking the draft already on stage is a no-op. */
  resumeDraft(id: string): void {
    const d = this.draftShelf.items().find((x) => x.id === id);
    if (!d || this.draftShelf.activeId() === id) return;
    const more = this.host.nativeElement.querySelector(".pf-draftshelf__more") as HTMLElement | null;
    if (more) this.zoom.tap(more, this.chipZoomKeys(d));
    const cmds = typeof d.link === "string" ? [d.link] : [...d.link];
    void this.router.navigate(cmds, { queryParams: d.queryParams ?? {}, state: this.draftShelf.swapState(d) });
  }
  protected readonly designMode = inject(DesignModeService);
  /** Desktop app: full-screen clock on the bar + "Full screen" menu item. */
  protected readonly desktopWindow = inject(DesktopWindowService);
  /** macOS writes the shortcut its own way. */
  protected readonly fullScreenKey =
    typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent)
      ? "⌃⌘F"
      : "F11";
  /** Desktop app: "Check for updates" in the avatar menu. */
  protected readonly updater = inject(UpdaterService);
  checkUpdates(): void {
    void this.updater.checkNow();
  }
  enterFullScreen(): void {
    this.closeProfile();
    void this.desktopWindow.setFullScreen(true);
  }
  /** Desktop app: notification switches in the avatar menu. */
  protected readonly desktopNotify = inject(DesktopNotifyService);
  protected readonly desktopItems = DESKTOP_NOTIFY_ITEMS;
  // Public so the template can read isOnline / initialised signals.
  protected readonly capacitor = inject(CapacitorService);
  private readonly auth = inject(AuthService);
  /** OPD dark build: the ONE OPD visibility rule. */
  private readonly opdGate = inject(OpdGateService);
  private readonly casesheetGate = inject(CasesheetGateService);
  /** Prepare tab: Prepare on for the lab AND a case-sheet permission (nav-items.ts prepareNav). */
  private readonly prepareItem = computed(() =>
    this.casesheetGate.prepareOn() && this.auth.hasAnyPermission([CASESHEET_FILL, CASESHEET_VIEW])
      ? prepareNav(this.auth.hasAnyPermission([CASESHEET_FILL])) : null);
  private readonly lock = inject(LockService);
  private readonly tenantState = inject(TenantStateService);
  private readonly labCfg = inject(BranchLabConfigService);
  private readonly entitlements = inject(TenantEntitlementsService);
  /** Facebook-style chat entry (new design): icon after the bell opens the
   *  people/chat drawer; the Messages PAGE leaves the nav. */
  protected readonly peopleDrawer = inject(PeopleDrawerService);
  protected readonly directory = inject(DirectoryService);
  /** Messages panel open state — shared so the windows' compose button
   *  can raise the same list. */
  protected readonly msgsPanel = inject(MessagesPanelService);
  /** Free-text filter across conversations + tenant people. */
  readonly msgQuery = signal("");

  /** Everyone in the tenant I can start a chat with, minus the people I
   *  already have a 1:1 thread with (those show under Recent). */
  readonly msgPeople = computed(() => {
    const q = this.msgQuery().trim().toLowerCase();
    // By id, not display name: two colleagues can share a name ("Front
    // Desk"), and a name match hid the second one from People.
    const me = this.meId();
    const inThreads = new Set(
      this.chat
        .conversations()
        .filter((c) => !c.isGroup)
        .flatMap(
          (c) =>
            c.participants?.map((p) => p.userId).filter((id) => id !== me) ??
            [],
        ),
    );
    return this.directory
      .others()
      .filter((u) => !inThreads.has(u.id))
      .filter(
        (u) =>
          !q ||
          u.displayName.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q),
      );
  });

  /** Existing conversations, filtered by the same query. */
  readonly msgConversations = computed(() => {
    const q = this.msgQuery().trim().toLowerCase();
    const list = this.chat.conversations();
    return q
      ? list.filter((c) => this.convoTitle(c).toLowerCase().includes(q))
      : list;
  });

  /** Initials for a directory person — same rule as conversations. */
  personInitials(u: DirectoryUser): string {
    const words = (u.displayName || "?").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "?";
    const first = words[0][0] ?? "";
    const last = words.length > 1 ? (words[words.length - 1][0] ?? "") : "";
    return (first + last).toUpperCase() || "?";
  }

  /** Start (or reopen) a 1:1 thread with a tenant person. */
  async openPerson(u: DirectoryUser): Promise<void> {
    this.msgsPanel.close();
    try {
      const convId = await this.chat.openDirectConversation(u.id);
      if (this.themeService.isNewDesign()) {
        this.chatWindows.openWindow(convId);
        void this.chat.loadThread(convId);
      } else {
        this.peopleDrawer.openIt();
      }
    } catch {
      /* toast already surfaced by the API layer */
    }
  }

  /** Open the Messages panel and make sure the people list is loaded. */
  toggleMsgs(): void {
    // PHONE: the whole thing is WhatsApp, not just the thread (owner).
    // A people/conversation LIST is a screen on a phone — squeezing it into
    // a popover anchored to a bar icon was the iPad/web shape leaking down.
    // The bar icon goes straight to /messages; the page owns the list, the
    // search and the threads.
    if (this.themeService.isNewDesign() && this.chatWindows.isPhone()) {
      this.msgsPanel.close();
      void this.router.navigate(["/messages"]);
      return;
    }
    this.msgsPanel.toggle();
    if (this.msgsPanel.open()) void this.directory.load();
  }

  private readonly chatWindows = inject(ChatWindowsService);
  readonly chatSurfaceActive = computed(
    () => this.msgsPanel.open() || this.chatWindows.open().length > 0,
  );
  private meId(): string {
    return this.auth.user()?.authId ?? this.auth.user()?.id ?? "";
  }

  /** Shared with the floating windows so both label a thread identically. */
  convoTitle(c: Conversation): string {
    return conversationTitle(c, this.meId());
  }
  convoInitials(c: Conversation): string {
    return conversationInitials(c, this.meId());
  }
  /** 1:1 peer (AuthId) for the presence dot; null for groups. */
  convoPeerId(c: Conversation): string | null {
    return conversationPeerId(c, this.meId());
  }
  /** Second label when two rows would read the same (context thread,
   *  same-name colleague, group vs person). */
  convoDisambiguator(c: Conversation): string | null {
    return conversationDisambiguator(c, this.meId(), this.chat.conversations());
  }

  /**
   * Open a conversation. Desktop/tablet in the new design get a floating
   * Messenger-style WINDOW (several at once); phones — where a 330px
   * window has nowhere to live — fall back to the people drawer.
   * Either way the bar keeps a chip for the thread.
   */
  openConvo(c: Conversation): void {
    this.msgsPanel.close();
    if (this.themeService.isNewDesign()) {
      // PHONE: WhatsApp behaviour — tapping a conversation navigates to the
      // thread as a full page, and back returns to the list (owner). A
      // 330px window docked over a 390px screen was never the right shape,
      // and the page already has the full composer (attachments, voice).
      if (this.chatWindows.isPhone()) {
        void this.router.navigate(["/messages"], { queryParams: { c: c.id } });
        return;
      }
      // iPad + web keep the docked floating windows.
      this.chatWindows.openWindow(c.id);
      void this.chat.loadThread(c.id);
      return;
    }
    void this.chat.openConversation(c.id);
    this.peopleDrawer.openIt();
  }
  /**
   * Chat surfaces (bar icon, panel, floating windows) exist ONLY when the
   * ACTIVE WORKFLOW includes Messages — the admin's /admin/process work
   * areas decide, not merely whether the tenant is licensed for it. The
   * nav pipeline already applies the module entitlement via gateModules.
   */
  readonly messagesModuleOn = computed(
    () =>
      this.navAll().some((i) => TopStripComponent.isMessagesItem(i)) &&
      this.process.isEnabled("messages"),
  );

  /**
   * Is this nav entry the Messages work area? Workflow-built items are
   * keyed by WORK-AREA id (a uuid), not the literal 'messages' — the
   * route is the only reliable discriminator.
   */
  private static isMessagesItem(i: NavItem): boolean {
    return (
      i.id === "messages" ||
      i.href === "/messages" ||
      i.href.startsWith("/messages/")
    );
  }
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly chat = inject(ChatService);
  protected readonly signaling = inject(SignalingService);
  protected readonly presence = inject(PresenceService);
  private readonly session = inject(SessionService);
  private readonly process = inject(ProcessWorkflowService);
  private readonly dialog = inject(DialogService);

  readonly moduleLabel = "LMS";
  /** Real branches this user may switch between (from /api/auth/me). */
  readonly branches = computed(() => this.auth.user()?.branches ?? []);
  /** Whether to show the switcher at all (more than one branch available). */
  readonly canSwitchBranch = computed(() => this.branches().length > 1);
  /** The route-guard context (same rule the guards + landing use). */
  private routeCtx(): RouteAccessCtx {
    return {
      hasAny: (p) => this.auth.hasAnyPermission(p),
      hasAnyEffective: (p) => this.auth.hasAnyEffectivePermission(p),
      isEnabled: (a) => this.process.isEnabled(a),
      isSuper: this.auth.permissions().includes("*"),
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
      moduleEnabled: (m) => this.entitlements.moduleEnabled(m),
    };
    return items.filter((i) => navItemVisible(i, ctx));
  };
  private navCtx(): WorkflowNavCtx {
    return {
      roles: this.auth.user()?.roles ?? [],
      // Effective = the route guards' check (mode-aware collect_sample), so a
      // work area never shows to someone its screen would bounce.
      hasAnyPermission: (p) => this.auth.hasAnyEffectivePermission(p),
      hasAnyRawPermission: (p) => this.auth.hasAnyPermission(p),
      isSuper: this.auth.permissions().includes("*"),
      moduleEnabled: (m) => this.entitlements.moduleEnabled(m),
    };
  }
  // The live nav is built from the active workflow's WORK-AREAS (the admin's
  // names + order, role-gated), each opening its REAL screen. Falls back to the
  // original PRIMARY_NAV when there's no usable workflow so nobody is locked out.
  /** Work areas the admin's workflow grants me, before design tweaks. */
  private readonly navAll = computed(() =>
    this.gateModules(
      this.withCollection(
        this.withInventory(
          // Expenses: a primary screen for anyone holding expense_* (same rule
          // as its route guard), placed after the lab work items.
          withInsights(
            withExpenses(
              this.visible(
                menusFromWorkflow(this.process.active(), this.navCtx()) ??
                  PRIMARY_NAV,
              ),
              (i) => this.visible([i]).length > 0,
            ),
            (i) => this.visible([i]).length > 0,
          ),
        ),
      ),
    ),
  );

  readonly primary = computed(() => {
    let items = withPrepare(this.navAll(), this.prepareItem());
    // NEW design: Messages is a chat surface (bar icon → panel + floating
    // windows), never a page — drop its work area from the nav.
    if (this.themeService.isNewDesign())
      items = items.filter((i) => !TopStripComponent.isMessagesItem(i));
    // OPD: doctors get "Consults"; anyone who can open at least one OPD area
    // gets the general "OPD" tab — both only while the OPD gate is open
    // (tenant explicitly entitled, or the owner's pf.opd() preview). OPD dark
    // build. "Can open an OPD area" reuses the hub's own rule (opdAreasFor).
    if (!this.opdGate.visible()) return items;
    const out = this.auth.isDoctor() ? [...items, DOCTOR_NAV] : items;
    return opdAreasFor((p) => this.auth.hasAnyPermission(p)).length
      ? [...out, OPD_NAV]
      : out;
  });

  /** Router-driven URL signal — the Angular `routerLinkActive` directive
   *  can't cross from '/opd' into '/admin/opd', and can't EXCLUDE the
   *  '/opd/consult' subtree from the general OPD tab, so the two OPD tabs'
   *  active state is computed manually (opdNavActive) from this instead. */
  private readonly currentUrl = signal("");
  private routerSub?: { unsubscribe(): void };
  /** Is `n` (OPD or Consults) the active tab for the current URL? */
  opdActive(n: NavItem): boolean {
    return opdNavActive(n, this.currentUrl());
  }

  /** NO-WORKFLOW FALLBACK ONLY: guarantee a reachable "Collect" for anyone who
   *  can draw samples when the tenant has no process workflow (PRIMARY_NAV).
   *  With a workflow active, Collect is the system Collect WORK AREA
   *  (menusFromWorkflow, normalised in for older workflows) — the nav follows
   *  the workflow, so this never adds a second Collect. Mirrors withInventory. */
  private withCollection(items: NavItem[]): NavItem[] {
    return withCollectionFallback(items, {
      hasWorkflow: !!this.process.active()?.categories?.length,
      canCollect: this.auth.hasEffectivePermission("collect_sample"),
      collectionEnabled: this.process.isEnabled("sample_collection"),
    });
  }

  /** The workflow-driven nav (menusFromWorkflow) is NOT module-gated, so drop
   *  work areas the tenant's plan doesn't include. Messages specifically must
   *  leave no nav trace when its module is off. */
  private gateModules(items: NavItem[]): NavItem[] {
    if (this.entitlements.moduleEnabled("messages")) return items;
    return items.filter((i) => i.href !== "/messages" && i.id !== "messages");
  }

  /** The workflow-derived nav is built from process categories and so never
   *  contains the Stores work area. Append it when the branch has inventory
   *  enabled and the user holds an inventory permission (idempotent — the
   *  PRIMARY_NAV fallback already includes it). */
  private withInventory(items: NavItem[]): NavItem[] {
    if (
      !this.entitlements.moduleEnabled("inventory") ||
      !this.labCfg.inventoryEnabled()
    )
      return items;
    if (items.some((i) => i.id === "stores" || i.href === "/stores"))
      return items;
    const inv = PRIMARY_NAV.find((i) => i.id === "stores");
    if (!inv || !this.auth.hasAnyPermission(inv.permissions ?? []))
      return items;
    return [...items, inv];
  }
  readonly more = computed(() => this.visible(MORE_NAV));

  /** Start menu (owner 2026-11-11): the PF logo opens it; the bar shows only the PINNED screens that fit.
   *  The bar is decided ONLY by layout/start-menu/nav-pins.ts (pins never grant access). */
  protected readonly navPrefs = inject(NavPrefsService);
  protected readonly startOpen = signal(false);
  /** Every screen this person can open from the bar: the work areas, then Settings (a normal pinnable item, id `admin`). */
  private readonly navAllItems = computed<NavItem[]>(() => [...this.primary(), ...(this.showAdmin() ? [ADMIN_NAV] : [])]);
  readonly navLayout = computed(() =>
    computeNavLayout({
      all: this.navAllItems(),
      more: this.more(),
      roleDefaults: this.navPrefs.roleDefaults(),
      userPins: this.navPrefs.pinned(),
      capacity: this.navPrefs.capacity(),
    }),
  );
  /** What the bar renders. */
  readonly bar = computed(() => this.navLayout().bar);
  protected readonly iconsOnly = this.navPrefs.iconsOnly;
  protected toggleStart(): void {
    const next = !this.startOpen();
    this.closeAll();
    this.startOpen.set(next);
  }

  /** Show the Admin icon-button (in the right cluster) only when the
   *  current user holds at least one manage_* permission. Mirrors the
   *  permission gate from ADMIN_NAV so admins still get one click to
   *  Admin, non-admins get a cleaner top-strip. */
  readonly showAdmin = computed(
    () =>
      !ADMIN_NAV.permissions ||
      this.auth.hasAnyPermission(ADMIN_NAV.permissions),
  );

  /** In-app branch switch (veil + zoom; no page reload). */
  protected readonly branchSwitch = inject(BranchSwitchService);
  /** The pill names the DESTINATION as soon as a switch starts, so the chip
   *  itself animates to the new branch while the screen re-scopes. */
  protected readonly branch = computed(
    () =>
      this.branchSwitch.target()?.name ??
      this.auth.activeBranch()?.name ??
      this.auth.user()?.branchName ??
      "Branch",
  );
  protected readonly activeBranchId = computed(() =>
    this.auth.activeBranchId(),
  );
  protected readonly branchOpen = signal(false);
  protected readonly moreOpen = signal(false);
  protected readonly profileOpen = signal(false);
  // Pulls from the shared service so branding saves reflect instantly.
  private readonly _tenant = this.tenantState.tenant;
  // Gate the brand pill on this so the "YOUR LOGO" placeholder doesn't
  // flash before the first /api/tenants/current resolves.
  readonly tenantLoaded = computed(
    () => this.tenantState.status() === "loaded",
  );

  readonly isDark = computed(() => this.themeService.isDark());
  readonly userName = () => this.auth.user()?.displayName || "User";
  /** The user's REAL role(s) for the profile header (was a hardcoded mock). */
  readonly userRoleLabel = () => {
    const u = this.auth.user();
    if (!u) return "";
    return u.roles?.length ? u.roles.join(" · ") : (u.tenantName ?? "");
  };
  // The stored logo may be a private "/uploads/…" file: shown through the
  // session (blob: URL) — a bare <img src> is refused by the API now.
  private readonly injector = inject(Injector);
  readonly tenantLogo = computed(() =>
    brandingSrc(this.injector, this._tenant()?.logoUrl),
  );
  readonly tenantName = computed(
    () =>
      this._tenant()?.name ||
      this.auth.user()?.tenantName ||
      "Your organization",
  );

  // Branding mode resolution. Default 'both' when unset so existing tenants
  // keep rendering what they already had. The name falls back to a
  // 10-char slice of the official name when the admin hasn't set an
  // explicit brandingName.
  private readonly _brandingMode = computed(
    () => this._tenant()?.brandingMode ?? "both",
  );
  readonly brandingName = computed(() => {
    const t = this._tenant();
    const explicit = t?.brandingName?.trim();
    if (explicit) return explicit;
    const full = t?.name?.trim();
    return full || null;
  });
  readonly showLogo = computed(() => {
    const m = this._brandingMode();
    return m === "logo" || m === "both";
  });
  readonly showName = computed(() => {
    const m = this._brandingMode();
    return m === "name" || m === "both";
  });
  readonly hasBrand = computed(() => {
    const logoOk = this.showLogo() && !!this._tenant()?.logoUrl;
    const nameOk = this.showName() && !!this.brandingName();
    return logoOk || nameOk;
  });
  readonly brandAriaLabel = computed(() => {
    if (!this.hasBrand()) return "Add your organization logo or name";
    return `${this.tenantName()} — branding`;
  });
  readonly tenantInitial = computed(() => {
    const name = this.brandingName() || this.tenantName();
    return name ? name[0].toUpperCase() : "?";
  });
  readonly initials = () => {
    const u = this.auth.user();
    const first = (u?.firstName || "").trim();
    const fathers = (u?.fathersName || "").trim();
    if (first || fathers) {
      return ((first[0] || "") + (fathers[0] || "")).toUpperCase() || "U";
    }
    const n = (u?.displayName || "").trim();
    return (
      n
        .split(/\s+/)
        .filter(Boolean)
        .map((p) => p[0])
        .join("")
        .slice(0, 2)
        .toUpperCase() || "U"
    );
  };

  ngOnInit() {
    this.tenantState.ensureLoaded();
    this.labCfg.ensureLoaded();
    this.entitlements.ensureLoaded();
    this.process.loadActive();
    this.currentUrl.set(this.router.url);
    this.routerSub = this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => { this.currentUrl.set(this.router.url); this.startOpen.set(false); });
  }
  ngOnDestroy() {
    this.routerSub?.unsubscribe();
  }

  toggleBranch() {
    if (!this.canSwitchBranch()) return;
    const next = !this.branchOpen();
    this.closeAll();
    this.branchOpen.set(next);
  }
  async selectBranch(b: BranchRef) {
    if (b.id === this.activeBranchId()) {
      this.branchOpen.set(false);
      return;
    }
    const ok = await this.dialog.confirm({
      title: "Switch active branch?",
      message: `Are you sure you want to switch the active branch to "${b.name}"?`,
      confirmLabel: "Yes, switch branch",
      cancelLabel: "Cancel",
      tone: "primary",
    });
    if (!ok) return;
    this.branchOpen.set(false);
    this.closeProfile();
    void this.branchSwitch.switchTo(b.id);
  }

  toggleMore() {
    const next = !this.moreOpen();
    this.closeAll();
    this.moreOpen.set(next);
  }
  closeMore() {
    this.moreOpen.set(false);
  }

  /** Phone-width bar (new design, nav at the bottom, < 768px): the PF logo is hidden and the PF badge in the
   *  avatar slot stands in for it, so that badge opens the Start menu (account lives in the menu's footer). */
  protected readonly compactBar = computed(
    () => this.themeService.isNewDesign() && this.themeService.bottomNav() && this.viewportW() < 768,
  );
  toggleProfile() {
    if (this.compactBar() && !this.profileOpen()) { this.toggleStart(); return; }
    const next = !this.profileOpen();
    this.closeAll();
    this.profileOpen.set(next);
  }
  /** "Account and status" from the Start menu footer (compact bar only). */
  protected openAccount(): void {
    this.closeAll();
    this.startOpen.set(false);
    this.profileOpen.set(true);
  }
  closeProfile() {
    this.profileOpen.set(false);
    this.statusListOpen.set(false);
  }

  /** Show the per-station Print settings entry only to people who actually
   *  print things — front desk (invoices), collection/lab (labels), reports. */
  canPrint(): boolean {
    return this.auth.hasAnyPermission([
      "create_order",
      "register_patient",
      "collect_sample",
      "enter_result",
      "deliver_report",
      "view_report",
      "manage_lab_settings",
    ]);
  }
  goPrinting() {
    this.closeProfile();
    this.router.navigate(["/printing"]);
  }
  goSignature() {
    this.closeProfile();
    this.router.navigate(["/signature"]);
  }
  /** Passkeys (beta `passkeys`: console switch + dev only). */
  private readonly beta = inject(BetaFeaturesService);
  protected passkeysOn(): boolean { return this.beta.enabled('passkeys'); }
  goPasskeys() {
    this.closeProfile();
    this.router.navigate(["/security"]);
  }

  // ── Presence status picker (Teams-style presets) ───────────────────
  protected readonly statusOptions = PRESENCE_OPTIONS;
  protected readonly statusListOpen = signal(false);
  protected readonly myStatusLabel = computed(() =>
    presenceLabel(this.presence.myStatus()),
  );
  toggleStatusList() {
    this.statusListOpen.update((v) => !v);
  }
  pickStatus(o: PresenceOption) {
    this.statusListOpen.set(false);
    void this.presence.setStatus(o.key);
  }

  async logout() {
    this.profileOpen.set(false);
    // The ONE ordered sign-out (SessionService): revoke → push → sockets →
    // timers / overlays / tenant caches → clear → /login (history replaced).
    await this.session.logout();
  }

  // ── Multi-account switching + PIN (shared lab machines) ───────────
  protected readonly otherAccounts = computed(() =>
    this.auth.accounts
      .accounts()
      .filter((a) => a.userId !== this.auth.user()?.id),
  );
  protected readonly hasPin = computed(() => !!this.auth.user()?.hasPin);

  private readonly pinDialog = inject(SetPinDialogService);

  accountInitials(a: StoredAccount): string {
    return this.auth.accounts.initials(a);
  }

  /** Hand off to the full-screen switch screen (Windows-style): leave this
   *  account's UI and meet the TARGET's PIN gate there. */
  openSwitch(a: StoredAccount) {
    this.closeProfile();
    this.lock.switchTarget.set(a);
  }

  /** Manual lock (also Ctrl+L / ⌘L). Only offered when a PIN can unlock it. */
  lockNow() {
    this.closeProfile();
    this.lock.lock();
  }

  /** Gmail-style "Add account": keep every session, sign in one more. */
  addAccount() {
    this.closeProfile();
    this.router.navigateByUrl("/login?add=1");
  }

  /** Set / change PIN: a real dialog (OPS-107), opened - and its first field focused - inside this tap. */
  openPinForm() {
    this.closeProfile();
    this.pinDialog.open();
  }

  private closeAll() {
    this.branchOpen.set(false);
    this.moreOpen.set(false);
    this.profileOpen.set(false);
    this.statusListOpen.set(false);
  }

  pickLanding() {
    return pickLanding({
      ...this.routeCtx(),
      moduleEnabled: (m) => this.entitlements.moduleEnabled(m),
      opdDoctor: this.auth.isDoctor() && this.opdGate.visible(),
      opdOnlyDoctor: isOpdOnly(this.auth.user()?.modules),
    });
  }

  @HostListener("document:click", ["$event"])
  onDocClick(ev: MouseEvent) {
    if (!this.branchOpen() && !this.moreOpen() && !this.profileOpen()) return;
    const inside = this.host.nativeElement.contains(ev.target as Node);
    if (!inside) this.closeAll();
  }

  @HostListener("document:keydown.escape")
  onEscape() {
    this.closeAll();
  }
}
