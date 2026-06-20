import { ProcessWorkflowConfig, catalogFor, workAreaRoute } from '../shared/models/process-workflow.model';

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
}

// Admin is intentionally NOT in the primary nav anymore — it's a
// settings destination, not a workflow. It now lives as an icon
// button in the top-strip's right cluster (next to the bell) so it
// reads as "configure the app" rather than "one of the modules".
// Non-admin users (no manage_* permission) no longer see it at all.
export const ADMIN_NAV: NavItem = {
  id: 'admin',
  label: 'Admin',
  href: '/admin',
  iconPath: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
             'M19.4 15a1.6 1.6 0 0 0 .3 1.7l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.7-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.7.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.7 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.7.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.7-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.7V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z'],
  permissions: ['manage_tests', 'manage_users', 'manage_workflows', 'manage_branches']
};

export const PRIMARY_NAV: NavItem[] = [
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
    permissions: ['register_patient']
  },
  {
    id: 'lab',
    action: 'result_entry',
    label: 'Lab',
    href: '/lab/my-work',
    iconPath: ['M10 3h4v5l5 9a2.5 2.5 0 0 1-2.3 3.5H7.3A2.5 2.5 0 0 1 5 17l5-9V3Zm-2 9h8'],
    // Only the distinctly lab-tech permissions — `collect_sample` is shared
    // with the Sample Collector role and can't be used here.
    permissions: ['enter_result', 'receive_sample']
  },
  {
    id: 'stores',
    label: 'Inventory',
    href: '/stores',
    iconPath: ['M3 7l9-4 9 4v10l-9 4-9-4V7Zm9-4v18M3 7l9 4 9-4'],
    permissions: ['inventory_receive', 'inventory_issue', 'inventory_count', 'manage_inventory']
  },
  {
    id: 'sample-collection',
    action: 'sample_collection',
    label: 'Collect',
    href: '/sample-collection',
    iconPath: ['M9 3h6v4a3 3 0 0 1-1 2.2l-.5.4v8.4A2 2 0 0 1 11.5 20h-3A2 2 0 0 1 6.5 18V9.6L6 9.2A3 3 0 0 1 5 7V3h4'],
    permissions: ['collect_sample'],
    collectionModes: ['dedicated_counter']
  },
  {
    id: 'billing-counter',
    action: 'billing',
    label: 'Billing',
    href: '/billing-counter',
    iconPath: ['M3 5h18v14H3zM3 10h18M7 15h3'],
    permissions: ['create_bill', 'collect_payment'],
    billingModes: ['separate_counter']
  },
  {
    // Live collection queue (token / walk-up / home-collection).
    id: 'queue',
    action: 'queue',
    label: 'Queue',
    href: '/frontdesk/queue',
    iconPath: ['M3 6h18M3 12h18M3 18h18', 'M7 6v0M7 12v0M7 18v0'],
    permissions: ['register_patient', 'create_order', 'collect_sample']
  },
  {
    // Home-collection agent's assigned visits.
    id: 'home-visits',
    action: 'home_visits',
    label: 'Home Visits',
    href: '/home-collections',
    iconPath: ['M3 12l9-9 9 9M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10', 'M9 21v-6h6v6'],
    permissions: ['collect_sample']
  },
  // Order: Validate before Results — Validate is the pathologist's
  // sign-off step that produces a Result. Following the actual lab
  // pipeline (Collect → Lab → Validate → Results) reads more naturally
  // than the previous alphabetic ordering.
  {
    id: 'validate',
    action: 'validate',
    label: 'Validate',
    href: '/pathologist',
    iconPath: ['M20 6 9 17l-5-5'],
    permissions: ['validate_result']
  },
  {
    id: 'results',
    action: 'results',
    label: 'Results',
    href: '/reports',
    iconPath: ['M4 5h16v14H4zM8 10h8M8 14h5'],
    permissions: ['deliver_report', 'view_report']
  },
  {
    // Teams-style chat + group calling. No permissions = open to every
    // authenticated user (matches the sidebar Workspace entry).
    id: 'messages',
    action: 'messages',
    label: 'Messages',
    href: '/messages',
    iconPath: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z']
  }
];

export interface WorkflowNavCtx {
  roles: string[];
  hasAnyPermission: (perms: string[]) => boolean;
  isSuper: boolean;
}

/**
 * Build the primary nav from the active workflow: one item per WORK-AREA the
 * user can access. The admin's chosen area NAME is the nav label, ordered by the
 * area's order, role-gated by area.roles, and shown only when the user can run
 * at least one of its actions. Each area links to its REAL screen (bespoke for
 * system areas, the dedicated counter screen for single-purpose areas, else the
 * generic /w/:id host) — never a tile grid. Returns null when there's no usable
 * workflow so callers fall back to the original PRIMARY_NAV (never lock out).
 */
export function menusFromWorkflow(cfg: ProcessWorkflowConfig | null | undefined, ctx: WorkflowNavCtx): NavItem[] | null {
  if (!cfg?.categories?.length) return null;
  const items: NavItem[] = [];
  for (const area of [...cfg.categories].sort((a, b) => a.order - b.order)) {
    const roleOk = ctx.isSuper || !area.roles?.length || area.roles.some(r => ctx.roles.includes(r));
    if (!roleOk) continue;
    const accessible = (cfg.actions ?? [])
      .filter(a => a.categoryId === area.id && a.enabled)
      .sort((a, b) => a.order - b.order)
      .filter(a => {
        const e = catalogFor(a.type);
        return e && (!e.permissions?.length || ctx.isSuper || ctx.hasAnyPermission(e.permissions));
      });
    if (!accessible.length) continue;
    items.push({
      id: area.id,
      label: area.name,
      href: workAreaRoute(area, cfg),
      iconPath: catalogFor(accessible[0].type)?.iconPath ?? ['M4 5h5v5H4zM15 5h5v5h-5zM9 16h5v4H9z'],
    });
  }
  return items.length ? items : null;
}

export const MORE_NAV: NavItem[] = [
  {
    id: 'tat', label: 'TAT Board', href: '/dashboard', iconPath: ['M3 20V10l9-7 9 7v10M9 20v-6h6v6'],
    permissions: ['view_tat_dashboard', 'view_dashboard']
  },
  {
    id: 'users', label: 'Users', href: '/admin/users', iconPath: ['M9 8a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20a6.5 6.5 0 0 1 13 0'],
    permissions: ['manage_users']
  },
  {
    id: 'tests', label: 'Tests', href: '/admin/tests', iconPath: ['M11 4h3v9m-3-9v9h3m-3 0c-4-1-4-7 0-9M6 21h14M9 17h8'],
    permissions: ['manage_tests']
  },
  {
    id: 'branches', label: 'Branches', href: '/admin/branches', iconPath: ['M4 21V7l8-4 8 4v14M9 21v-5h6v5'],
    permissions: ['manage_branches']
  },
  {
    id: 'lab-cfg', label: 'Lab settings', href: '/admin/lab-settings', iconPath: ['M10 3h4v5l5 9a2.5 2.5 0 0 1-2.3 3.5H7.3A2.5 2.5 0 0 1 5 17l5-9V3Zm-2 9h8'],
    permissions: ['manage_lab_settings', 'manage_departments']
  },
  {
    id: 'billing', label: 'Billing cfg', href: '/admin/billing', iconPath: ['M3 5h18v14H3zM3 10h18M7 15h3'],
    permissions: ['manage_billing_config']
  },
  {
    id: 'inventory', label: 'Inventory', href: '/admin/inventory', iconPath: ['M3 7l9-4 9 4v10l-9 4-9-4V7Zm9-4v18M3 7l9 4 9-4'],
    permissions: ['manage_inventory']
  },
  {
    id: 'reports-t', label: 'Report theme', href: '/admin/reports', iconPath: ['M4 5h16v14H4zM8 10h8M8 14h5'],
    permissions: ['manage_report_template']
  },
  {
    id: 'notifs', label: 'Notifications', href: '/admin/notifications', iconPath: ['M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2Zm5 4a1 1 0 0 0 2 0'],
    permissions: ['manage_notifications']
  },
  {
    id: 'process', label: 'Workflow', href: '/admin/process', iconPath: ['M4 5h5v5H4zM15 5h5v5h-5zM9.5 7.5h5.5M7 10v4a2 2 0 0 0 2 2h6M9 16h5v4H9z'],
    permissions: ['manage_workflows']
  },
  {
    id: 'workflows', label: 'Form flow', href: '/admin/workflows', iconPath: ['M3 4h6v6H3zM15 4h6v6h-6zM9 14h6v6H9zM9 7h6M12 14V10'],
    permissions: ['manage_workflows']
  },
  {
    id: 'kpis', label: 'KPI cards', href: '/admin/kpis', iconPath: ['M3 12h4l3-9 4 18 3-9h4'],
    permissions: ['manage_tenant', 'manage_branches']
  },
  {
    id: 'vendors', label: 'Vendor wallets', href: '/admin/vendors', iconPath: ['M21 7H5a2 2 0 0 0 0 4h16v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14M17 14h.01'],
    permissions: ['manage_tenant']
  },
  {
    id: 'appts', label: 'Appointments', href: '/admin/appointments',
    iconPath: ['M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z'],
    permissions: ['manage_branches', 'manage_tenant']
  },
  {
    id: 'hc-assign', label: 'Home assignments', href: '/frontdesk/home-collection',
    iconPath: ['M3 12l9-9 9 9M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10', 'M9 21v-6h6v6'],
    permissions: ['manage_home_collection', 'register_patient', 'create_order']
  },
  {
    id: 'audit', label: 'Audit trail', href: '/admin/audit',
    iconPath: ['M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2',
               'M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2Z',
               'M9 12h6M9 16h6'],
    permissions: ['view_audit_log']
  },
  {
    id: 'setup', label: 'Setup', href: '/setup', iconPath: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'],
    permissions: ['manage_branches', 'manage_users']
  }
];
