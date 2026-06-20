import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { BranchLabConfigService } from '../../core/services/branch-lab-config.service';
import { LogoMarkComponent } from '../../shared/primitives/logo-mark.component';

interface NavLink {
  label: string;
  href: string;
  icon: string;
  /** Permission codes — link visible if the user holds ANY of these. */
  perms: string[];
  /**
   * When true, perm check uses `hasEffectivePermission`, which honours
   * branch-lab-config suppression (e.g. Receptionist loses collect_sample
   * in dedicated-counter mode without a DB role change).
   */
  effective?: boolean;
  /** Optional extra predicate (e.g. only when collection_mode is dedicated). */
  visible?: () => boolean;
}
interface NavSection {
  title: string;
  links: NavLink[];
}

const ADMIN_PERMS = ['manage_tests', 'manage_users', 'manage_workflows', 'manage_branches', 'manage_tenant', 'manage_lab_settings'];

@Component({
  selector: 'pf-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, LogoMarkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="hidden md:flex flex-col w-60 shrink-0 text-white"
           style="background: var(--gradient-primary);">
      <a [routerLink]="homeHref()" class="flex items-center gap-2 px-5 h-16"
         style="border-bottom: 1px solid rgba(255, 255, 255, 0.12);">
        <pf-logo-mark size="sm" variant="mono"></pf-logo-mark>
        <span class="font-semibold tracking-tight">Prefrontal · Lab Management System</span>
      </a>
      <nav class="flex-1 overflow-y-auto py-4">
        @if (!labCfg.loaded()) {
          <!-- Skeleton: branch-lab config gates which links render (billing /
               sample collection sections depend on the active mode). Show a
               muted placeholder while it loads instead of flashing the wrong
               item set then reshuffling. -->
          @for (n of skeletonSections; track n) {
            <div class="px-3 mb-4 pf-skel">
              <div class="h-2.5 rounded mx-3 mb-2" style="width: 56px; background: rgba(255,255,255,0.1);"></div>
              <ul class="flex flex-col gap-1.5">
                @for (m of skeletonLinks; track m) {
                  <li class="h-8 rounded-lg mx-0" style="background: rgba(255,255,255,0.06);"></li>
                }
              </ul>
            </div>
          }
        } @else {
          @for (section of visibleSections(); track section.title) {
            <div class="px-3 mb-4">
              <p class="text-[11px] uppercase tracking-wider text-white/40 px-3 mb-1.5">{{ section.title }}</p>
              <ul class="flex flex-col gap-0.5">
                @for (link of section.links; track link.href) {
                  <li>
                    <a [routerLink]="link.href"
                       routerLinkActive="bg-white/10"
                       [routerLinkActiveOptions]="{ exact: link.href === '/admin' }"
                       class="flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-white/5 transition">
                      <span class="opacity-80">{{ link.icon }}</span>
                      <span>{{ link.label }}</span>
                    </a>
                  </li>
                }
              </ul>
            </div>
          }
        }
      </nav>
      <div class="px-5 py-3 border-t border-white/10 text-[11px] text-white/40">
        v0.1.0 · {{ auth.user()?.displayName || 'guest' }}
      </div>
    </aside>
  `,
  styles: [`
    /* Pulse animation for the skeleton bars while branch-lab config loads. */
    .pf-skel { animation: pf-skel-pulse 1.4s ease-in-out infinite; }
    @keyframes pf-skel-pulse {
      0%, 100% { opacity: 0.55; }
      50%      { opacity: 0.95; }
    }
  `]
})
export class SidebarComponent {
  protected readonly auth = inject(AuthService);
  protected readonly labCfg = inject(BranchLabConfigService);
  // Static placeholder counts for the skeleton — picked to match the average
  // sidebar shape so the layout doesn't jump when real items render.
  protected readonly skeletonSections = [0, 1, 2, 3];
  protected readonly skeletonLinks = [0, 1, 2];

  constructor() {
    // Sidebar mounts in the shell so it's the earliest place we can prime the
    // branch-lab config. Other components that read collection/billing mode
    // benefit from the cached value.
    this.labCfg.ensureLoaded();
  }

  // Each link declares what permission lets the user see it. `perms: ['*']`
  // means "any authenticated user" — currently unused, kept for future
  // public-to-staff items.
  private readonly sections: NavSection[] = [
    {
      title: 'Admin',
      links: [
        { label: 'Dashboard',         href: '/admin',                icon: '🏠', perms: ADMIN_PERMS },
        { label: 'Users & Access',    href: '/admin/users',          icon: '👥', perms: ['manage_users'] },
        { label: 'Tests',             href: '/admin/tests',          icon: '🧪', perms: ['manage_tests'] },
        { label: 'Branches',          href: '/admin/branches',       icon: '🏢', perms: ['manage_branches'] },
        { label: 'Lab Settings',      href: '/admin/lab-settings',   icon: '⚙️', perms: ['manage_lab_settings', 'manage_branches'] },
        { label: 'Billing Config',    href: '/admin/billing',        icon: '💳', perms: ['manage_branches', 'manage_tenant'] },
        { label: 'Report Template',   href: '/admin/reports',        icon: '📄', perms: ['manage_tests'] },
        { label: 'Notifications',     href: '/admin/notifications',  icon: '🔔', perms: ['manage_tenant', 'manage_branches'] },
        { label: 'Workflows',         href: '/admin/workflows',      icon: '🔧', perms: ['manage_workflows'] },
        { label: 'KPI cards',         href: '/admin/kpis',           icon: '📊', perms: ['manage_tenant', 'manage_branches'] },
        { label: 'Vendor Wallets',    href: '/admin/vendors',        icon: '💼', perms: ['manage_tenant'] },
        // Catalog + per-test BOM config (distinct from the operational Stores desk below).
        { label: 'Inventory Catalog', href: '/admin/inventory',      icon: '📦', perms: ['manage_inventory'] }
      ]
    },
    {
      title: 'Front Desk',
      links: [
        { label: 'Today',             href: '/frontdesk',            icon: '🧑‍💼', perms: ['register_patient', 'view_patient', 'create_order'] },
        { label: 'Create Order',      href: '/frontdesk/order',      icon: '➕', perms: ['create_order'] },
        // Front-desk billing is only relevant when billing is owned by FD —
        // the dedicated counter has its own /billing-counter entry below.
        { label: 'Billing',           href: '/frontdesk/billing',    icon: '🧾',
          perms: ['create_bill', 'collect_payment'],
          visible: () => this.labCfg.billingMode() === 'front_desk' }
      ]
    },
    {
      title: 'Billing Counter',
      links: [
        { label: 'Counter',           href: '/billing-counter',      icon: '🧾',
          perms: ['create_bill', 'collect_payment'],
          visible: () => this.labCfg.billingMode() === 'separate_counter' }
      ]
    },
    {
      title: 'Sample Collection',
      links: [
        { label: 'Collection Counter', href: '/sample-collection',   icon: '🧫',
          perms: ['collect_sample'],
          // `effective` so a Receptionist who still has the seeded
          // collect_sample perm doesn't see this link in dedicated-counter
          // mode — the dedicated counter owns sample collection there.
          effective: true,
          visible: () => this.labCfg.collectionMode() === 'dedicated_counter' }
      ]
    },
    {
      title: 'Lab',
      links: [
        // Lab intake (Receive Samples) is now a tab inside My Work — no
        // separate sidebar link to avoid duplicating the entry. The route
        // /lab/receive still works for direct navigation / bookmarks.
        { label: 'My Work',           href: '/lab/my-work',          icon: '🎯', perms: ['enter_result', 'edit_result', 'receive_sample'] },
        // Inline lab collection point — only when collection is owned by lab
        // (front_desk mode); dedicated counter mode uses /sample-collection.
        { label: 'Sample Collection', href: '/lab/collect',          icon: '🧫',
          perms: ['collect_sample'],
          visible: () => this.labCfg.collectionMode() === 'front_desk' }
      ]
    },
    {
      // Operational stock desk — scan-first receive / issue / count. A first-class
      // work area like Front Desk and Lab (its own home hub picks the mode).
      title: 'Inventory',
      links: [
        { label: 'Stores',            href: '/stores',               icon: '📦',
          perms: ['inventory_receive', 'inventory_issue', 'inventory_count', 'manage_inventory'] }
      ]
    },
    {
      title: 'Pathologist',
      links: [
        { label: 'Pending Validation', href: '/pathologist',         icon: '✅', perms: ['validate_result'] }
      ]
    },
    {
      title: 'Reports',
      links: [
        { label: 'Report Queue',      href: '/reports',              icon: '📤', perms: ['deliver_report'] }
      ]
    },
    {
      title: 'Operations',
      links: [
        { label: 'TAT Dashboard',     href: '/dashboard',            icon: '📊', perms: ['view_tat_dashboard', 'view_dashboard'] }
      ]
    },
    {
      // Teams-style chat + group calling. Open to every authenticated user
      // (any role in the tenant can message colleagues).
      title: 'Workspace',
      links: [
        { label: 'Messages',          href: '/messages',             icon: '💬', perms: ['*'] }
      ]
    }
  ];

  // Filter sections + links by the current user's permissions. Wildcard ('*')
  // permission shows everything (admin convenience). A section with no
  // visible links is hidden entirely so we don't render empty headers.
  protected readonly visibleSections = computed<NavSection[]>(() => {
    const perms = this.auth.user()?.permissions ?? [];
    const isAdmin = perms.includes('*');
    return this.sections
      .map(s => ({
        ...s,
        links: s.links.filter(l => {
          if (l.visible && !l.visible()) return false;
          // `perms: ['*']` on a link = "every authenticated user". Distinct
          // from the user holding the `'*'` (super-admin) permission.
          if (l.perms.length === 1 && l.perms[0] === '*') return true;
          if (isAdmin) return true;
          // `effective: true` runs through hasEffectivePermission so that
          // mode-aware suppressions (e.g. Receptionist loses collect_sample
          // when collection_mode = dedicated_counter) are respected here too.
          if (l.effective) return l.perms.some(p => this.auth.hasEffectivePermission(p));
          return l.perms.some(p => perms.includes(p));
        })
      }))
      .filter(s => s.links.length > 0);
  });

  // Header logo points wherever the user actually has access — admins go to
  // /admin, everyone else to the first link in their first visible section.
  protected readonly homeHref = computed<string>(() => {
    const sections = this.visibleSections();
    return sections[0]?.links[0]?.href ?? '/login';
  });
}
