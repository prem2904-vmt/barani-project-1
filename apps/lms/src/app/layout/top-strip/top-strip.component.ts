import { ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { PeopleDrawerService } from '../../core/services/people-drawer.service';
import { ChatWindowsService } from '../../core/services/chat-windows.service';
import { DirectoryService, DirectoryUser } from '../../core/services/directory.service';
import { MessagesPanelService } from '../../core/services/messages-panel.service';
import { conversationInitials, conversationTitle } from '../../shared/models/conversation-name';
import { Conversation } from '../../shared/models/chat.model';
import { DraftShelfService } from '../../core/services/draft-shelf.service';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/auth/auth.service';
import { ModuleScopeService } from '../../core/services/module-scope.service';
import { StoredAccount } from '../../core/auth/accounts.service';
import { LockService } from '../../core/auth/lock.service';
import { BranchRef } from '../../core/auth/mock-user';
import { BranchLabConfigService } from '../../core/services/branch-lab-config.service';
import { TenantEntitlementsService } from '../../core/services/tenant-entitlements.service';
import { CapacitorService } from '../../core/services/capacitor.service';
import { TenantStateService } from '../../core/services/tenant-state.service';
import { ThemeService } from '../../core/services/theme.service';
import { DesignModeService } from '../../core/services/design-mode.service';
import { NotificationBellComponent } from '../../shared/components/notification-bell/notification-bell.component';
import { DialogService } from '../../core/services/dialog.service';
import { ChatService } from '../../core/services/chat.service';
import { SignalingService } from '../../core/services/signaling.service';
import { PresenceService } from '../../core/services/presence.service';
import { PRESENCE_OPTIONS, PresenceOption, presenceLabel } from '../../shared/models/presence.model';
import { PushService } from '../../core/services/push.service';
import { WebrtcService } from '../../core/services/webrtc.service';
import { PatientProfileService } from '../../core/services/patient-profile.service';
import { AppointmentBookingService } from '../../core/services/appointment-booking.service';
import { DOCTOR_NAV, ADMIN_NAV, MORE_NAV, NavItem, PRIMARY_NAV, WorkflowNavCtx, menusFromWorkflow } from '../nav-items';
import { ProcessWorkflowService } from '../../core/services/process-workflow.service';
import { LANDINGS } from '../../core/auth/landing.guard';

@Component({
  selector: 'pf-top-strip',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, FormsModule, NotificationBellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './top-strip.component.html',
  styleUrl: './top-strip.component.scss'
})
export class TopStripComponent implements OnInit, OnDestroy {
  protected readonly themeService = inject(ThemeService);
  /** Bottom-bar draft shelf (published by the active work screen). */
  protected readonly draftShelf = inject(DraftShelfService);
  readonly draftsOpen = signal(false);
  protected readonly designMode = inject(DesignModeService);
  // Public so the template can read isOnline / initialised signals.
  protected readonly capacitor = inject(CapacitorService);
  private readonly auth = inject(AuthService);
  private readonly moduleScope = inject(ModuleScopeService);
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
  readonly msgQuery = signal('');

  /** Everyone in the tenant I can start a chat with, minus the people I
   *  already have a 1:1 thread with (those show under Recent). */
  readonly msgPeople = computed(() => {
    const q = this.msgQuery().trim().toLowerCase();
    const inThreads = new Set(this.chat.conversations()
      .filter(c => !c.isGroup)
      .flatMap(c => c.participants?.map(p => p.displayName.toLowerCase()) ?? []));
    return this.directory.others()
      .filter(u => !inThreads.has(u.displayName.toLowerCase()))
      .filter(u => !q || u.displayName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  });

  /** Existing conversations, filtered by the same query. */
  readonly msgConversations = computed(() => {
    const q = this.msgQuery().trim().toLowerCase();
    const list = this.chat.conversations();
    return q ? list.filter(c => this.convoTitle(c).toLowerCase().includes(q)) : list;
  });

  /** Initials for a directory person — same rule as conversations. */
  personInitials(u: DirectoryUser): string {
    const words = (u.displayName || '?').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    const first = words[0][0] ?? '';
    const last = words.length > 1 ? (words[words.length - 1][0] ?? '') : '';
    return (first + last).toUpperCase() || '?';
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
    } catch { /* toast already surfaced by the API layer */ }
  }

  /** Open the Messages panel and make sure the people list is loaded. */
  toggleMsgs(): void {
    this.msgsPanel.toggle();
    if (this.msgsPanel.open()) void this.directory.load();
  }

  private readonly chatWindows = inject(ChatWindowsService);
  private meId(): string { return this.auth.user()?.authId ?? this.auth.user()?.id ?? ''; }

  /** Shared with the floating windows so both label a thread identically. */
  convoTitle(c: Conversation): string { return conversationTitle(c, this.meId()); }
  convoInitials(c: Conversation): string { return conversationInitials(c, this.meId()); }

  /**
   * Open a conversation. Desktop/tablet in the new design get a floating
   * Messenger-style WINDOW (several at once); phones — where a 330px
   * window has nowhere to live — fall back to the people drawer.
   * Either way the bar keeps a chip for the thread.
   */
  openConvo(c: Conversation): void {
    this.msgsPanel.close();
    if (this.themeService.isNewDesign()) {
      // NEW design has no Messages SCREEN — chat lives in floating
      // windows only (phones get a single full-width one).
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
  readonly messagesModuleOn = computed(() =>
    this.navAll().some(i => i.id === 'messages') && this.process.isEnabled('messages'));
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly chat = inject(ChatService);
  protected readonly signaling = inject(SignalingService);
  protected readonly presence = inject(PresenceService);
  private readonly push = inject(PushService);
  private readonly webrtc = inject(WebrtcService);
  private readonly patientProfile = inject(PatientProfileService);
  private readonly appointmentBooking = inject(AppointmentBookingService);
  private readonly process = inject(ProcessWorkflowService);
  private readonly dialog = inject(DialogService);

  readonly moduleLabel = 'LMS';
  /** Real branches this user may switch between (from /api/auth/me). */
  readonly branches = computed(() => this.auth.user()?.branches ?? []);
  /** Whether to show the switcher at all (more than one branch available). */
  readonly canSwitchBranch = computed(() => this.branches().length > 1);
  private readonly visible = (items: NavItem[]): NavItem[] => {
    const cMode = this.labCfg.collectionMode();
    const bMode = this.labCfg.billingMode();
    return items.filter(i => {
      if (i.permissions?.length && !this.auth.hasAnyPermission(i.permissions)) return false;
      if (i.collectionModes && !i.collectionModes.includes(cMode)) return false;
      if (i.billingModes && !i.billingModes.includes(bMode)) return false;
      // Inventory work area only appears when the branch has it enabled.
      if (i.requiresInventory && !this.labCfg.inventoryEnabled()) return false;
      // Product-module entitlement: hide a whole work area the tenant's plan
      // doesn't include (inventory / messages / home collection / reports).
      if (i.module && !this.entitlements.moduleEnabled(i.module)) return false;
      // Workflow source-of-truth: hide a nav item whose action the admin
      // switched off in /admin/process (the screen itself is unchanged).
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
  // The live nav is built from the active workflow's WORK-AREAS (the admin's
  // names + order, role-gated), each opening its REAL screen. Falls back to the
  // original PRIMARY_NAV when there's no usable workflow so nobody is locked out.
  /** Work areas the admin's workflow grants me, before design tweaks. */
  private readonly navAll = computed(() => this.gateModules(this.withCollection(
    this.withInventory(this.visible(menusFromWorkflow(this.process.active(), this.navCtx()) ?? PRIMARY_NAV)))));

  readonly primary = computed(() => {
    let items = this.navAll();
    // NEW design: Messages is a chat surface (bar icon -> drawer), not a page.
    if (this.themeService.isNewDesign()) items = items.filter(i => i.id !== 'messages');
    // OPD: doctors get their Consult Room — but only once the OPD module is
    // actually usable (tenant entitlement, or the dev preview flag). Keeps the
    // in-progress consult build invisible on shared environments.
    return this.auth.isDoctor() && this.moduleScope.opdUsable() ? [...items, DOCTOR_NAV] : items;
  });

  /** Guarantee a reachable "Collect" work area for anyone who can draw samples.
   *  The Lab work area intentionally excludes collect_sample, and the
   *  workflow-derived nav only shows Collect if an admin placed it — so lab-side
   *  collectors were left with no way to collect (it only appeared at front-desk
   *  or the dedicated counter). Append it (mode-independent) when the user holds
   *  collect_sample and no collection surface is already visible. Mirrors
   *  withInventory. */
  private withCollection(items: NavItem[]): NavItem[] {
    if (!this.auth.hasEffectivePermission('collect_sample')) return items;
    if (!this.process.isEnabled('sample_collection')) return items;
    if (items.some(i => i.id === 'sample-collection' || i.id === 'queue'
                     || i.href === '/sample-collection' || i.href === '/frontdesk/queue')) return items;
    const collect = PRIMARY_NAV.find(i => i.id === 'sample-collection');
    return collect ? [...items, collect] : items;
  }

  /** The workflow-driven nav (menusFromWorkflow) is NOT module-gated, so drop
   *  work areas the tenant's plan doesn't include. Messages specifically must
   *  leave no nav trace when its module is off. */
  private gateModules(items: NavItem[]): NavItem[] {
    if (this.entitlements.moduleEnabled('messages')) return items;
    return items.filter(i => i.href !== '/messages' && i.id !== 'messages');
  }

  /** The workflow-derived nav is built from process categories and so never
   *  contains the Stores work area. Append it when the branch has inventory
   *  enabled and the user holds an inventory permission (idempotent — the
   *  PRIMARY_NAV fallback already includes it). */
  private withInventory(items: NavItem[]): NavItem[] {
    if (!this.entitlements.moduleEnabled('inventory') || !this.labCfg.inventoryEnabled()) return items;
    if (items.some(i => i.id === 'stores' || i.href === '/stores')) return items;
    const inv = PRIMARY_NAV.find(i => i.id === 'stores');
    if (!inv || !this.auth.hasAnyPermission(inv.permissions ?? [])) return items;
    return [...items, inv];
  }
  readonly more = computed(() => this.visible(MORE_NAV));

  /** Show the Admin icon-button (in the right cluster) only when the
   *  current user holds at least one manage_* permission. Mirrors the
   *  permission gate from ADMIN_NAV so admins still get one click to
   *  Admin, non-admins get a cleaner top-strip. */
  readonly showAdmin = computed(() =>
    !ADMIN_NAV.permissions || this.auth.hasAnyPermission(ADMIN_NAV.permissions)
  );

  protected readonly branch = computed(() =>
    this.auth.activeBranch()?.name ?? this.auth.user()?.branchName ?? 'Branch');
  protected readonly activeBranchId = computed(() => this.auth.activeBranchId());
  protected readonly branchOpen = signal(false);
  protected readonly moreOpen = signal(false);
  protected readonly profileOpen = signal(false);
  // Pulls from the shared service so branding saves reflect instantly.
  private readonly _tenant = this.tenantState.tenant;
  // Gate the brand pill on this so the "YOUR LOGO" placeholder doesn't
  // flash before the first /api/tenants/current resolves.
  readonly tenantLoaded = computed(() => this.tenantState.status() === 'loaded');

  readonly isDark = computed(() => this.themeService.isDark());
  readonly userName = () => this.auth.user()?.displayName || 'User';
  /** The user's REAL role(s) for the profile header (was a hardcoded mock). */
  readonly userRoleLabel = () => {
    const u = this.auth.user();
    if (!u) return '';
    return u.roles?.length ? u.roles.join(' · ') : (u.tenantName ?? '');
  };
  readonly tenantLogo = computed(() => this._tenant()?.logoUrl || null);
  readonly tenantName = computed(() => this._tenant()?.name || this.auth.user()?.tenantName || 'Your organization');

  // Branding mode resolution. Default 'both' when unset so existing tenants
  // keep rendering what they already had. The name falls back to a
  // 10-char slice of the official name when the admin hasn't set an
  // explicit brandingName.
  private readonly _brandingMode = computed(() => this._tenant()?.brandingMode ?? 'both');
  readonly brandingName = computed(() => {
    const t = this._tenant();
    const explicit = t?.brandingName?.trim();
    if (explicit) return explicit;
    const full = t?.name?.trim();
    return full || null;
  });
  readonly showLogo = computed(() => {
    const m = this._brandingMode();
    return m === 'logo' || m === 'both';
  });
  readonly showName = computed(() => {
    const m = this._brandingMode();
    return m === 'name' || m === 'both';
  });
  readonly hasBrand = computed(() => {
    const logoOk = this.showLogo() && !!this.tenantLogo();
    const nameOk = this.showName() && !!this.brandingName();
    return logoOk || nameOk;
  });
  readonly brandAriaLabel = computed(() => {
    if (!this.hasBrand()) return 'Add your organization logo or name';
    return `${this.tenantName()} — branding`;
  });
  readonly tenantInitial = computed(() => {
    const name = this.brandingName() || this.tenantName();
    return name ? name[0].toUpperCase() : '?';
  });
  readonly initials = () => {
    const u = this.auth.user();
    const first = (u?.firstName || '').trim();
    const fathers = (u?.fathersName || '').trim();
    if (first || fathers) {
      return ((first[0] || '') + (fathers[0] || '')).toUpperCase() || 'U';
    }
    const n = (u?.displayName || '').trim();
    return n.split(/\s+/).filter(Boolean).map(p => p[0]).join('').slice(0, 2).toUpperCase() || 'U';
  };

  ngOnInit() {
    this.tenantState.ensureLoaded();
    this.labCfg.ensureLoaded();
    this.entitlements.ensureLoaded();
    this.process.loadActive();
  }
  ngOnDestroy() { /* no-op */ }

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
      title: 'Switch active branch?',
      message: `Are you sure you want to switch the active branch to "${b.name}"?`,
      confirmLabel: 'Yes, switch branch',
      cancelLabel: 'Cancel',
      tone: 'primary'
    });
    if (!ok) return;
    this.branchOpen.set(false);
    this.auth.setActiveBranch(b.id);
  }

  toggleMore() {
    const next = !this.moreOpen();
    this.closeAll();
    this.moreOpen.set(next);
  }
  closeMore() { this.moreOpen.set(false); }

  toggleProfile() {
    const next = !this.profileOpen();
    this.closeAll();
    this.profileOpen.set(next);
  }
  closeProfile() { this.profileOpen.set(false); this.statusListOpen.set(false); }

  /** Show the per-station Print settings entry only to people who actually
   *  print things — front desk (invoices), collection/lab (labels), reports. */
  canPrint(): boolean {
    return this.auth.hasAnyPermission([
      'create_order', 'register_patient', 'collect_sample',
      'enter_result', 'deliver_report', 'view_report', 'manage_lab_settings',
    ]);
  }
  goPrinting() { this.closeProfile(); this.router.navigate(['/printing']); }
  goSignature() { this.closeProfile(); this.router.navigate(['/signature']); }

  // ── Presence status picker (Teams-style presets) ───────────────────
  protected readonly statusOptions = PRESENCE_OPTIONS;
  protected readonly statusListOpen = signal(false);
  protected readonly myStatusLabel = computed(() => presenceLabel(this.presence.myStatus()));
  toggleStatusList() { this.statusListOpen.update(v => !v); }
  pickStatus(o: PresenceOption) {
    this.statusListOpen.set(false);
    void this.presence.setStatus(o.key);
  }

  async logout() {
    this.profileOpen.set(false);
    
    // ── (1) Unregister push notifications ──────────────────────────
    await this.push.unregister().catch(() => undefined);

    // ── (2) Disconnect realtime hubs ───────────────────────────────
    await this.chat.disconnect().catch(() => undefined);
    await this.signaling.disconnect().catch(() => undefined);

    // ── (3) Reset WebRTC ───────────────────────────────────────────
    this.webrtc.reset();

    // ── (4) Close open modals/modeless overlays ─────────────────────
    this.patientProfile.close();
    this.appointmentBooking.close();

    // ── (5) Reset cached tenant/config data ────────────────────────
    this.tenantState.reset();
    this.labCfg.reset();
    this.entitlements.reset();

    // ── (6) Final auth sign-out + redirect ─────────────────────────
    await this.auth.signOut();
    this.router.navigateByUrl('/login');
  }

  // ── Multi-account switching + PIN (shared lab machines) ───────────
  protected readonly otherAccounts = computed(() =>
    this.auth.accounts.accounts().filter(a => a.userId !== this.auth.user()?.id));
  protected readonly hasPin = computed(() => !!this.auth.user()?.hasPin);

  protected readonly pinFormOpen = signal(false);
  protected pinCurrent = '';
  protected pinNew = '';
  protected readonly pinBusy = signal(false);
  protected readonly pinError = signal<string | null>(null);
  protected readonly pinSaved = signal(false);

  accountInitials(a: StoredAccount): string { return this.auth.accounts.initials(a); }

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
    this.router.navigateByUrl('/login?add=1');
  }

  openPinForm() {
    this.pinFormOpen.set(true);
    this.pinCurrent = '';
    this.pinNew = '';
    this.pinError.set(null);
    this.pinSaved.set(false);
  }
  closePinForm() { this.pinFormOpen.set(false); }

  /** PIN fields accept digits only, capped at 4 (iPhone-style). */
  sanitizePin(v: string): string { return (v ?? '').replace(/\D/g, '').slice(0, 4); }

  async savePin() {
    if (this.pinBusy() || !/^\d{4}$/.test(this.pinNew)) { this.pinError.set('PIN must be exactly 4 digits.'); return; }
    this.pinBusy.set(true);
    this.pinError.set(null);
    try {
      await this.auth.setPin(this.pinNew, this.hasPin() ? this.pinCurrent : undefined);
      this.pinSaved.set(true);
      setTimeout(() => { this.closePinForm(); }, 900);
    } catch (e) {
      this.pinError.set((e as Error).message || 'Could not update the PIN.');
    } finally {
      this.pinBusy.set(false);
    }
  }

  private closeAll() {
    this.branchOpen.set(false);
    this.moreOpen.set(false);
    this.profileOpen.set(false);
    this.statusListOpen.set(false);
  }

  pickLanding() {
    const landingPages = LANDINGS;
    for (const { perm, path } of landingPages) {
      if (this.auth.hasPermission(perm)) {
        return path;
      }
    }
    return '/403';
  }

  @HostListener('document:click', ['$event'])
  onDocClick(ev: MouseEvent) {
    if (!this.branchOpen() && !this.moreOpen() && !this.profileOpen()) return;
    const inside = this.host.nativeElement.contains(ev.target as Node);
    if (!inside) this.closeAll();
  }

  @HostListener('document:keydown.escape')
  onEscape() { this.closeAll(); }
}