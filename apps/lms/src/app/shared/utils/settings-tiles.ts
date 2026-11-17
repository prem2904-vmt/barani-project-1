/**
 * The ONE list of settings tiles behind the Settings overview (two panels) and
 * the Lab settings hub: every tile keeps its title, route and icon from the
 * screens it came from. Gating (permissions / module / beta) stays with the
 * consumer, which filters with the same ROUTE_ACCESS table the guards read.
 */
import { BetaFeatureKey } from '../../core/services/beta-features.service';

export type SettingsGradient = 'violet' | 'pink' | 'emerald' | 'amber' | 'sky' | 'rose' | 'fuchsia' | 'teal';

export interface SettingsTile {
  title: string;
  href: string;
  queryParams?: Record<string, string>;
  gradient?: SettingsGradient;
  iconPath: string;
  iconExtra?: string;
  subtitle: string;
}

export interface SettingsCategory {
  id: string;
  label: string;
  iconPath: string;
  iconExtra?: string;
  gradient: SettingsGradient;
  blurb: string;
  tiles: SettingsTile[];
}

export interface LabSettingsTile {
  title: string;
  href: string;
  subtitle: string;
  iconPath: string;
  /** Shown only while this lab feature is on (core/modules/lab-features). */
  feature?: 'homeCollection';
  /** BETA surface: listed only while BetaFeaturesService says so (pf.<key>() + server flag + dev). */
  beta?: BetaFeatureKey;
}

/** Admin categories (People, Organization, Billing, Platform) with their tiles. */
export const ADMIN_CATEGORIES: SettingsCategory[] = [
  {
    id: 'people',
    label: 'People & Access',
    gradient: 'violet',
    iconPath: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
    iconExtra: 'M2.5 21a6.5 6.5 0 0 1 13 0M17 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    blurb: 'Who can do what — staff, roles and a full audit trail of every change.',
    tiles: [
      { title: 'Users & Access', href: '/admin/users', gradient: 'violet',
        iconPath: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
        iconExtra: 'M2.5 21a6.5 6.5 0 0 1 13 0M17 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM21.5 20a5 5 0 0 0-4.5-4',
        subtitle: 'Staff, roles and permissions' },
      { title: 'Audit trail', href: '/admin/audit', gradient: 'rose',
        iconPath: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2',
        iconExtra: 'M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2ZM9 12h6M9 16h6',
        subtitle: 'Every change — who, when, before→after' },
    ]
  },
  {
    id: 'org',
    label: 'Branches & Organization',
    gradient: 'sky',
    iconPath: 'M4 21V7l8-4 8 4v14',
    iconExtra: 'M9 21v-5h6v5',
    blurb: 'The structure of your lab — branches, departments, collection/billing modes, queues, referrers.',
    tiles: [
      { title: 'Branches', href: '/admin/branches', gradient: 'sky',
        iconPath: 'M4 21V7l8-4 8 4v14', iconExtra: 'M9 21v-5h6v5',
        subtitle: 'New branch · deactivate · GSTIN' },
      { title: 'Departments and lab spaces', href: '/admin/lab/departments', gradient: 'sky',
        iconPath: 'M4 21V7l8-4 8 4v14', iconExtra: 'M9 21v-5h6v5M12 8v4m-2-2h4',
        subtitle: 'Your departments · lab spaces · sample prefixes' },
      { title: 'Organization & Identity', href: '/admin/organization', gradient: 'sky',
        iconPath: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 21v-2a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v2',
        subtitle: 'Patient ID format · data tools' },
      { title: 'Appointments & queue', href: '/admin/appointments', gradient: 'amber',
        iconPath: 'M8 2v4M16 2v4M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z', iconExtra: 'M3 10h18M8 14h.01M12 14h.01M16 14h.01',
        subtitle: 'Queue mode · slots · priority engine' },
      { title: 'Referral & Vendors', href: '/admin/partners', gradient: 'fuchsia',
        iconPath: 'M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9h.01M9 13h.01M9 17h.01',
        subtitle: 'Referral labs, vendor wallets & referring network — all here' },
      { title: 'Branding', href: '/setup', gradient: 'violet',
        iconPath: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', iconExtra: 'M19.4 15a1.6 1.6 0 0 0 .3 1.7l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.7-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.7.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.7 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.7.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.7-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.7V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z',
        subtitle: 'Logo & lab name shown in the top bar' },
    ]
  },
  {
    id: 'finance',
    label: 'Billing & Finance',
    gradient: 'amber',
    iconPath: 'M3 5h18v14H3z',
    iconExtra: 'M3 10h18M7 15h3',
    blurb: 'Money flow — GST registration, discount policy, invoice numbering, the daily statement and expenses.',
    tiles: [
      { title: 'Finance', href: '/finance', gradient: 'emerald',
        iconPath: 'M3 3v18h18', iconExtra: 'M7 14l4-4 3 3 5-6',
        subtitle: 'End-to-end money in vs out · Lab · export CSV' },
      { title: 'Billing Config',  href: '/admin/billing', gradient: 'amber',
        iconPath: 'M3 5h18v14H3z', iconExtra: 'M3 10h18M7 15h3',
        subtitle: 'GST, discounts, invoice numbering, UPI / online payment' },
      { title: 'Daily Statement',  href: '/finance/daily', gradient: 'amber',
        iconPath: 'M4 4h16v16H4z', iconExtra: 'M8 9h8M8 13h8M8 17h5',
        subtitle: 'Opening / closing balance · cash count · day closure' },
      { title: 'Expenses',  href: '/expenses', gradient: 'amber',
        iconPath: 'M4 2v20l2-1.5L8 22l2-1.5L12 22l2-1.5L16 22l2-1.5L20 22V2l-2 1.5L16 2l-2 1.5L12 2l-2 1.5L8 2 6 3.5Z', iconExtra: 'M8 8h8M8 12h8M8 16h5',
        subtitle: 'Staff expenses · bills · cashier day closing' },
    ]
  },
  {
    id: 'automation',
    label: 'Platform & Automation',
    gradient: 'pink',
    iconPath: 'M3 4h6v6H3zM15 4h6v6h-6zM9 14h6v6H9z',
    iconExtra: 'M9 7h6M12 14V10',
    blurb: 'Cross-module platform controls — enable modules, and design the menus/forms staff use.',
    tiles: [
      { title: 'Process builder', href: '/admin/process', gradient: 'pink',
        iconPath: 'M4 5h5v5H4zM15 5h5v5h-5zM9.5 7.5h5.5M7 10v4a2 2 0 0 0 2 2h6M9 16h5v4H9z',
        subtitle: 'Menus, actions & role access — drives the live nav' },
      { title: 'Form Flows',    href: '/admin/workflows', gradient: 'pink',
        iconPath: 'M3 4h6v6H3zM15 4h6v6h-6zM9 14h6v6H9z', iconExtra: 'M9 7h6M12 14V10',
        subtitle: 'Screen forms and who fills them' },
    ]
  },
];

/** Lab module tiles (the Lab section of Settings and the Lab settings hub). */
export const LAB_SETTINGS_TILES: LabSettingsTile[] = [
  { title: 'Tests & Packages', href: '/admin/tests',
    subtitle: 'Tests, parameters, reference ranges, packages',
    iconPath: 'M11 4h3v9M11 13h3M11 4v9c-4-1-4-7 0-9ZM14 7h2a3 3 0 0 1 3 3M6 21h14M9 17h8' },
  { title: 'Report Template', href: '/admin/reports',
    subtitle: 'Branding, header, columns, signatures, colours',
    iconPath: 'M4 4h11l5 5v11H4zM15 4v5h5M8 14h8M8 18h6' },
  { title: 'Lab settings', href: '/admin/lab-settings',
    subtitle: 'Sample finding, queues, payment and validation rules',
    iconPath: 'M10 3h4v5l5 9a2.5 2.5 0 0 1-2.3 3.5H7.3A2.5 2.5 0 0 1 5 17l5-9V3ZM8 12h8' },
  { title: 'Communication', href: '/admin/communication',
    subtitle: 'WhatsApp, email and SMS for reports and invoices',
    iconPath: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM8 9h8M8 13h5' },
  { title: 'Microbiology / Culture', href: '/admin/microbiology',
    subtitle: 'Culture bench: stage lock timeout, takeover, per-stage TAT',
    iconPath: 'M9 3v6l-5 9a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-5-9V3M9 3h6M14 17h.01' },
  { title: 'Instruments', href: '/admin/instruments',
    subtitle: 'Analyzers (CBC first): connection, protocol, code mapping, pairing',
    iconPath: 'M5 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM7 20h10M12 16v4M7 10h2l1.5-3 3 6 1.5-3h2' },
  { title: 'Bridges', href: '/admin/bridges',
    subtitle: 'Prefrontal Bridges: add, Wi-Fi, analyzers they connect',
    iconPath: 'M5 13h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2ZM7 16.5h.01M8 9a6 6 0 0 1 8 0M5.5 6.5a10 10 0 0 1 13 0' },
  { title: 'AI connectors', href: '/admin/ai-connectors', beta: 'mcp',
    subtitle: 'Let apps like Claude read your lab’s numbers',
    iconPath: 'M9 7H6a4 4 0 0 0 0 8h3M15 7h3a4 4 0 0 1 0 8h-3M8 11h8' },
  // Referral labs, partner prices, vendor wallets and the referring network
  // have ONE home — the Referral & Vendors hub. This is a link to it, not a
  // second copy of its tiles.
  { title: 'Referral & Vendors', href: '/admin/partners',
    subtitle: 'Referral labs, partner prices, vendor wallets, referring network',
    iconPath: 'M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9h.01M9 13h.01M9 17h.01' },
  { title: 'Home-collection agents', href: '/admin/home-collection', feature: 'homeCollection',
    subtitle: 'Agents · coverage areas · weightage',
    iconPath: 'M3 12l9-9 9 9M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10M9 21v-6h6v6' },
  { title: 'Notifications', href: '/admin/notifications',
    subtitle: 'In-app alerts and overdue warnings',
    iconPath: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2ZM11 20a1 1 0 0 0 2 0' },
  { title: 'KPI cards', href: '/admin/kpis',
    subtitle: 'Pick which KPIs show on each lab screen',
    iconPath: 'M3 12h4l3-9 4 18 3-9h4' },
];
