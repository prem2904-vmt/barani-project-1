/**
 * THE Settings map (owner-approved re-home, 2026-11-17): the ONE place that says which sections exist, which
 * settings each holds, and which categories (screens / `?tab=` views) each setting opens.
 *
 *   Settings overview (/admin)  ─ left: sections (Departments, Organization) · right: that section's settings
 *   Inside a setting            ─ left: THAT setting's categories under a back arrow · right: the screen
 *
 * Pure data + pure helpers (no Angular DI) so the overview, the shell, the settings catalog, the redirects and the
 * specs all read the same table. Pages behind a path are wired in `settings.routes.ts` — repointing a path to a
 * finished page changes only that file, never this map.
 */
import type { BetaFeatureKey } from '../../../core/services/beta-features.service';

/** One screen (or one `?tab=` / `?view=` of a screen) inside a setting — a row in the shell's left panel. */
export interface SettingsCategory {
  id: string;
  label: string;
  /** Route path of this category. Defaults to the setting's own path. */
  path?: string;
  /** Query that selects the view on that path (`?tab=`, `?type=`, `?view=`). */
  query?: Readonly<Record<string, string>>;
  /** BETA surface — listed only while that beta is on. */
  beta?: BetaFeatureKey;
  /** Extra permission the category itself needs beyond its page's route. */
  perms?: readonly string[];
}

/** Lab / OPD / IPD facts the overview resolves live (never hard-coded here). */
export type SettingsRequires = 'opd' | 'pharmacy' | 'ipd' | 'homeCollection';

/** One setting = one tile in the overview = one set of categories in the shell. */
export interface SettingsItem {
  id: string;
  label: string;
  /** One plain sentence under the tile title. */
  blurb: string;
  /** The setting's own path (the tile's link). May be a pure alias that the shell resolves to the first category. */
  path: string;
  iconPath: string;
  iconExtra?: string;
  categories: readonly SettingsCategory[];
  /** BETA surface — listed only while that beta is on. */
  beta?: BetaFeatureKey;
  requires?: SettingsRequires;
}

export interface SettingsSectionDef {
  /** The `?section=` id in the overview URL. */
  id: string;
  group: 'departments' | 'organization';
  label: string;
  /** Right-panel heading text. */
  blurb: string;
  /** The department exists only while the lab has it. */
  requires?: SettingsRequires;
  iconPath: string;
  items: readonly SettingsItem[];
}

export const SETTINGS_GROUPS = [
  { key: 'departments', heading: 'Departments' },
  { key: 'organization', heading: 'Organization' },
] as const;

// ── Icons (stroked paths) ──
const ICON = {
  lab: 'M9 3h6M10 3v5.5L5.5 17A2 2 0 0 0 7.3 20h9.4a2 2 0 0 0 1.8-3L14 8.5V3',
  space: 'M4 21V7l8-4 8 4v14M9 21v-5h6v5M12 8v4m-2-2h4',
  barcode: 'M4 5v14M8 5v14M12 5v14M16 5v14M20 5v14',
  tests: 'M11 4h3v9M11 13h3M11 4v9c-4-1-4-7 0-9ZM14 7h2a3 3 0 0 1 3 3M6 21h14M9 17h8',
  report: 'M4 4h11l5 5v11H4zM15 4v5h5M8 14h8M8 18h6',
  queue: 'M4 6h16M4 12h16M4 18h10',
  check: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3ZM9 12l2 2 4-4',
  partners: 'M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9h.01M9 13h.01M9 17h.01',
  instruments: 'M5 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM7 20h10M12 16v4M7 10h2l1.5-3 3 6 1.5-3h2',
  desk: 'M8 2v4M16 2v4M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM3 10h18',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2ZM11 20a1 1 0 0 0 2 0',
  kpi: 'M3 12h4l3-9 4 18 3-9h4',
  process: 'M4 5h5v5H4zM15 5h5v5h-5zM9.5 7.5h5.5M7 10v4a2 2 0 0 0 2 2h6M9 16h5v4H9z',
  home: 'M3 12l9-9 9 9M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10M9 21v-6h6v6',
  person: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 21v-2a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v2',
  stetho: 'M11 2v2M5 2v2M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1M8 15a6 6 0 0 0 12 0v-3',
  pill: 'M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7ZM7 7l7 7',
  bed: 'M3 7v12M3 13h18v6M21 19v-4a3 3 0 0 0-3-3h-7v4M7 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  sheet: 'M9 3h6a1 1 0 0 1 1 1v1H8V4a1 1 0 0 1 1-1ZM8 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M8 12h8M8 16h5',
  box: 'M21 8 12 3 3 8l9 5 9-5ZM3 8v8l9 5 9-5V8M12 13v8',
  branches: 'M4 21V7l8-4 8 4v14M9 21v-5h6v5',
  id: 'M3 5h18v14H3zM7 10h4M7 14h6M16 10h2',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 21a6.5 6.5 0 0 1 13 0M17 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  billing: 'M3 5h18v14H3zM3 10h18M7 15h3',
  connectors: 'M9 7H6a4 4 0 0 0 0 8h3M15 7h3a4 4 0 0 1 0 8h-3M8 11h8',
  comms: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM8 9h8M8 13h5',
  files: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z',
  drug: 'M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7ZM7 7l7 7',
} as const;

/** Every route path in this map, in one place. Repoint a page in settings.routes.ts, never here. */
export const SETTINGS_PATHS = {
  // Lab
  labDepartments: '/admin/lab/departments',
  labSampleNumbers: '/admin/lab/sample-numbers',
  tests: '/admin/tests',
  reports: '/admin/reports',
  reportNotes: '/admin/reports/notes',
  labCollection: '/admin/lab/collection',
  labResults: '/admin/lab/results',
  labOutsourcing: '/admin/lab/outsourcing',
  referralLabs: '/admin/referral-labs',
  partnerPrices: '/admin/partner-prices',
  labAnalyzers: '/admin/lab/analyzers',
  instruments: '/admin/instruments',
  bridges: '/admin/bridges',
  labFrontDesk: '/admin/lab/front-desk',
  labReferring: '/admin/lab/front-desk/referring',
  labAlerts: '/admin/lab/alerts',
  labNumbers: '/admin/lab/numbers',
  labWorkSteps: '/admin/lab/work-steps',
  process: '/admin/process',
  workflows: '/admin/workflows',
  labHomeCollection: '/admin/lab/home-collection',
  microbiology: '/admin/microbiology',
  // OPD
  opdDepartments: '/admin/opd/departments',
  opdDoctors: '/admin/opd/doctors',
  opdForms: '/admin/opd/forms',
  opdWorkflow: '/admin/opd/workflow',
  opdSettings: '/admin/opd/settings',
  opdFrontDesk: '/admin/opd/front-desk',
  opdReferring: '/admin/opd/front-desk/referring',
  opdAlerts: '/admin/opd/alerts',
  opdNumbers: '/admin/opd/numbers',
  // Pharmacy
  pharmacy: '/admin/pharmacy',
  pharmacyDrugs: '/admin/pharmacy/drugs',
  // IPD
  ipdDepartments: '/admin/ipd/departments',
  ipdCaseSheets: '/admin/ipd/myprefrontal',
  ipdPending: '/admin/ipd/myprefrontal/pending',
  ipdAlerts: '/admin/ipd/alerts',
  // Inventory
  inventory: '/admin/inventory',
  // Organization
  orgProfile: '/admin/org/profile',
  orgBranding: '/admin/org/profile/branding',
  branches: '/admin/branches',
  orgNumbers: '/admin/org/numbers',
  users: '/admin/users',
  billing: '/admin/billing',
  vendors: '/admin/vendors',
  aiConnectors: '/admin/ai-connectors',
  orgChannels: '/admin/org/channels',
  files: '/admin/files',
} as const;
const P = SETTINGS_PATHS;

export const SETTINGS_SECTIONS: readonly SettingsSectionDef[] = [
  // ───────────────────────────── Departments ─────────────────────────────
  {
    id: 'lab', group: 'departments', label: 'Lab', iconPath: ICON.lab,
    blurb: 'Everything a lab decides for itself: its departments, sample numbers, tests, reports, analyzers and who it sends tests out to.',
    items: [
      { id: 'lab-departments', label: 'Departments and lab spaces', path: P.labDepartments, iconPath: ICON.space,
        blurb: 'Departments on or off, and the lab space each works in, per branch.',
        categories: [{ id: 'departments', label: 'Departments and lab spaces' }] },
      { id: 'lab-sample-numbers', label: 'Sample numbers', path: P.labSampleNumbers, iconPath: ICON.barcode,
        blurb: 'Sample ID format, prefix per lab space, barcode type, scan or type.',
        categories: [{ id: 'sample', label: 'Sample numbers', query: { tab: 'sample' } }] },
      { id: 'lab-tests', label: 'Tests and packages', path: P.tests, iconPath: ICON.tests,
        blurb: 'Tests, profiles, packages, option groups, microbiology lists and prices.',
        categories: [
          { id: 'individual', label: 'Tests', query: { type: 'individual' } },
          { id: 'profile', label: 'Profiles', query: { type: 'profile' } },
          { id: 'package', label: 'Packages', query: { type: 'package' } },
          { id: 'option-groups', label: 'Option groups', query: { view: 'option-groups' } },
          { id: 'microbiology', label: 'Microbiology lists', query: { view: 'microbiology' } },
          { id: 'pricing', label: 'Prices', query: { view: 'pricing' }, perms: ['manage_tests', 'manage_test_pricing'] },
          { id: 'pending', label: 'Pending changes', query: { view: 'pending' }, beta: 'assistant' },
        ] },
      { id: 'lab-report', label: 'Report design', path: P.reports, iconPath: ICON.report,
        blurb: 'Letterhead, patient strip, columns, results table, order and footer.',
        categories: [
          { id: 'letterhead', label: 'Letterhead', query: { tab: 'letterhead' } },
          { id: 'patient', label: 'Patient strip', query: { tab: 'patient' } },
          { id: 'columns', label: 'Table columns', query: { tab: 'columns' } },
          { id: 'table', label: 'Results table', query: { tab: 'table' } },
          { id: 'sequence', label: 'Sequencing', query: { tab: 'sequence' } },
          { id: 'footer', label: 'Footer', query: { tab: 'footer' } },
          { id: 'notes', label: 'Technician notes', path: P.reportNotes, query: { tab: 'report' } },
        ] },
      { id: 'lab-collection', label: 'Collection and queues', path: P.labCollection, iconPath: ICON.queue,
        blurb: 'Queue focus, auto-assign per department, supervisor claim.',
        categories: [
          { id: 'collection', label: 'Collection and IDs', query: { tab: 'collection' } },
          { id: 'queues', label: 'Queues and assignment', query: { tab: 'queues' } },
        ] },
      { id: 'lab-results', label: 'Results and validation', path: P.labResults, iconPath: ICON.check,
        blurb: 'Validation, calculation constants, microbiology stage lock and turnaround.',
        categories: [
          { id: 'rules', label: 'Rules and gates', query: { tab: 'rules' } },
          { id: 'micro', label: 'Microbiology', path: P.microbiology },
        ] },
      { id: 'lab-outsourcing', label: 'Outsourcing', path: P.labOutsourcing, iconPath: ICON.partners,
        blurb: 'Referral labs, partner prices and the departments each partner handles.',
        categories: [
          { id: 'referral-labs', label: 'Referral labs', path: P.referralLabs },
          { id: 'partner-prices', label: 'Partner prices', path: P.partnerPrices },
        ] },
      { id: 'lab-analyzers', label: 'Analyzers and bridges', path: P.labAnalyzers, iconPath: ICON.instruments,
        blurb: 'Analyzer connection, protocol, code mapping, and Prefrontal Bridges.',
        categories: [
          { id: 'analyzers', label: 'Analyzers', path: P.instruments },
          { id: 'bridges', label: 'Bridges', path: P.bridges },
        ] },
      { id: 'lab-front-desk', label: 'Front desk', path: P.labFrontDesk, iconPath: ICON.desk,
        blurb: 'Lab appointments and queue, and the referring doctors and hospitals.',
        categories: [
          { id: 'mode', label: 'Queue mode', query: { tab: 'mode' } },
          { id: 'slots', label: 'Booking slots', query: { tab: 'slots' } },
          { id: 'priority', label: 'Priority engine', query: { tab: 'priority' } },
          { id: 'referring', label: 'Referring doctors and hospitals', path: P.labReferring },
        ] },
      { id: 'lab-alerts', label: 'Lab alerts', path: P.labAlerts, iconPath: ICON.bell,
        blurb: 'Which alerts the lab gets, and when each one fires.',
        categories: [{ id: 'alerts', label: 'Lab alerts' }] },
      { id: 'lab-numbers', label: 'Numbers on lab screens', path: P.labNumbers, iconPath: ICON.kpi,
        blurb: 'Which number cards show on each lab screen.',
        categories: [{ id: 'numbers', label: 'Numbers on lab screens' }] },
      { id: 'lab-work-steps', label: 'Work steps and forms', path: P.labWorkSteps, iconPath: ICON.process,
        blurb: 'Lab workflows, work areas and menus, and custom forms per screen.',
        categories: [
          { id: 'work-steps', label: 'Work steps', path: P.process },
          { id: 'forms', label: 'Custom forms', path: P.workflows },
        ] },
      { id: 'lab-home-collection', label: 'Home collection', path: P.labHomeCollection, iconPath: ICON.home, requires: 'homeCollection',
        blurb: 'Home collection agents: coverage area and share of work.',
        categories: [{ id: 'agents', label: 'Agents' }] },
    ],
  },
  {
    id: 'opd', group: 'departments', label: 'OPD', requires: 'opd', iconPath: ICON.stetho,
    blurb: 'Outpatient clinic: services and prices, doctors, consultation and the OPD front desk.',
    items: [
      { id: 'opd-departments', label: 'OPD departments and services', path: P.opdDepartments, iconPath: ICON.stetho, requires: 'opd',
        blurb: 'OPD departments, services and prices, follow-up rule.',
        categories: [{ id: 'departments', label: 'Departments and services' }] },
      { id: 'opd-doctors', label: 'Doctors', path: P.opdDoctors, iconPath: ICON.person, requires: 'opd',
        blurb: 'Fee per service, room, token prefix, days.',
        categories: [{ id: 'doctors', label: 'Doctors' }] },
      { id: 'opd-consult', label: 'Consultation and queue', path: P.opdForms, iconPath: ICON.sheet, requires: 'opd',
        blurb: 'Consultation forms, the OPD workflow and the follow-up policy.',
        categories: [
          { id: 'forms', label: 'Consultation forms', path: P.opdForms },
          { id: 'workflow', label: 'Workflow', path: P.opdWorkflow },
          { id: 'follow-up', label: 'Follow-up policy', path: P.opdSettings },
        ] },
      { id: 'opd-front-desk', label: 'OPD front desk, alerts and numbers', path: P.opdFrontDesk, iconPath: ICON.desk, requires: 'opd',
        blurb: 'OPD appointments and booking, referring doctors, alerts and number cards.',
        categories: [
          { id: 'mode', label: 'Queue mode', query: { tab: 'mode' } },
          { id: 'slots', label: 'Booking slots', query: { tab: 'slots' } },
          { id: 'priority', label: 'Priority engine', query: { tab: 'priority' } },
          { id: 'referring', label: 'Referring doctors and hospitals', path: P.opdReferring },
          { id: 'alerts', label: 'OPD alerts', path: P.opdAlerts },
          { id: 'numbers', label: 'Numbers on OPD screens', path: P.opdNumbers },
        ] },
    ],
  },
  {
    id: 'pharmacy', group: 'departments', label: 'Pharmacy', requires: 'pharmacy', iconPath: ICON.pill,
    blurb: 'Dispensing rules and the drug master.',
    items: [
      { id: 'pharmacy-settings', label: 'Pharmacy settings', path: P.pharmacy, iconPath: ICON.pill, requires: 'pharmacy',
        blurb: 'Batch picking, walk-in bills, Schedule H / H1 / X.',
        categories: [{ id: 'settings', label: 'Pharmacy settings' }] },
      { id: 'pharmacy-drugs', label: 'Drug master', path: P.pharmacyDrugs, iconPath: ICON.drug, requires: 'pharmacy',
        blurb: 'Drugs and their details. Stock itself stays on the Pharmacy screen.',
        categories: [{ id: 'drugs', label: 'Drug master' }] },
    ],
  },
  {
    id: 'ipd', group: 'departments', label: 'IPD', requires: 'ipd', iconPath: ICON.bed,
    blurb: 'Inpatient departments and case sheets.',
    items: [
      { id: 'ipd-departments', label: 'IPD departments', path: P.ipdDepartments, iconPath: ICON.bed, requires: 'ipd',
        blurb: 'Create and edit IPD departments.',
        categories: [{ id: 'departments', label: 'IPD departments' }] },
      { id: 'ipd-case-sheets', label: 'Case sheets', path: P.ipdCaseSheets, iconPath: ICON.sheet, requires: 'ipd',
        blurb: 'Case sheet forms, history and pending changes.',
        categories: [
          { id: 'forms', label: 'Case sheet forms', path: P.ipdCaseSheets },
          { id: 'pending', label: 'Pending changes', path: P.ipdPending },
        ] },
      { id: 'ipd-alerts', label: 'IPD alerts', path: P.ipdAlerts, iconPath: ICON.bell, requires: 'ipd',
        blurb: 'IPD alerts on or off, and when they fire.',
        categories: [{ id: 'alerts', label: 'IPD alerts' }] },
    ],
  },
  {
    id: 'inventory', group: 'departments', label: 'Inventory', iconPath: ICON.box,
    blurb: 'Stock items, reorder levels and expiry.',
    items: [
      { id: 'inventory-items', label: 'Stock items', path: P.inventory, iconPath: ICON.box,
        blurb: 'Item master, reorder level, near-expiry days, active.',
        categories: [
          { id: 'items', label: 'Items', query: { tab: 'items' } },
          { id: 'bom', label: 'Test consumables', query: { tab: 'bom' } },
        ] },
    ],
  },

  // ───────────────────────────── Organization ─────────────────────────────
  {
    id: 'profile', group: 'organization', label: 'Organization profile', iconPath: ICON.person,
    blurb: 'Who you are, set once and used everywhere.',
    items: [
      { id: 'org-profile', label: 'Name and logo', path: P.orgProfile, iconPath: ICON.person,
        blurb: 'Organization name, short name and logo, login handle.',
        categories: [
          { id: 'identity', label: 'Name and login handle', query: { tab: 'identity' } },
          { id: 'branding', label: 'Logo and top bar', path: P.orgBranding },
        ] },
    ],
  },
  {
    id: 'branches', group: 'organization', label: 'Branches', iconPath: ICON.branches,
    blurb: 'Create and manage branches.',
    items: [
      { id: 'org-branches', label: 'Branches', path: P.branches, iconPath: ICON.branches,
        blurb: 'New branch, deactivate or reactivate, GSTIN per branch.',
        categories: [{ id: 'branches', label: 'Branches' }] },
    ],
  },
  {
    id: 'numbers', group: 'organization', label: 'Patient and order numbers', iconPath: ICON.id,
    blurb: 'Numbers that belong to the whole organization.',
    items: [
      { id: 'org-numbers', label: 'Patient and order numbers', path: P.orgNumbers, iconPath: ICON.id,
        blurb: 'Patient ID and Order ID formats.',
        categories: [
          { id: 'patient', label: 'Patient ID', query: { tab: 'patient' } },
          { id: 'order', label: 'Order ID', query: { tab: 'order' } },
        ] },
    ],
  },
  {
    id: 'people', group: 'organization', label: 'People and access', iconPath: ICON.users,
    blurb: 'Who can sign in and what they can do.',
    items: [
      { id: 'org-people', label: 'People and access', path: P.users, iconPath: ICON.users,
        blurb: 'Users, roles and permissions.',
        categories: [
          { id: 'users', label: 'Users', query: { tab: 'users' } },
          { id: 'roles', label: 'Roles and permissions', query: { tab: 'roles' } },
        ] },
    ],
  },
  {
    id: 'billing', group: 'organization', label: 'Billing and taxes', iconPath: ICON.billing,
    blurb: 'Money rules for the whole organization.',
    items: [
      { id: 'org-billing', label: 'Billing and taxes', path: P.billing, iconPath: ICON.billing,
        blurb: 'GST, discounts, invoices and bill design, credit accounts.',
        categories: [
          { id: 'gst', label: 'GST setup', query: { tab: 'gst' } },
          { id: 'discounts', label: 'Discounts', query: { tab: 'discounts' } },
          { id: 'invoice', label: 'Invoices and bill design', query: { tab: 'invoice' } },
          { id: 'credit', label: 'Credit accounts', path: P.vendors },
        ] },
    ],
  },
  {
    id: 'connected', group: 'organization', label: 'Connected apps', iconPath: ICON.connectors,
    blurb: 'Let apps you trust read your numbers. Beta.',
    items: [
      { id: 'org-connected', label: 'Cortex connectors', path: P.aiConnectors, iconPath: ICON.connectors, beta: 'mcp',
        blurb: 'Allow apps to connect, what they see, your apps.',
        categories: [{ id: 'connectors', label: 'Cortex connectors' }] },
    ],
  },
  {
    id: 'channels', group: 'organization', label: 'Message channels', iconPath: ICON.comms,
    blurb: 'The accounts messages go out from. Each department decides what it sends.',
    items: [
      { id: 'org-channels', label: 'WhatsApp, email and SMS accounts', path: P.orgChannels, iconPath: ICON.comms,
        blurb: 'Your WhatsApp number, email sender and SMS account.',
        categories: [
          { id: 'whatsapp', label: 'WhatsApp', query: { tab: 'whatsapp' } },
          { id: 'email', label: 'Email', query: { tab: 'email' } },
          { id: 'sms', label: 'SMS', query: { tab: 'sms' } },
        ] },
    ],
  },
  {
    id: 'files', group: 'organization', label: 'Files', iconPath: ICON.files,
    blurb: 'Shared by every department. Beta.',
    items: [
      { id: 'org-files', label: 'Files', path: P.files, iconPath: ICON.files, beta: 'neuron',
        blurb: 'Apps on or off, templates, trash days, edit on phones.',
        categories: [{ id: 'files', label: 'Files' }] },
    ],
  },
];

// ───────────────────────────── Lookups ─────────────────────────────

/** Where a category links: its own path, or the setting's, plus the view query. */
export function categoryTarget(item: SettingsItem, cat: SettingsCategory): { path: string; query: Record<string, string> } {
  return { path: cat.path ?? item.path, query: { ...(cat.query ?? {}) } };
}

/** The path a category answers on (`/admin/reports?tab=table` → `/admin/reports`). */
export function categoryPath(item: SettingsItem, cat: SettingsCategory): string {
  return cat.path ?? item.path;
}

export function sectionById(id: string | null | undefined): SettingsSectionDef | null {
  return SETTINGS_SECTIONS.find((s) => s.id === id) ?? null;
}

export interface SettingsLocation {
  section: SettingsSectionDef;
  item: SettingsItem;
  /** null = the URL is the setting's own (alias) path and names no category. */
  category: SettingsCategory | null;
}

export function normPath(url: string): string {
  const p = (url ?? '').split(/[?#]/)[0];
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}

/**
 * Which setting + category a URL belongs to. Exact path match; when several categories share the path the one whose
 * query agrees with the URL wins (most keys first), then the first without a query, then the first.
 */
export function locateSettings(path: string, query: Readonly<Record<string, string | null | undefined>> = {}): SettingsLocation | null {
  const p = normPath(path);
  let best: { loc: SettingsLocation; score: number } | null = null;
  for (const section of SETTINGS_SECTIONS) {
    for (const item of section.items) {
      for (const category of item.categories) {
        if (categoryPath(item, category) !== p) continue;
        const wanted = Object.entries(category.query ?? {});
        const hits = wanted.filter(([k, v]) => query[k] === v).length;
        const miss = wanted.length - hits;
        // Prefer: all wanted keys match (score by count), then a category that wants nothing, then the rest.
        const score = miss === 0 ? 100 + hits : wanted.length === 0 ? 50 : 10 - miss;
        if (!best || score > best.score) best = { loc: { section, item, category }, score };
      }
    }
  }
  if (best) return best.loc;
  for (const section of SETTINGS_SECTIONS) {
    const item = section.items.find((i) => i.path === p);
    if (item) return { section, item, category: null };
  }
  return null;
}

/** Back from any settings screen: the overview on that section. */
export function settingsParents(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of SETTINGS_SECTIONS) {
    for (const i of s.items) {
      out[i.path] = `/admin?section=${s.id}`;
      for (const c of i.categories) out[categoryPath(i, c)] = `/admin?section=${s.id}`;
    }
  }
  return out;
}

/** Every path any setting or category answers on. */
export function allSettingsPaths(): string[] {
  const out = new Set<string>();
  for (const s of SETTINGS_SECTIONS) for (const i of s.items) {
    out.add(i.path);
    for (const c of i.categories) out.add(categoryPath(i, c));
  }
  return [...out];
}

// ───────────────────────────── Old links → new homes ─────────────────────────────

/** Old overview `?section=` / `/admin/manage?cat=` ids → the section that holds them now. */
export const LEGACY_SECTION: Readonly<Record<string, string>> = {
  people: 'people',
  org: 'profile',
  finance: 'billing',
  automation: 'lab',
  communication: 'channels',
  files: 'files',
  radiology: 'lab',
  payroll: 'lab',
  emergency: 'lab',
  bloodbank: 'lab',
  insurance: 'lab',
};

export interface Url { path: string; query: Record<string, string> }

/**
 * Where an OLD settings path (and its `?tab=`) lives now, or null when the path is not an old settings route.
 * The route redirects and the settings catalog both read this, so a deep link and a search hit agree.
 */
export function rehome(path: string, query: Readonly<Record<string, string | null | undefined>> = {}): Url | null {
  const p = normPath(path);
  const tab = query['tab'] ?? '';
  const keep = (extra: Record<string, string> = {}): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(query)) if (v != null && v !== '' && k !== 'tab') out[k] = v;
    return { ...out, ...extra };
  };
  switch (p) {
    case '/admin/lab-settings':
      switch (tab) {
        case 'queues': return { path: P.labCollection, query: keep({ tab: 'queues' }) };
        case 'rules': return { path: P.labResults, query: keep({ tab: 'rules' }) };
        case 'report': return { path: P.reportNotes, query: keep({ tab: 'report' }) };
        default: return { path: P.labCollection, query: keep({ tab: 'collection' }) };
      }
    case '/admin/organization':
      switch (tab) {
        case 'patient': return { path: P.orgNumbers, query: keep({ tab: 'patient' }) };
        case 'order': return { path: P.orgNumbers, query: keep({ tab: 'order' }) };
        case 'sample': return { path: P.labSampleNumbers, query: keep({ tab: 'sample' }) };
        default: return { path: P.orgProfile, query: keep({ tab: 'identity' }) };
      }
    case '/admin/communication': return { path: P.orgChannels, query: keep(tab ? { tab } : {}) };
    case '/admin/appointments': return { path: P.labFrontDesk, query: keep(tab ? { tab } : {}) };
    case '/admin/referring-network': return { path: P.labReferring, query: keep() };
    case '/admin/notifications': return { path: P.labAlerts, query: keep() };
    case '/admin/kpis': return { path: P.labNumbers, query: keep() };
    case '/admin/home-collection': return { path: P.labHomeCollection, query: keep() };
    case '/admin/partners': return { path: P.labOutsourcing, query: keep() };
    case '/setup': return { path: P.orgBranding, query: keep() };
    case '/admin/opd/pharmacy': return { path: P.pharmacy, query: keep() };
    case '/admin/opd/drugs': return { path: P.pharmacyDrugs, query: keep() };
    default: return null;
  }
}

/** A href (`/admin/lab-settings?tab=rules`) → the new href, or the same href when it did not move. */
export function rehomeHref(href: string, queryParams?: Readonly<Record<string, string>>): { href: string; queryParams?: Record<string, string> } {
  const [path, qs] = href.split('?');
  const q: Record<string, string> = { ...(queryParams ?? {}) };
  if (qs) for (const [k, v] of new URLSearchParams(qs)) q[k] = v;
  const moved = rehome(path, q);
  if (moved) return { href: moved.path, queryParams: Object.keys(moved.query).length ? moved.query : undefined };
  return { href: path, queryParams: Object.keys(q).length ? q : undefined };
}
