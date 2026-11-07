import type { BetaFeatureKey } from '../../core/services/beta-features.service';
import { PAYMENT_RULE_PERMS } from '../../core/auth/route-access';

/**
 * The ONE index of every settings page and every setting on those pages.
 *
 * Single source for: the settings search on /admin and /admin/manage (whole
 * catalog), the keywords the Lab / Partners hubs filter their tiles with, and
 * where each page's back chevron goes (`SETTINGS_PARENT`). A setting has ONE
 * home: an entry's `href` (+ `queryParams`) is that home — never list the same
 * title under a second page. Search reads `title` + `keywords` only (see
 * settings-search.ts); `section` is shown under each hit so the person sees
 * where it lives.
 */
export interface SettingsEntry {
  /** The visible title — the tile title, or the card title on its page. */
  title: string;
  href: string;
  queryParams?: Record<string, string>;
  /** Where it lives, shown under a search hit ("Lab settings · Rules & gates"). */
  section: string;
  /** Extra words people search with. Never descriptions. */
  keywords?: readonly string[];
  /** SVG path(s) for the hit's icon (the page's icon). */
  icon: string;
  /** 'page' = a screen; 'setting' = a card / switch on a screen. */
  kind: 'page' | 'setting';
  /** Extra permission the card itself needs beyond its page's route. */
  perms?: readonly string[];
  /** BETA surface — listed only while that beta is on. */
  beta?: BetaFeatureKey;
  /** Listed only while this lab feature is on. */
  feature?: 'homeCollection';
  /** Listed only while the tenant has this module. */
  module?: 'inventory';
}

/* ── Icons (one per page; a setting uses its page's icon) ── */
const I = {
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 21a6.5 6.5 0 0 1 13 0M17 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  audit: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 12h6M9 16h6',
  branches: 'M4 21V7l8-4 8 4v14M9 21v-5h6v5',
  org: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 21v-2a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v2',
  appointments: 'M8 2v4M16 2v4M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM3 10h18',
  partners: 'M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9h.01M9 13h.01M9 17h.01',
  branding: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.6 1.6 0 0 0 .3 1.7l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.7-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.7.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.7 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.7.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.7-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.7V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z',
  finance: 'M3 3v18h18M7 14l4-4 3 3 5-6',
  billing: 'M3 5h18v14H3zM3 10h18M7 15h3',
  daily: 'M4 4h16v16H4zM8 9h8M8 13h8M8 17h5',
  expenses: 'M4 2v20l2-1.5L8 22l2-1.5L12 22l2-1.5L16 22l2-1.5L20 22V2l-2 1.5L16 2l-2 1.5L12 2l-2 1.5L8 2 6 3.5ZM8 8h8M8 12h8M8 16h5',
  referralLab: 'M9 3v6l-5 9a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-5-9V3M9 3h6M7.5 14h9',
  prices: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  vendors: 'M21 7H5a2 2 0 0 1 0-4h13v4M3 5v14a2 2 0 0 0 2 2h16V7H5a2 2 0 0 1-2-2ZM17 14h.01',
  process: 'M4 5h5v5H4zM15 5h5v5h-5zM9.5 7.5h5.5M7 10v4a2 2 0 0 0 2 2h6M9 16h5v4H9z',
  forms: 'M3 4h6v6H3zM15 4h6v6h-6zM9 14h6v6H9zM9 7h6M12 14V10',
  modules: 'M3 4h6v6H3zM15 4h6v6h-6zM9 14h6v6H9z',
  hub: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.6 1.6 0 0 0 .3 1.7l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.7-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.7.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.7 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.7.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.7-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.7V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z',
  lab: 'M9 3h6M10 3v5.5L5.5 17A2 2 0 0 0 7.3 20h9.4a2 2 0 0 0 1.8-3L14 8.5V3',
  tests: 'M11 4h3v9M11 13h3M11 4v9c-4-1-4-7 0-9ZM14 7h2a3 3 0 0 1 3 3M6 21h14M9 17h8',
  report: 'M4 4h11l5 5v11H4zM15 4v5h5M8 14h8M8 18h6',
  labSettings: 'M10 3h4v5l5 9a2.5 2.5 0 0 1-2.3 3.5H7.3A2.5 2.5 0 0 1 5 17l5-9V3ZM8 12h8',
  micro: 'M9 3v6l-5 9a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-5-9V3M9 3h6M14 17h.01',
  instruments: 'M5 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM7 20h10M12 16v4M7 10h2l1.5-3 3 6 1.5-3h2',
  bridges: 'M5 13h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2ZM7 16.5h.01M8 9a6 6 0 0 1 8 0M5.5 6.5a10 10 0 0 1 13 0',
  connectors: 'M9 7H6a4 4 0 0 0 0 8h3M15 7h3a4 4 0 0 1 0 8h-3M8 11h8',
  home: 'M3 12l9-9 9 9M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10M9 21v-6h6v6',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2ZM11 20a1 1 0 0 0 2 0',
  kpi: 'M3 12h4l3-9 4 18 3-9h4',
  inventory: 'M21 8 12 3 3 8l9 5 9-5ZM3 8v8l9 5 9-5V8M12 13v8',
  printer: 'M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2M8 14h8v6H8z',
} as const;

/* ── Section labels (shown under each hit) ── */
export const SETTINGS_SECTION = {
  people: 'People & Access',
  org: 'Branches & Organization',
  finance: 'Billing & Finance',
  automation: 'Platform & Automation',
  lab: 'Lab hub',
  partners: 'Referral & Vendors',
  modules: 'Modules',
  personal: 'Your settings',
} as const;

const LS = 'Lab settings';
const ORG = 'Organization & Identity';

/** Lab settings band tabs, in order (the page's `?tab=`). */
export const LAB_SETTINGS_TABS = ['collection', 'queues', 'rules', 'report'] as const;
export type LabSettingsTabId = typeof LAB_SETTINGS_TABS[number];
/** Organization & Identity band tabs, in order (the page's `?tab=`). */
export const ORG_SETTINGS_TABS = ['identity', 'patient', 'sample', 'order'] as const;
export type OrgSettingsTabId = typeof ORG_SETTINGS_TABS[number];

const ls = (tab: LabSettingsTabId, tabLabel: string, title: string, keywords: string[], extra: Partial<SettingsEntry> = {}): SettingsEntry =>
  ({ title, href: '/admin/lab-settings', queryParams: { tab }, section: `${LS} · ${tabLabel}`, keywords, icon: I.labSettings, kind: 'setting', ...extra });
const org = (tab: OrgSettingsTabId, tabLabel: string, title: string, keywords: string[]): SettingsEntry =>
  ({ title, href: '/admin/organization', queryParams: { tab }, section: `${ORG} · ${tabLabel}`, keywords, icon: I.org, kind: 'setting' });
const on = (href: string, page: string, icon: string, title: string, keywords: string[] = [], queryParams?: Record<string, string>): SettingsEntry =>
  ({ title, href, queryParams, section: page, keywords, icon, kind: 'setting' });

export const SETTINGS_CATALOG: readonly SettingsEntry[] = [
  // ── People & Access ──
  { title: 'Users & Access', href: '/admin/users', section: SETTINGS_SECTION.people, icon: I.users, kind: 'page',
    keywords: ['users', 'staff', 'employee', 'roles', 'permissions', 'invite', 'password', 'pin', 'login', 'account'] },
  { title: 'Audit trail', href: '/admin/audit', section: SETTINGS_SECTION.people, icon: I.audit, kind: 'page',
    keywords: ['audit log', 'history', 'who changed', 'activity'] },

  // ── Branches & Organization ──
  { title: 'Branches & Departments', href: '/admin/branches', section: SETTINGS_SECTION.org, icon: I.branches, kind: 'page',
    keywords: ['branch', 'department', 'lab spaces', 'space code', 'sample id prefix', 'tube colour', 'container'] },
  on('/admin/branches', 'Branches & Departments', I.branches, 'Departments & lab spaces', ['drag department', 'space', 'tube sharing']),
  on('/admin/branches', 'Branches & Departments', I.branches, 'Default Lab code', ['sample id prefix', 'space code', 'lab code']),
  { title: ORG, href: '/admin/organization', section: SETTINGS_SECTION.org, icon: I.org, kind: 'page',
    keywords: ['organisation', 'company', 'id format'] },
  org('identity', 'Identity', 'Organization name', ['lab name', 'company name', 'display name']),
  org('identity', 'Identity', 'Organization login handle', ['slug', 'sign in name', 'tenant handle']),
  org('patient', 'Patient ID', 'Patient ID format', ['mrn', 'uhid', 'patient number', 'registration number']),
  org('sample', 'Sample ID', 'Sample ID format', ['sample number', 'tube id', 'barcode number', 'sample id digits']),
  org('order', 'Order ID', 'Order ID format', ['order number', 'visit number']),
  { title: 'Appointments & queue', href: '/admin/appointments', section: SETTINGS_SECTION.org, icon: I.appointments, kind: 'page',
    keywords: ['appointment', 'booking', 'slots', 'token', 'walk in'] },
  on('/admin/appointments', 'Appointments & queue', I.appointments, 'Queue mode', ['token', 'walk in']),
  on('/admin/appointments', 'Appointments & queue', I.appointments, 'Booking slots', ['slot duration', 'open hours', '24x7']),
  on('/admin/appointments', 'Appointments & queue', I.appointments, 'Priority engine', ['priority', 'urgent']),
  { title: 'Referral & Vendors', href: '/admin/partners', section: SETTINGS_SECTION.org, icon: I.partners, kind: 'page',
    keywords: ['partners', 'outsource', 'external lab', 'referral'] },
  { title: 'Branding', href: '/setup', section: SETTINGS_SECTION.org, icon: I.branding, kind: 'page',
    keywords: ['logo', 'top bar', 'short name', 'brand'] },

  // ── Referral & Vendors (the Partners hub is their one home) ──
  { title: 'Referral Labs', href: '/admin/referral-labs', section: SETTINGS_SECTION.partners, icon: I.referralLab, kind: 'page',
    keywords: ['outsource', 'outsourcing', 'external lab', 'send out'] },
  { title: 'Partner Prices', href: '/admin/partner-prices', section: SETTINGS_SECTION.partners, icon: I.prices, kind: 'page',
    keywords: ['outsourcing cost', 'referral lab price', 'margin'] },
  { title: 'Vendor Wallets', href: '/admin/vendors', section: SETTINGS_SECTION.partners, icon: I.vendors, kind: 'page',
    keywords: ['vendor', 'credit', 'wallet', 'b2b', 'top up', 'vendor credit wallets'] },
  { title: 'Referring Network', href: '/admin/referring-network', section: SETTINGS_SECTION.partners, icon: I.partners, kind: 'page',
    keywords: ['hospital', 'doctor', 'referrer', 'commission'] },

  // ── Billing & Finance ──
  { title: 'Finance', href: '/finance', section: SETTINGS_SECTION.finance, icon: I.finance, kind: 'page',
    keywords: ['money', 'cash in', 'cash out', 'revenue'] },
  { title: 'Billing Config', href: '/admin/billing', section: SETTINGS_SECTION.finance, icon: I.billing, kind: 'page',
    keywords: ['billing', 'gst', 'tax', 'hsn', 'discount', 'invoice', 'invoice number', 'receipt'] },
  on('/admin/billing', 'Billing Config', I.billing, 'GSTIN per branch', ['gst', 'tax number']),
  on('/admin/billing', 'Billing Config', I.billing, 'Online payment (UPI)', ['upi', 'payment link', 'qr payment']),
  on('/admin/billing', 'Billing Config', I.billing, 'Bank account', ['settlement', 'ifsc']),
  on('/admin/billing', 'Billing Config', I.billing, 'Letterhead & document type', ['invoice letterhead', 'bill format']),
  { title: 'Daily Statement', href: '/finance/daily', section: SETTINGS_SECTION.finance, icon: I.daily, kind: 'page',
    keywords: ['day closure', 'opening balance', 'closing balance', 'cash count'] },
  { title: 'Expenses', href: '/expenses', section: SETTINGS_SECTION.finance, icon: I.expenses, kind: 'page',
    keywords: ['expense', 'petty cash', 'voucher', 'cashier day closing'] },

  // ── Platform & Automation ──
  { title: 'Process builder', href: '/admin/process', section: SETTINGS_SECTION.automation, icon: I.process, kind: 'page',
    keywords: ['workflow', 'menu', 'navigation', 'work area', 'collection counter', 'billing counter', 'dispatch', 'intake'] },
  { title: 'Form Flows', href: '/admin/workflows', section: SETTINGS_SECTION.automation, icon: I.forms, kind: 'page',
    keywords: ['form', 'fields', 'custom field', 'registration form'] },
  { title: 'Modules', href: '/admin/modules', section: SETTINGS_SECTION.automation, icon: I.modules, kind: 'page',
    keywords: ['extensions', 'enable module', 'products'] },
  { title: 'Settings hub', href: '/admin/manage', section: SETTINGS_SECTION.automation, icon: I.hub, kind: 'page',
    keywords: ['all settings', 'manage'] },

  // ── Lab ──
  { title: 'Lab', href: '/lab/settings', section: SETTINGS_SECTION.lab, icon: I.lab, kind: 'page',
    keywords: ['lab settings hub', 'lab hub'] },
  { title: 'Tests & Packages', href: '/admin/tests', section: SETTINGS_SECTION.lab, icon: I.tests, kind: 'page',
    keywords: ['test master', 'tests', 'packages', 'profiles', 'parameters', 'reference range', 'catalogue', 'test price'] },
  { title: 'Report Template', href: '/admin/reports', section: SETTINGS_SECTION.lab, icon: I.report, kind: 'page',
    keywords: ['report', 'letterhead', 'header', 'footer', 'signature', 'nabl', 'report logo'] },
  on('/admin/reports', 'Report Template · Results table', I.report, 'Consolidated abnormal results sheet', ['abnormal summary', 'high low results'], { tab: 'table' }),
  { title: LS, href: '/admin/lab-settings', section: SETTINGS_SECTION.lab, icon: I.labSettings, kind: 'page',
    keywords: ['lab rules'] },
  ls('collection', 'Collection & IDs', 'Counters & collection', ['collection mode', 'billing mode', 'separate counter']),
  ls('collection', 'Collection & IDs', 'Sample identification', ['scan mode', 'manual entry', 'barcode scanner', 'camera']),
  ls('collection', 'Collection & IDs', 'Pre-fill sample search', ['sample search preset']),
  ls('collection', 'Collection & IDs', 'Specimen label code', ['barcode', 'qr code', 'datamatrix', 'label code']),
  ls('queues', 'Queues & assignment', 'Queue focus', ['patient focused', 'sample focused', 'worklist']),
  ls('queues', 'Queues & assignment', 'Lab structure', ['integrated', 'standalone']),
  ls('queues', 'Queues & assignment', 'Auto-assign by department', ['auto assign', 'validators', 'technician routing']),
  ls('rules', 'Rules & gates', 'Calculation constants', ['isi', 'mnpt', 'inr', 'normal hct']),
  ls('rules', 'Rules & gates', 'Allow no-scan claim (supervisor override)', ['no scan', 'supervisor override']),
  ls('rules', 'Rules & gates', 'Enable inventory', ['stock deduction'], { module: 'inventory' }),
  ls('rules', 'Rules & gates', 'Require full payment to progress', ['payment gate', 'unpaid balance'], { perms: PAYMENT_RULE_PERMS }),
  ls('rules', 'Rules & gates', 'Require validation for all results', ['validation', 'pathologist', 'direct flow']),
  ls('rules', 'Rules & gates', 'Show "Payments due" tab', ['payments due', 'outstanding balance'], { perms: PAYMENT_RULE_PERMS }),
  ls('report', 'Report', 'Technician notes on report', ['tech notes', 'report notes']),
  ls('report', 'Report', 'WhatsApp Auto: send the report automatically when it is ready', ['whatsapp', 'auto send', 'whatsapp auto']),
  { title: 'Microbiology / Culture', href: '/admin/microbiology', section: SETTINGS_SECTION.lab, icon: I.micro, kind: 'page',
    keywords: ['culture', 'microbiology', 'culture bench'] },
  on('/admin/microbiology', 'Microbiology / Culture', I.micro, 'Stage lock', ['lock timeout', 'takeover']),
  on('/admin/microbiology', 'Microbiology / Culture', I.micro, 'Turnaround targets', ['culture tat', 'stage tat']),
  { title: 'Instruments', href: '/admin/instruments', section: SETTINGS_SECTION.lab, icon: I.instruments, kind: 'page',
    keywords: ['analyzer', 'analyser', 'machine', 'interface', 'lis', 'code mapping'] },
  { title: 'Bridges', href: '/admin/bridges', section: SETTINGS_SECTION.lab, icon: I.bridges, kind: 'page',
    keywords: ['prefrontal bridge', 'wifi', 'pi box'] },
  { title: 'AI connectors', href: '/admin/ai-connectors', section: SETTINGS_SECTION.lab, icon: I.connectors, kind: 'page', beta: 'mcp',
    keywords: ['mcp', 'claude', 'connector'] },
  { title: 'Home-collection agents', href: '/admin/home-collection', section: SETTINGS_SECTION.lab, icon: I.home, kind: 'page', feature: 'homeCollection',
    keywords: ['home collection', 'agent', 'pickup', 'coverage area', 'pincode'] },
  { title: 'Notifications', href: '/admin/notifications', section: SETTINGS_SECTION.lab, icon: I.bell, kind: 'page',
    keywords: ['alerts', 'bell', 'overdue', 'critical value', 'escalation'] },
  { title: 'KPI cards', href: '/admin/kpis', section: SETTINGS_SECTION.lab, icon: I.kpi, kind: 'page',
    keywords: ['kpi', 'metrics', 'dashboard cards'] },

  // ── Modules ──
  { title: 'Inventory', href: '/admin/inventory', section: SETTINGS_SECTION.modules, icon: I.inventory, kind: 'page',
    keywords: ['stock', 'batch', 'expiry', 'reagent', 'kit', 'consumables', 'purchase'] },

  // ── Your settings (any signed-in user; per station) ──
  { title: 'Printing', href: '/printing', section: SETTINGS_SECTION.personal, icon: I.printer, kind: 'page',
    keywords: ['print settings', 'printer', 'bluetooth', 'thermal', 'sticker'] },
  on('/printing', 'Printing', I.printer, 'Label printer', ['bluetooth printer', 'usb printer', 'pair']),
  on('/printing', 'Printing', I.printer, 'Label size', ['label width', 'label height', 'roll']),
  on('/printing', 'Printing', I.printer, 'Invoice / document printer', ['receipt printer', 'a4']),
  on('/printing', 'Printing', I.printer, 'Code & quality', ['darkness', 'speed', 'code size']),
];

/** Keywords for a hub tile: the page's own keywords, every setting title on
 *  that page, and — for a hub page — the titles + keywords of the pages it
 *  lists (so "referral labs" finds the Referral & Vendors tile). */
export function settingsKeywordsFor(href: string): string[] {
  const out: string[] = [];
  for (const e of SETTINGS_CATALOG) {
    if (e.href === href) {
      if (e.kind === 'page') out.push(...(e.keywords ?? []));
      else out.push(e.title, ...(e.keywords ?? []));
    } else if (e.kind === 'page' && (SETTINGS_PARENT[e.href] ?? '').split('?')[0] === href) {
      out.push(e.title, ...(e.keywords ?? []));
    }
  }
  return out;
}

/**
 * Settings page → its parent (the hub that lists it). The one map the back
 * chevron, edge-swipe and Android back all climb (NavBackService). A page
 * listed in more than one hub is a duplicate — fix the hub, not this map.
 */
export const SETTINGS_PARENT: Readonly<Record<string, string>> = {
  '/admin/manage': '/admin',
  '/lab/settings': '/admin',
  // People & Access
  '/admin/users': '/admin/manage?cat=people',
  '/admin/roles': '/admin/manage?cat=people',
  '/admin/audit': '/admin/manage?cat=people',
  // Branches & Organization
  '/admin/branches': '/admin/manage?cat=org',
  '/admin/organization': '/admin/manage?cat=org',
  '/admin/appointments': '/admin/manage?cat=org',
  '/admin/partners': '/admin/manage?cat=org',
  '/setup': '/admin/manage?cat=org',
  // Referral & Vendors hub children
  '/admin/referral-labs': '/admin/partners',
  '/admin/partner-prices': '/admin/partners',
  '/admin/vendors': '/admin/partners',
  '/admin/referring-network': '/admin/partners',
  // Billing & Finance
  '/admin/billing': '/admin/manage?cat=finance',
  '/finance': '/admin/manage?cat=finance',
  '/finance/daily': '/admin/manage?cat=finance',
  // Platform & Automation
  '/admin/process': '/admin/manage?cat=automation',
  '/admin/workflows': '/admin/manage?cat=automation',
  // Lab hub children
  '/admin/tests': '/lab/settings',
  '/admin/reports': '/lab/settings',
  '/admin/lab-settings': '/lab/settings',
  '/admin/microbiology': '/lab/settings',
  '/admin/instruments': '/lab/settings',
  '/admin/bridges': '/lab/settings',
  '/admin/ai-connectors': '/lab/settings',
  '/admin/home-collection': '/lab/settings',
  '/admin/notifications': '/lab/settings',
  '/admin/kpis': '/lab/settings',
  // Overview module cards
  '/admin/modules': '/admin',
  '/admin/inventory': '/admin',
  '/admin/radiology': '/admin',
  '/admin/ipd': '/admin',
  '/admin/pharmacy': '/admin',
  '/admin/payroll': '/admin',
  '/admin/insurance': '/admin',
  '/admin/emergency': '/admin',
  '/admin/blood-bank': '/admin',
};

/** Hubs that open settings pages (tiles or search): back from a page opened
 *  from one of these returns to it (browser history honoured). */
export const SETTINGS_HUBS: readonly string[] = ['/admin', '/admin/manage', '/lab/settings', '/admin/partners'];

/** Personal pages (avatar menu, any signed-in user): back = where you came from. */
export const PERSONAL_SETTINGS_PAGES: readonly string[] = ['/printing', '/signature', '/security'];
