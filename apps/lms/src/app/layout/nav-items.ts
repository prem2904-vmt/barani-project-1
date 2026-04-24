export interface NavItem {
  id: string;
  label: string;
  href: string;
  exact?: boolean;
  iconPath: string;
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
}

export const PRIMARY_NAV: NavItem[] = [
  {
    id: 'home',
    label: 'Home',
    href: '/admin',
    exact: true,
    iconPath: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1Z',
    permissions: ['manage_tests', 'manage_users', 'manage_workflows', 'manage_branches']
  },
  {
    id: 'frontdesk',
    label: 'Frontdesk',
    href: '/frontdesk',
    iconPath: 'M5 21v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    permissions: ['register_patient']
  },
  {
    id: 'lab',
    label: 'Lab',
    href: '/lab/my-work',
    iconPath: 'M10 3h4v5l5 9a2.5 2.5 0 0 1-2.3 3.5H7.3A2.5 2.5 0 0 1 5 17l5-9V3Zm-2 9h8',
    // Only the distinctly lab-tech permissions — `collect_sample` is shared
    // with the Sample Collector role and can't be used here.
    permissions: ['enter_result', 'receive_sample']
  },
  {
    id: 'sample-collection',
    label: 'Collect',
    href: '/sample-collection',
    iconPath: 'M9 3h6v4a3 3 0 0 1-1 2.2l-.5.4v8.4A2 2 0 0 1 11.5 20h-3A2 2 0 0 1 6.5 18V9.6L6 9.2A3 3 0 0 1 5 7V3h4',
    permissions: ['collect_sample'],
    collectionModes: ['dedicated_counter']
  },
  {
    id: 'results',
    label: 'Results',
    href: '/reports',
    iconPath: 'M4 5h16v14H4zM8 10h8M8 14h5',
    permissions: ['deliver_report', 'view_report']
  },
  {
    id: 'validate',
    label: 'Validate',
    href: '/pathologist',
    iconPath: 'M20 6 9 17l-5-5',
    permissions: ['validate_result']
  }
];

export const MORE_NAV: NavItem[] = [
  { id: 'tat',       label: 'TAT Board',     href: '/dashboard',           iconPath: 'M3 20V10l9-7 9 7v10M9 20v-6h6v6',
    permissions: ['view_tat_dashboard', 'view_dashboard'] },
  { id: 'users',     label: 'Users',         href: '/admin/users',         iconPath: 'M9 8a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20a6.5 6.5 0 0 1 13 0',
    permissions: ['manage_users'] },
  { id: 'tests',     label: 'Tests',         href: '/admin/tests',         iconPath: 'M11 4h3v9m-3-9v9h3m-3 0c-4-1-4-7 0-9M6 21h14M9 17h8',
    permissions: ['manage_tests'] },
  { id: 'branches',  label: 'Branches',      href: '/admin/branches',      iconPath: 'M4 21V7l8-4 8 4v14M9 21v-5h6v5',
    permissions: ['manage_branches'] },
  { id: 'lab-cfg',   label: 'Lab settings',  href: '/admin/lab-settings',  iconPath: 'M10 3h4v5l5 9a2.5 2.5 0 0 1-2.3 3.5H7.3A2.5 2.5 0 0 1 5 17l5-9V3Zm-2 9h8',
    permissions: ['manage_lab_settings', 'manage_departments'] },
  { id: 'billing',   label: 'Billing cfg',   href: '/admin/billing',       iconPath: 'M3 5h18v14H3zM3 10h18M7 15h3',
    permissions: ['manage_billing_config'] },
  { id: 'reports-t', label: 'Report theme',  href: '/admin/reports',       iconPath: 'M4 5h16v14H4zM8 10h8M8 14h5',
    permissions: ['manage_report_template'] },
  { id: 'notifs',    label: 'Notifications', href: '/admin/notifications', iconPath: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2Zm5 4a1 1 0 0 0 2 0',
    permissions: ['manage_notifications'] },
  { id: 'workflows', label: 'Flow',          href: '/admin/workflows',     iconPath: 'M3 4h6v6H3zM15 4h6v6h-6zM9 14h6v6H9zM9 7h6M12 14V10',
    permissions: ['manage_workflows'] },
  { id: 'setup',     label: 'Setup',         href: '/setup',               iconPath: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    permissions: ['manage_branches', 'manage_users'] }
];
