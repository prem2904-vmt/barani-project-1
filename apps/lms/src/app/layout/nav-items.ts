import { ProcessWorkflowConfig, catalogFor, normalizeWorkflow, workAreaIconPath, workAreaRoute } from '../shared/models/process-workflow.model';
import { ModuleKey } from '../core/services/tenant-entitlements.service';
import { ADMIN_PERMS, ROUTE_ACCESS, RouteAccessCtx, canOpenRoute, routeAccess, routePerms } from '../core/auth/route-access';

export { FRONTDESK_PERMS } from '../core/auth/route-access';

export interface NavItem {
  id: string;
  label: string;
  href: string;
  exact?: boolean;
  iconPath: string[];
  /**
   * OR-semantics: user needs at least one of these permission codes to see
   * the item. Undefined / empty means always visible to any authenticated
   * user. `*` is honoured by hasPermission so a super-admin sees everything.
   */
  permissions?: string[];
  /**
   * Only render when the current branch's collection_mode matches one of
   * these. Undefined = always eligible regardless of mode.
   */
  collectionModes?: Array<'front_desk' | 'dedicated_counter'>;
  /**
   * Only render when the current branch's billing_mode matches one of these.
   * Used by the Billing Counter nav item which only exists when billing
   * happens at a separate counter.
   */
  billingModes?: Array<'front_desk' | 'separate_counter'>;
  /**
   * The process-workflow action this nav item represents. When the admin
   * disables that action in /admin/process, the nav item is hidden (the item
   * still points at its ORIGINAL screen — we only show/hide it). Omit for items
   * that aren't a single workflow action (e.g. the Frontdesk home, which hosts
   * several actions as components gated inside the screen).
   */
  action?: string;
  /**
   * Only render when the current branch has the inventory module enabled
   * (BranchLabConfig.inventoryEnabled). Used by the Stores entry so the
   * admin toggle in Lab Settings actually surfaces / hides the work area.
   */
  requiresInventory?: boolean;
  /**
   * Only render when the tenant is entitled to this product module
   * (TenantEntitlementsService.moduleEnabled). Gates whole work areas
   * (inventory / messages / home collection / reports) that a tenant's plan
   * may not include. AND-ed with the other visibility checks.
   */
  module?: ModuleKey;
}

// Admin is intentionally NOT in the primary nav anymore — it's a
// settings destination, not a workflow. It now lives as an icon
// button in the top-strip's right cluster (next to the bell) so it
// reads as "configure the app" rather than "one of the modules".
// Non-admin users (no manage_* permission) no longer see it at all.
/** OPD Consult Room — shown only to users flagged isDoctor (DoctorProfile).
 *  Appended by the nav shells rather than permission-gated: "is a doctor" is
 *  profile state, not a permission code. */
export const DOCTOR_NAV: NavItem = {
  id: 'doctor',
  label: 'Consults',
  href: '/doctor',
  iconPath: ['M11 2v2', 'M5 2v2', 'M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1',
             'M8 15a6 6 0 0 0 12 0v-3', 'M20 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z']
};

export const ADMIN_NAV: NavItem = {
  id: 'admin',
  label: 'Settings',
  href: '/admin',
  iconPath: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
             'M19.4 15a1.6 1.6 0 0 0 .3 1.7l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.7-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.7.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.7 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.7.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.7-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.7V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z'],
  permissions: ADMIN_PERMS
};

/** Route → the permissions its own guard checks, derived from ROUTE_ACCESS
 *  (core/auth/route-access.ts) — THE single route-access table shared by the
 *  route guards (app.routes.ts routeGuards), every nav surface and the landing
 *  redirect. Kept as a flat map for existing callers. */
export const ROUTE_NAV_PERMS: Record<string, string[]> = Object.fromEntries(
  Object.entries(ROUTE_ACCESS).map(([route, acc]) => [route, acc.perms ?? []]));

/** Stamp every nav item with its destination route's OWN guard permissions
 *  (ROUTE_ACCESS) — nav items never carry a hand-written permission list, so they
 *  can't drift from the guard. Routes absent from the table stay ungated here. */
function withRoutePerms(items: NavItem[]): NavItem[] {
  return items.map(i => {
    const perms = routePerms(i.href);
    return perms.length ? { ...i, permissions: perms } : { ...i, permissions: undefined };
  });
}

export const PRIMARY_NAV: NavItem[] = withRoutePerms([
  // ── Core workflow pipeline — always the first 5 visible tabs ──────────
  // Order mirrors the actual lab flow: register → collect → analyse →
  // validate → deliver. Secondary / role-specific items follow and are
  // reachable by swiping the scrollable tab strip.
  {
    id: 'frontdesk',
    label: 'Frontdesk',
    href: '/frontdesk',
    iconPath: [
    'M14 2H10C6.72077 2 5.08116 2 3.91891 2.81382C3.48891 3.1149 3.1149 3.48891 2.81382 3.91891C2 5.08116 2 6.72077 2 10C2 13.2792 2 14.9188 2.81382 16.0811C3.1149 16.5111 3.48891 16.8851 3.91891 17.1862C5.08116 18 6.72077 18 10 18H14C17.2792 18 18.9188 18 20.0811 17.1862C20.5111 16.8851 20.8851 16.5111 21.1862 16.0811C22 14.9188 22 13.2792 22 10C22 6.72077 22 5.08116 21.1862 3.91891C20.8851 3.48891 20.5111 3.1149 20.0811 2.81382C18.9188 2 17.2792 2 14 2Z',
    'M14.5 22L14.1845 21.5811C13.4733 20.6369 13.2969 19.1944 13.7468 18M9.5 22L9.8155 21.5811C10.5267 20.6369 10.7031 19.1944 10.2532 18',
    'M7 22H17',
    'M8 14C9.83846 11.4046 14.1188 11.263 16 14M14 8C14 9.10457 13.1046 10 12 10C10.8954 10 10 9.10457 10 8C10 6.89543 10.8954 6 12 6C13.1046 6 14 6.89543 14 8Z'
  ],
  },
  {
    id: 'sample-collection',
    action: 'sample_collection',
    label: 'Collect',
    href: '/sample-collection',
    iconPath: ['M9 3h6v4a3 3 0 0 1-1 2.2l-.5.4v8.4A2 2 0 0 1 11.5 20h-3A2 2 0 0 1 6.5 18V9.6L6 9.2A3 3 0 0 1 5 7V3h4'],
    collectionModes: ['dedicated_counter']
  },
  {
    id: 'lab',
    action: 'result_entry',
    label: 'Lab',
    href: '/lab/my-work',
    iconPath: ['M10 3h4v5l5 9a2.5 2.5 0 0 1-2.3 3.5H7.3A2.5 2.5 0 0 1 5 17l5-9V3Zm-2 9h8'],
    // Perms = ROUTE_ACCESS['/lab/my-work'] (enter_result | receive_sample) —
    // never collect_sample, which Receptionists and Sample Collectors hold.
  },
  {
    id: 'validate',
    action: 'validate',
    label: 'Validate',
    href: '/pathologist',
    iconPath: ['M20 6 9 17l-5-5'],
  },
  {
    id: 'results',
    action: 'results',
    label: 'Results',
    href: '/reports',
    iconPath: ['M4 5h16v14H4zM8 10h8M8 14h5'],
    // Report queue is core lab operations (delivery/dispatch) — NOT gated by the
    // reports module, which covers only the TAT/analytics dashboard.
  },
  // ── Secondary / role-specific tabs (scroll right to reach) ───────────
  {
    // Live collection queue (token / walk-up / home-collection).
    id: 'queue',
    action: 'queue',
    label: 'Queue',
    href: '/frontdesk/queue',
    iconPath: ['M3 6h18M3 12h18M3 18h18', 'M7 6v0M7 12v0M7 18v0'],
  },
  {
    // Home-collection agent's assigned visits.
    id: 'home-visits',
    action: 'home_visits',
    label: 'Home Visits',
    href: '/home-collections',
    iconPath: ['M3 12l9-9 9 9M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10', 'M9 21v-6h6v6'],
    module: 'homeCollection'
  },
  {
    id: 'billing-counter',
    action: 'billing',
    label: 'Billing',
    href: '/billing-counter',
    iconPath: ['M3 5h18v14H3zM3 10h18M7 15h3'],
    billingModes: ['separate_counter']
  },
  {
    id: 'stores',
    label: 'Inventory',
    href: '/stores',
    iconPath: ['M3 7l9-4 9 4v10l-9 4-9-4V7Zm9-4v18M3 7l9 4 9-4'],
    requiresInventory: true,
    module: 'inventory'
  },
  {
    // Teams-style chat + group calling. No route permissions = open to every
    // authenticated user (matches the sidebar Workspace entry).
    id: 'messages',
    action: 'messages',
    label: 'Messages',
    href: '/messages',
    iconPath: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
    module: 'messages'
  }
]);

export interface WorkflowNavCtx {
  roles: string[];
  /** OR-check used for action gating — the shells pass the EFFECTIVE check
   *  (mode-aware collect_sample), matching the guard of /sample-collection. */
  hasAnyPermission: (perms: string[]) => boolean;
  /** Raw OR-check for routes whose guard is NOT mode-aware; defaults to
   *  hasAnyPermission. */
  hasAnyRawPermission?: (perms: string[]) => boolean;
  isSuper: boolean;
}

/** The workflow's own "is this action on" (fail-open when the workflow doesn't
 *  mention it) — identical to ProcessWorkflowService.isEnabled. */
export function workflowActionEnabled(cfg: ProcessWorkflowConfig | null | undefined, type: string): boolean {
  if (!cfg) return true;
  const copies = (cfg.actions ?? []).filter(a => a.type === type);
  return copies.length ? copies.some(a => a.enabled) : true;
}

/**
 * Build the primary nav from the active workflow: one item per WORK-AREA the
 * user can access. The admin's chosen area NAME is the nav label, ordered by the
 * area's order. An area shows only when BOTH hold:
 *   1. the user can run at least one of its enabled actions, and
 *   2. the user can OPEN the screen the area links to — the destination route's
 *      guard (ROUTE_ACCESS: perms, guarded parents, mode-aware collect_sample,
 *      workflow action). Holding one action's permission is NOT enough when the
 *      area opens a screen that needs more: a Receptionist whose only Lab-area
 *      action is a Sample-collection copy (collect_sample) must not see "Lab",
 *      because /lab/my-work needs enter_result/receive_sample (it used to 403).
 * Each area links to its REAL screen (bespoke for system areas, the dedicated
 * counter screen for single-purpose areas, else the generic /w/:id host).
 * Returns null when there's no usable workflow so callers fall back to the
 * original PRIMARY_NAV (never lock out).
 */
/** A work area's name as a nav label: trimmed, first letter capitalised
 *  ("billing" → "Billing"). The tenant types the name in the workflow
 *  builder; nav labels are always sentence case like the built-in ones. */
export function navLabel(name: string | null | undefined): string {
  const t = (name ?? '').trim();
  return t ? t.charAt(0).toLocaleUpperCase() + t.slice(1) : t;
}

export function menusFromWorkflow(cfg: ProcessWorkflowConfig | null | undefined, ctx: WorkflowNavCtx): NavItem[] | null {
  if (!cfg?.categories?.length) return null;
  // The Collect page comes from the system Collect WORK AREA (normalised in if
  // an older workflow predates it). Like every area it shows only to users who
  // can run its enabled actions (collect_sample) — RBAC; its home copy is always
  // on. Sample Collection sits only in its fixed slots (Collect / Frontdesk /
  // Lab); the normaliser drops copies anywhere else, so a custom area never
  // turns into a collection counter. The shells' withCollection() is only the
  // no-workflow fallback now, so there is never a second Collect.
  cfg = normalizeWorkflow(cfg);
  const wf = cfg;
  const routeCtx: RouteAccessCtx = {
    hasAny: ctx.hasAnyRawPermission ?? ctx.hasAnyPermission,
    hasAnyEffective: ctx.hasAnyPermission,
    isEnabled: t => workflowActionEnabled(wf, t),
    isSuper: ctx.isSuper,
  };
  const items: NavItem[] = [];
  for (const area of [...cfg.categories].sort((a, b) => a.order - b.order)) {
    // Visibility is PERMISSION-driven (not role NAME). The old area.roles
    // name-match gate hid areas from custom roles that held the right
    // permissions — the exact "works by role name" bug we want gone.
    const accessible = (cfg.actions ?? [])
      .filter(a => a.categoryId === area.id && a.enabled)
      .sort((a, b) => a.order - b.order)
      .filter(a => {
        const e = catalogFor(a.type);
        return e && (!e.permissions?.length || ctx.isSuper || ctx.hasAnyPermission(e.permissions));
      });
    if (!accessible.length) continue;
    const route = workAreaRoute(area, cfg);
    // The destination screen's own guard must admit the user (see above).
    if (routeAccess(route) && !canOpenRoute(route, routeCtx)) continue;
    // Stamp the item with the permissions that gate its DESTINATION route (so
    // the shells' visible() filter re-applies the same rule); for the generic
    // /w/:id host (no route guard) the union of the accessible actions' perms.
    const areaPerms = routeAccess(route)
      ? routePerms(route)
      : [...new Set(accessible.flatMap(a => catalogFor(a.type)?.permissions ?? []))];
    const iconPath = area.id === 'frontdesk'
      ? PRIMARY_NAV.find(i => i.id === 'frontdesk')?.iconPath ?? workAreaIconPath(area.icon)
      : workAreaIconPath(area.icon);
    items.push({
      id: area.id,
      label: navLabel(area.name),
      href: route,
      // Frontdesk keeps its canonical workstation icon; other work areas use
      // their builder-selected icon.
      iconPath,
      permissions: areaPerms.length ? areaPerms : undefined,
    });
  }
  return items.length ? items : null;
}

/** Everything the shells know when deciding whether to render a nav item. */
export interface NavVisibilityCtx extends RouteAccessCtx {
  collectionMode: 'front_desk' | 'dedicated_counter';
  billingMode: 'front_desk' | 'separate_counter';
  inventoryEnabled: boolean;
  moduleEnabled: (m: ModuleKey) => boolean;
}

/**
 * THE nav-item visibility rule, shared by the top strip, the bottom nav and the
 * More menu (and the admin hubs via canOpenRoute): the item shows only when the
 * user can open its destination (route guard + guarded parents + workflow
 * action), plus the item's own mode / inventory / module / action gates.
 */
export function navItemVisible(i: NavItem, ctx: NavVisibilityCtx): boolean {
  if (i.permissions?.length && !ctx.isSuper && !ctx.hasAny(i.permissions)) return false;
  if (!canOpenRoute(i.href, ctx)) return false;
  if (i.collectionModes && !i.collectionModes.includes(ctx.collectionMode)) return false;
  if (i.billingModes && !i.billingModes.includes(ctx.billingMode)) return false;
  // Inventory work area only appears when the branch has it enabled.
  if (i.requiresInventory && !ctx.inventoryEnabled) return false;
  // Product-module entitlement: hide a whole work area the tenant's plan
  // doesn't include (inventory / messages / home collection / reports).
  if (i.module && !ctx.moduleEnabled(i.module)) return false;
  // Workflow source-of-truth: hide a nav item whose action the admin switched
  // off in /admin/process (the screen itself is unchanged).
  if (i.action && ctx.isEnabled && !ctx.isEnabled(i.action)) return false;
  return true;
}

/**
 * NO-WORKFLOW FALLBACK for the Collect page (shared by the top strip and the
 * bottom nav). With a workflow configured, Collect is the system Collect work
 * area (menusFromWorkflow) and the nav follows the workflow — nothing is added,
 * so there is never a second Collect. Without one (PRIMARY_NAV), anyone who can
 * draw samples still gets a reachable Collect unless a collection surface is
 * already visible.
 */
export function withCollectionFallback(items: NavItem[], ctx: {
  hasWorkflow: boolean; canCollect: boolean; collectionEnabled: boolean;
}): NavItem[] {
  if (ctx.hasWorkflow || !ctx.canCollect || !ctx.collectionEnabled) return items;
  if (items.some(i => i.id === 'sample-collection' || i.id === 'queue'
                   || i.href === '/sample-collection' || i.href === '/frontdesk/queue')) return items;
  const collect = PRIMARY_NAV.find(i => i.id === 'sample-collection');
  return collect ? [...items, collect] : items;
}

export const MORE_NAV: NavItem[] = withRoutePerms([
  // À-la-carte clinical / ops modules. Hidden until enabled in Admin → Modules;
  // the module toggle IS the gate (no per-module roles yet). Shown here in More
  // until each ships as a first-class workflow work-area. Icons mirror the catalog.
  {
    id: 'm-opd', label: 'OPD', href: '/opd',
    iconPath: ['M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 21v-2a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v2'],
    module: 'opd'
  },
  {
    id: 'm-ipd', label: 'IPD', href: '/ipd',
    iconPath: ['M3 7v12M3 13h18v6M21 19v-4a3 3 0 0 0-3-3h-7v4M7 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z'],
    module: 'ipd'
  },
  {
    id: 'm-pharmacy', label: 'Pharmacy', href: '/pharmacy',
    iconPath: ['M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7ZM7 7l7 7'],
    module: 'pharmacy'
  },
  {
    id: 'm-payroll', label: 'Payroll', href: '/payroll',
    iconPath: ['M3 7h18v12H3zM3 11h18M7 15h4M12 3v4'],
    module: 'payroll'
  },
  {
    id: 'admin-overview', label: 'Admin overview', href: '/admin', exact: true,
    iconPath: ['M3 12h4l3-9 4 18 3-9h4'],
  },
  {
    // Lab module's own settings hub — lab-specific config lives in the Lab world.
    id: 'lab-settings', label: 'Lab settings', href: '/lab/settings',
    iconPath: ['M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6'],
    module: 'lab'
  },
  {
    // NABL critical-result acknowledgement register (Lab world).
    id: 'critical-results', label: 'Critical results', href: '/lab/critical-results',
    iconPath: ['M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z', 'M3.22 12H9.5l.5-1 2 4 1-2 1.5 1h5.27'],
    module: 'lab'
  },
  {
    // Analyzer runs that matched no tube (attach to a sample) + QC runs.
    id: 'analyzer-results', label: 'Analyzer results', href: '/lab/analyzer-results',
    iconPath: ['M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z', 'M7 20h10M12 16v4M7 10h2l1.5-3 3 6 1.5-3h2'],
    module: 'lab'
  },
  {
    id: 'admin-manage', label: 'Manage settings', href: '/admin/manage',
    iconPath: ['M4 6h16M4 12h16M4 18h16'],
  },
  {
    id: 'tat', label: 'TAT Board', href: '/dashboard', iconPath: ['M3 20V10l9-7 9 7v10M9 20v-6h6v6'],
    module: 'reports'
  },
  {
    id: 'users', label: 'Users', href: '/admin/users', iconPath: ['M9 8a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20a6.5 6.5 0 0 1 13 0'],
  },
  {
    id: 'tests', label: 'Tests', href: '/admin/tests', iconPath: ['M11 4h3v9m-3-9v9h3m-3 0c-4-1-4-7 0-9M6 21h14M9 17h8'],
  },
  {
    id: 'branches', label: 'Branches', href: '/admin/branches', iconPath: ['M4 21V7l8-4 8 4v14M9 21v-5h6v5'],
  },
  {
    id: 'lab-cfg', label: 'Lab settings', href: '/admin/lab-settings', iconPath: ['M10 3h4v5l5 9a2.5 2.5 0 0 1-2.3 3.5H7.3A2.5 2.5 0 0 1 5 17l5-9V3Zm-2 9h8'],
  },
  {
    id: 'billing', label: 'Billing cfg', href: '/admin/billing', iconPath: ['M3 5h18v14H3zM3 10h18M7 15h3'],
  },
  {
    // Finance — day-end cash reconciliation + closure.
    id: 'daily-statement', label: 'Daily statement', href: '/finance/daily',
    iconPath: ['M4 4h16v16H4z', 'M8 9h8M8 13h8M8 17h5'],
  },
  {
    id: 'inventory', label: 'Inventory', href: '/admin/inventory', iconPath: ['M3 7l9-4 9 4v10l-9 4-9-4V7Zm9-4v18M3 7l9 4 9-4'],
    module: 'inventory'
  },
  {
    id: 'reports-t', label: 'Report Template', href: '/admin/reports', iconPath: ['M4 5h16v14H4zM8 10h8M8 14h5'],
  },
  {
    id: 'notifs', label: 'Notifications', href: '/admin/notifications', iconPath: ['M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2Zm5 4a1 1 0 0 0 2 0'],
  },
  {
    id: 'process', label: 'Process builder', href: '/admin/process', iconPath: ['M4 5h5v5H4zM15 5h5v5h-5zM9.5 7.5h5.5M7 10v4a2 2 0 0 0 2 2h6M9 16h5v4H9z'],
  },
  {
    id: 'workflows', label: 'Form Flows', href: '/admin/workflows', iconPath: ['M3 4h6v6H3zM15 4h6v6h-6zM9 14h6v6H9zM9 7h6M12 14V10'],
  },
  {
    id: 'kpis', label: 'KPI cards', href: '/admin/kpis', iconPath: ['M3 12h4l3-9 4 18 3-9h4'],
  },
  {
    id: 'vendors', label: 'Vendor Credit Wallets', href: '/admin/vendors', iconPath: ['M21 7H5a2 2 0 0 0 0 4h16v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14M17 14h.01'],
  },
  {
    id: 'referral-labs', label: 'Referral labs', href: '/admin/referral-labs', iconPath: ['M9 3v6l-5 9a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-5-9V3M9 3h6M7.5 14h9'],
  },
  {
    id: 'appts', label: 'Appointments', href: '/admin/appointments',
    iconPath: ['M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z'],
  },
  {
    // Front-desk home-collection assignment — tied to the home_visits action:
    // disabling Home Visits in the workflow removes home collection from the
    // front desk too (they're the two ends of the same capability).
    id: 'hc-assign', label: 'Home assignments', href: '/frontdesk/home-collection', action: 'home_visits',
    iconPath: ['M3 12l9-9 9 9M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10', 'M9 21v-6h6v6'],
    module: 'homeCollection'
  },
  {
    id: 'audit', label: 'Audit trail', href: '/admin/audit',
    iconPath: ['M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2',
               'M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2Z',
               'M9 12h6M9 16h6'],
  },
  {
    id: 'setup', label: 'Branding', href: '/setup', iconPath: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'],
  }
]);
