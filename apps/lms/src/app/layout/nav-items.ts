export interface NavItem {
  id: string;
  label: string;
  href: string;
  exact?: boolean;
  iconPath: string;
}

export const PRIMARY_NAV: NavItem[] = [
  {
    id: 'home',
    label: 'Home',
    href: '/admin',
    exact: true,
    iconPath: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1Z'
  },
  {
    id: 'frontdesk',
    label: 'Frontdesk',
    href: '/frontdesk',
    // Orders + Appointments + Billing are tabs *inside* the Frontdesk
    // shell, so they no longer live in the primary nav.
    iconPath: 'M5 21v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'
  },
  {
    id: 'lab',
    label: 'Lab',
    href: '/lab/my-work',
    iconPath: 'M10 3h4v5l5 9a2.5 2.5 0 0 1-2.3 3.5H7.3A2.5 2.5 0 0 1 5 17l5-9V3Zm-2 9h8'
  },
  {
    id: 'results',
    label: 'Results',
    href: '/reports',
    iconPath: 'M4 5h16v14H4zM8 10h8M8 14h5'
  },
  {
    id: 'validate',
    label: 'Validate',
    href: '/pathologist',
    iconPath: 'M20 6 9 17l-5-5'
  }
];

export const MORE_NAV: NavItem[] = [
  { id: 'tat',       label: 'TAT Board',     href: '/dashboard',              iconPath: 'M3 20V10l9-7 9 7v10M9 20v-6h6v6' },
  { id: 'users',     label: 'Users',         href: '/admin/users',            iconPath: 'M9 8a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20a6.5 6.5 0 0 1 13 0' },
  { id: 'tests',     label: 'Tests',         href: '/admin/tests',            iconPath: 'M11 4h3v9m-3-9v9h3m-3 0c-4-1-4-7 0-9M6 21h14M9 17h8' },
  { id: 'branches',  label: 'Branches',      href: '/admin/branches',         iconPath: 'M4 21V7l8-4 8 4v14M9 21v-5h6v5' },
  { id: 'lab-cfg',   label: 'Lab settings',  href: '/admin/lab-settings',     iconPath: 'M10 3h4v5l5 9a2.5 2.5 0 0 1-2.3 3.5H7.3A2.5 2.5 0 0 1 5 17l5-9V3Zm-2 9h8' },
  { id: 'billing',   label: 'Billing cfg',   href: '/admin/billing',          iconPath: 'M3 5h18v14H3zM3 10h18M7 15h3' },
  { id: 'reports-t', label: 'Report theme',  href: '/admin/reports',          iconPath: 'M4 5h16v14H4zM8 10h8M8 14h5' },
  { id: 'notifs',    label: 'Notifications', href: '/admin/notifications',    iconPath: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2Zm5 4a1 1 0 0 0 2 0' },
  { id: 'workflows', label: 'Flow',          href: '/admin/workflows',        iconPath: 'M3 4h6v6H3zM15 4h6v6h-6zM9 14h6v6H9zM9 7h6M12 14V10' },
  { id: 'setup',     label: 'Setup',         href: '/setup',                  iconPath: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z' }
];
