import { ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { BranchRef } from '../../core/auth/mock-user';
import { BranchLabConfigService } from '../../core/services/branch-lab-config.service';
import { TenantEntitlementsService } from '../../core/services/tenant-entitlements.service';
import { CapacitorService } from '../../core/services/capacitor.service';
import { TenantStateService } from '../../core/services/tenant-state.service';
import { ThemeService } from '../../core/services/theme.service';
import { NotificationBellComponent } from '../../shared/components/notification-bell/notification-bell.component';
import { DialogService } from '../../core/services/dialog.service';
import { ChatService } from '../../core/services/chat.service';
import { PeopleDrawerService } from '../../core/services/people-drawer.service';
import { SignalingService } from '../../core/services/signaling.service';
import { PresenceService } from '../../core/services/presence.service';
import { PRESENCE_OPTIONS, PresenceOption, presenceLabel } from '../../shared/models/presence.model';
import { PushService } from '../../core/services/push.service';
import { WebrtcService } from '../../core/services/webrtc.service';
import { PatientProfileService } from '../../core/services/patient-profile.service';
import { AppointmentBookingService } from '../../core/services/appointment-booking.service';
import { ADMIN_NAV, MORE_NAV, NavItem, PRIMARY_NAV, WorkflowNavCtx, menusFromWorkflow } from '../nav-items';
import { ProcessWorkflowService } from '../../core/services/process-workflow.service';
import { ScanService } from '../../core/services/scan.service';
import { ApiService } from '../../core/services/api.service';
import { LANDINGS } from '../../core/auth/landing.guard';

@Component({
  selector: 'pf-top-strip',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, NotificationBellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './top-strip.component.html',
  styleUrl: './top-strip.component.scss'
})
export class TopStripComponent implements OnInit, OnDestroy {
  protected readonly themeService = inject(ThemeService);
  // Public so the template can read isOnline / initialised signals.
  protected readonly capacitor = inject(CapacitorService);
  private readonly auth = inject(AuthService);
  private readonly tenantState = inject(TenantStateService);
  private readonly labCfg = inject(BranchLabConfigService);
  private readonly entitlements = inject(TenantEntitlementsService);
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly chat = inject(ChatService);
  protected readonly signaling = inject(SignalingService);
  protected readonly peopleDrawer = inject(PeopleDrawerService);
  protected readonly presence = inject(PresenceService);
  private readonly push = inject(PushService);
  private readonly webrtc = inject(WebrtcService);
  private readonly patientProfile = inject(PatientProfileService);
  private readonly appointmentBooking = inject(AppointmentBookingService);
  private readonly process = inject(ProcessWorkflowService);
  protected readonly scan = inject(ScanService);
  private readonly api = inject(ApiService);
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
  readonly primary = computed(() => this.gateModules(this.withInventory(menusFromWorkflow(this.process.active(), this.navCtx()) ?? this.visible(PRIMARY_NAV))));

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

  /** Global "scan an order QR" — for staff who can collect, whenever collection
   *  is enabled in the workflow. */
  readonly canScan = computed(() =>
    this.process.isEnabled('sample_collection') && this.auth.hasPermission('collect_sample'));
  /** The People drawer (tenant contacts + 1:1 chat + calls) is part of the
   *  Messages capability, so hide its nav button when the Messages work-area
   *  is disabled in the active workflow — mirrors the Messages screen going away. */
  readonly canMessages = computed(() => this.process.isEnabled('messages') && this.entitlements.moduleEnabled('messages'));
  /** A scanned QR / barcode → open the patient (ID-card QR) or the order. */
  onScanOrder(code: string) {
    this.scan.close();
    // Patient ID-card QR encodes `…/p/<guid>` (see PatientIdCardComponent). Match
    // it first and jump straight to the patient — no server round-trip needed.
    const pm = code.match(/\/p\/([0-9a-fA-F-]{36})/);
    if (pm) { this.router.navigate(['/frontdesk/patients', pm[1]]); return; }
    this.api.get<{ orderId: string }>(`/api/orders/resolve?code=${encodeURIComponent(code)}`).subscribe({
      next: r => { if (r?.orderId) this.router.navigate(['/o', r.orderId]); },
      error: () => { /* no match — silently ignore */ }
    });
  }
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