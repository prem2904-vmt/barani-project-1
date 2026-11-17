import type { BetaFeatureKey } from '../../core/services/beta-features.service';
import { COMMS_SETTINGS_PERMS, FILES_SETTINGS_PERMS, PAYMENT_RULE_PERMS } from '../../core/auth/route-access';
import {
  SETTINGS_PATHS as P, SettingsRequires, locateSettings, settingsParents,
} from '../../features/admin/settings/settings-map';

/**
 * The ONE index of every settings page and every setting on those pages.
 *
 * Single source for: the settings search on /admin (whole catalog) and where
 * each page's back chevron goes (`SETTINGS_PARENT`, generated from the settings map). A setting has ONE
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
  /** Listed only while the case-sheet gate is open (CasesheetGateService.visible; part of IPD, dev only). */
  casesheets?: true;
  /** Listed only while the lab has this department (OPD, Pharmacy, IPD) / feature. */
  requires?: SettingsRequires;
}

/* ── Icons (one per setting: the map's own) ── */
const I = {
  lab: 'M9 3h6M10 3v5.5L5.5 17A2 2 0 0 0 7.3 20h9.4a2 2 0 0 0 1.8-3L14 8.5V3',
  space: 'M4 21V7l8-4 8 4v14M9 21v-5h6v5M12 8v4m-2-2h4',
  barcode: 'M4 5v14M8 5v14M12 5v14M16 5v14M20 5v14',
  tests: 'M11 4h3v9M11 13h3M11 4v9c-4-1-4-7 0-9ZM14 7h2a3 3 0 0 1 3 3M6 21h14M9 17h8',
  report: 'M4 4h11l5 5v11H4zM15 4v5h5M8 14h8M8 18h6',
  queue: 'M4 6h16M4 12h16M4 18h10',
  check: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3ZM9 12l2 2 4-4',
  micro: 'M9 3v6l-5 9a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-5-9V3M9 3h6M14 17h.01',
  partners: 'M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9h.01M9 13h.01M9 17h.01',
  instruments: 'M5 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM7 20h10M12 16v4M7 10h2l1.5-3 3 6 1.5-3h2',
  bridges: 'M5 13h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2ZM7 16.5h.01M8 9a6 6 0 0 1 8 0M5.5 6.5a10 10 0 0 1 13 0',
  desk: 'M8 2v4M16 2v4M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM3 10h18',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2ZM11 20a1 1 0 0 0 2 0',
  kpi: 'M3 12h4l3-9 4 18 3-9h4',
  process: 'M4 5h5v5H4zM15 5h5v5h-5zM9.5 7.5h5.5M7 10v4a2 2 0 0 0 2 2h6M9 16h5v4H9z',
  forms: 'M3 4h6v6H3zM15 4h6v6h-6zM9 14h6v6H9zM9 7h6M12 14V10',
  home: 'M3 12l9-9 9 9M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10M9 21v-6h6v6',
  person: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 21v-2a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v2',
  stetho: 'M11 2v2M5 2v2M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1M8 15a6 6 0 0 0 12 0v-3',
  pill: 'M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7ZM7 7l7 7',
  casesheet: 'M9 3h6a1 1 0 0 1 1 1v1H8V4a1 1 0 0 1 1-1ZM8 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M8 12h8M8 16h5',
  inventory: 'M21 8 12 3 3 8l9 5 9-5ZM3 8v8l9 5 9-5V8M12 13v8',
  branches: 'M4 21V7l8-4 8 4v14M9 21v-5h6v5',
  id: 'M3 5h18v14H3zM7 10h4M7 14h6M16 10h2',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 21a6.5 6.5 0 0 1 13 0M17 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  billing: 'M3 5h18v14H3zM3 10h18M7 15h3',
  vendors: 'M21 7H5a2 2 0 0 1 0-4h13v4M3 5v14a2 2 0 0 0 2 2h16V7H5a2 2 0 0 1-2-2ZM17 14h.01',
  branding: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  connectors: 'M9 7H6a4 4 0 0 0 0 8h3M15 7h3a4 4 0 0 1 0 8h-3M8 11h8',
  comms: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM8 9h8M8 13h5',
  files: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z',
  printer: 'M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2M8 14h8v6H8z',
} as const;

/** Section label shown under a hit: where it lives now ("Lab · Results and validation"). */
function whereIs(path: string, query?: Record<string, string>): string {
  const loc = locateSettings(path, query ?? {});
  if (!loc) return 'Settings';
  const named = !!query && Object.keys(query).length > 0;
  const cat = named && loc.category && loc.category.label !== loc.item.label && loc.item.categories.length > 1 ? ` · ${loc.category.label}` : '';
  return `${loc.section.label} · ${loc.item.label}${cat}`;
}

/** Personal settings stay in the profile menu (any signed-in user; per station). */
export const SETTINGS_SECTION = { personal: 'Your settings' } as const;

/** Lab settings band tabs, in order (the page's `?tab=`). */
export const LAB_SETTINGS_TABS = ['collection', 'queues', 'rules', 'report'] as const;
export type LabSettingsTabId = typeof LAB_SETTINGS_TABS[number];
/** Organization & Identity band tabs, in order (the page's `?tab=`). */
export const ORG_SETTINGS_TABS = ['identity', 'patient', 'order'] as const;
export type OrgSettingsTabId = typeof ORG_SETTINGS_TABS[number];

/** A SCREEN (page) of a setting. */
const pg = (title: string, path: string, icon: string, keywords: string[], extra: Partial<SettingsEntry> = {}, query?: Record<string, string>): SettingsEntry =>
  ({ title, href: path, queryParams: query, section: whereIs(path, query), keywords, icon, kind: 'page', ...extra });
/** A SETTING (card / switch) on a screen. */
const st = (title: string, path: string, icon: string, keywords: string[] = [], query?: Record<string, string>, extra: Partial<SettingsEntry> = {}): SettingsEntry =>
  ({ title, href: path, queryParams: query, section: whereIs(path, query), keywords, icon, kind: 'setting', ...extra });

/** A setting card on Settings → Files: same beta + admin gate as the page. */
const fl = (title: string, keywords: string[]): SettingsEntry => ({ ...st(title, P.files, I.files, keywords), beta: 'neuron', perms: FILES_SETTINGS_PERMS });

export const SETTINGS_CATALOG: readonly SettingsEntry[] = [
  // ── Lab ──
  pg('Departments and lab spaces', P.labDepartments, I.space, ['departments on or off', 'lab spaces', 'space code', 'drag department', 'tube sharing', 'tube colour', 'container', 'department']),
  st('Add a department', P.labDepartments, I.space, ['new department', 'own department', 'made here', 'rename department', 'delete department'], { tab: 'departments' }),
  st('Departments on or off', P.labDepartments, I.space, ['switch department', 'deactivate department', 'catalogue'], { tab: 'departments' }),
  st('Lab spaces', P.labDepartments, I.space, ['drag department', 'space', 'tube sharing', 'space name', 'space code'], { tab: 'spaces' }),
  st('Default Lab code', P.labDepartments, I.space, ['sample id prefix', 'space code', 'lab code'], { tab: 'spaces' }),
  pg('Sample numbers', P.labSampleNumbers, I.barcode, ['sample number', 'tube id', 'barcode number', 'sample id digits', 'prefix per lab space'], {}, { tab: 'format' }),
  st('Sample ID format', P.labSampleNumbers, I.barcode, ['sample number', 'tube id', 'barcode number', 'sample id digits'], { tab: 'format' }),
  st('Prefix per lab space', P.labSampleNumbers, I.barcode, ['space code', 'sample id prefix', 'prefix'], { tab: 'prefixes' }),
  st('Lab structure', P.labSampleNumbers, I.barcode, ['integrated', 'standalone'], { tab: 'structure' }),
  st('Specimen label code', P.labSampleNumbers, I.barcode, ['barcode', 'qr code', 'datamatrix', 'label code', 'barcode type'], { tab: 'barcode' }),
  st('Sample identification', P.labSampleNumbers, I.barcode, ['scan mode', 'manual entry', 'barcode scanner', 'camera', 'find a sample'], { tab: 'find' }),
  pg('Tests and packages', P.tests, I.tests, ['test master', 'tests', 'packages', 'profiles', 'parameters', 'reference range', 'catalogue', 'test price', 'tests & packages', 'consumables', 'test consumables']),
  pg('Report design', P.reports, I.report, ['report', 'report template', 'letterhead', 'header', 'footer', 'signature', 'nabl', 'report logo', 'patient strip']),
  st('Consolidated abnormal results sheet', P.reports, I.report, ['abnormal summary', 'high low results'], { tab: 'table' }),
  st('Technician notes on report', P.reportOptions, I.report, ['tech notes', 'report notes'], { tab: 'notes' }),
  st('WhatsApp Auto: send the report automatically when it is ready', P.reportOptions, I.report, ['send report', 'whatsapp auto', 'auto send', 'report sending'], { tab: 'sending' }),
  pg('Collection and queues', P.labCollection, I.queue, ['lab settings', 'lab rules', 'collection', 'queues'], {}, { tab: 'queue' }),
  st('Queue focus', P.labCollection, I.queue, ['patient focused', 'sample focused', 'worklist'], { tab: 'queue' }),
  st('Counters & collection', P.labCollection, I.queue, ['collection mode', 'billing mode', 'separate counter'], { tab: 'queue' }),
  st('Auto-assign technicians and validators', P.labCollection, I.queue, ['auto assign', 'validators', 'validates for', 'technician routing', 'auto-assign by department'], { tab: 'assign' }),
  st('Allow no-scan claim (supervisor override)', P.labCollection, I.queue, ['no scan', 'supervisor override', 'claim without scanning'], { tab: 'noscan' }),
  pg('Results and validation', P.labResults, I.check, ['lab rules', 'rules and gates'], {}, { tab: 'validation' }),
  st('Require validation for all results', P.labResults, I.check, ['validation', 'pathologist', 'direct flow'], { tab: 'validation' }),
  st('Calculation constants', P.labResults, I.check, ['isi', 'mnpt', 'inr', 'normal hct'], { tab: 'constants' }),
  st('Microbiology / Culture', P.labResults, I.micro, ['culture', 'microbiology', 'culture bench'], { tab: 'micro' }),
  st('Stage lock', P.labResults, I.micro, ['lock timeout', 'takeover'], { tab: 'micro' }),
  st('Turnaround targets', P.labResults, I.micro, ['culture tat', 'stage tat'], { tab: 'micro' }),
  pg('Outsourcing', P.labOutsourcing, I.partners, ['partners', 'outsource', 'external lab', 'referral', 'send out']),
  pg('Referral Labs', P.referralLabs, I.report, ['outsource', 'outsourcing', 'external lab', 'send out']),
  pg('Partner Prices', P.partnerPrices, I.partners, ['outsourcing cost', 'referral lab price', 'margin']),
  pg('Analyzers', P.instruments, I.instruments, ['instruments', 'analyzer', 'analyser', 'machine', 'interface', 'lis', 'code mapping']),
  pg('Bridges', P.bridges, I.bridges, ['prefrontal bridge', 'wifi', 'pi box']),
  pg('Front desk', P.labFrontDesk, I.desk, ['appointments & queue', 'appointment', 'booking', 'slots', 'token', 'walk in']),
  st('Queue mode', P.labFrontDesk, I.desk, ['token', 'walk in'], { tab: 'mode' }),
  st('Booking slots', P.labFrontDesk, I.desk, ['slot duration', 'open hours', '24x7'], { tab: 'slots' }),
  st('Priority engine', P.labFrontDesk, I.desk, ['priority', 'urgent'], { tab: 'priority' }),
  st('Referring doctors and hospitals', P.labFrontDesk, I.partners, ['referring network', 'hospital', 'doctor', 'referrer', 'commission'], { tab: 'referring' }),
  pg('Lab alerts', P.labAlerts, I.bell, ['notifications', 'alerts', 'bell', 'overdue', 'critical value', 'escalation']),
  pg('Numbers on lab screens', P.labNumbers, I.kpi, ['kpi cards', 'kpi', 'metrics', 'dashboard cards']),
  pg('Work steps', P.process, I.process, ['process builder', 'workflow', 'menu', 'navigation', 'work area', 'collection counter', 'billing counter', 'dispatch', 'intake', 'work steps and forms']),
  pg('Custom forms', P.workflows, I.forms, ['form flows', 'form', 'fields', 'custom field', 'registration form']),
  pg('Home collection', P.labHomeCollection, I.home, ['home collection on or off', 'home visits'], { feature: 'homeCollection' }, { tab: 'switch' }),
  st('Home-collection agents', P.labHomeCollection, I.home, ['home collection', 'agent', 'pickup', 'coverage area', 'pincode'], { tab: 'agents' }, { feature: 'homeCollection' }),

  // ── OPD ──
  pg('OPD departments and services', P.opdDepartments, I.stetho, ['opd', 'services', 'prices', 'follow-up rule'], { requires: 'opd' }),
  pg('Doctors', P.opdDoctors, I.person, ['opd doctors', 'consultation fee', 'room', 'token prefix'], { requires: 'opd' }),
  pg('Consultation forms', P.opdForms, I.casesheet, ['opd forms', 'consultation'], { requires: 'opd' }),
  pg('OPD workflow', P.opdWorkflow, I.process, ['opd steps', 'stations', 'payment point', 'queue token'], { requires: 'opd' }),
  pg('Follow-up policy', P.opdSettings, I.casesheet, ['follow up', 'opd settings'], { requires: 'opd' }),
  pg('OPD front desk', P.opdFrontDesk, I.desk, ['opd appointments', 'booking slots'], { requires: 'opd' }),
  pg('OPD alerts', P.opdAlerts, I.bell, ['opd notifications'], { requires: 'opd' }),
  pg('Numbers on OPD screens', P.opdNumbers, I.kpi, ['opd kpi cards'], { requires: 'opd' }),

  // ── Pharmacy ──
  pg('Pharmacy settings', P.pharmacy, I.pill, ['batch picking', 'walk-in bills', 'schedule h', 'schedule h1', 'schedule x'], { requires: 'pharmacy' }),
  pg('Drug master', P.pharmacyDrugs, I.pill, ['drugs', 'medicines', 'formulary'], { requires: 'pharmacy' }),

  // ── IPD ──
  pg('Case sheets', P.ipdCaseSheets, I.casesheet, ['case sheet', 'case sheets', 'myprefrontal', 'forms', 'form studio', 'ipd', 'doctor forms', 'department forms', 'history sheet'], { casesheets: true }),
  pg('Case sheet pending changes', P.ipdPending, I.casesheet, ['pending changes', 'suggestions', 'approve', 'approval', 'case sheet', 'case sheets', 'cortex', 'from prefrontal', 'master update'], { casesheets: true }),
  pg('IPD departments', P.ipdDepartments, I.casesheet, ['departments', 'department', 'case sheet', 'case sheets', 'ipd', 'specialty', 'ward'], { casesheets: true }),
  pg('IPD alerts', P.ipdAlerts, I.bell, ['ipd notifications'], { casesheets: true }),

  // ── Inventory ──
  pg('Stock items', P.inventory, I.inventory, ['inventory', 'stock', 'batch', 'expiry', 'reagent', 'kit', 'purchase', 'item master', 'reorder level']),
  st('Enable inventory', P.inventory, I.inventory, ['stock deduction', 'inventory on or off'], undefined, { module: 'inventory' }),

  // ── Organization ──
  pg('Name and logo', P.orgProfile, I.person, ['organisation', 'company', 'organization profile'], {}, { tab: 'identity' }),
  st('Organization name', P.orgProfile, I.person, ['lab name', 'company name', 'display name'], { tab: 'identity' }),
  st('Organization login handle', P.orgProfile, I.person, ['slug', 'sign in name', 'tenant handle'], { tab: 'identity' }),
  pg('Logo and top bar', P.orgBranding, I.branding, ['branding', 'tenant branding', 'logo', 'top bar', 'short name', 'brand']),
  pg('Branches', P.branches, I.branches, ['branch', 'new branch', 'gstin per branch', 'deactivate']),
  pg('Patient and order numbers', P.orgNumbers, I.id, ['id format', 'numbers'], {}, { tab: 'patient' }),
  st('Patient ID format', P.orgNumbers, I.id, ['mrn', 'uhid', 'patient number', 'registration number'], { tab: 'patient' }),
  st('Order ID format', P.orgNumbers, I.id, ['order number', 'visit number'], { tab: 'order' }),
  pg('People and access', P.users, I.users, ['users', 'staff', 'employee', 'roles', 'permissions', 'invite', 'password', 'pin', 'login', 'account', 'users & access'], {}, { tab: 'users' }),
  st('Roles and permissions', P.users, I.users, ['role editor', 'work areas', 'permissions'], { tab: 'roles' }),
  pg('Billing and taxes', P.billing, I.billing, ['billing config', 'billing', 'gst', 'tax', 'hsn', 'discount', 'invoice', 'invoice number', 'receipt'], {}, { tab: 'gst' }),
  st('GSTIN per branch', P.billing, I.billing, ['gst', 'tax number'], { tab: 'gst' }),
  st('Online payment (UPI)', P.billing, I.billing, ['upi', 'payment link', 'qr payment'], { tab: 'invoice' }),
  st('Bank account', P.billing, I.billing, ['settlement', 'ifsc'], { tab: 'invoice' }),
  st('Letterhead & document type', P.billing, I.billing, ['invoice letterhead', 'bill format'], { tab: 'invoice' }),
  st('Require full payment to progress', P.billing, I.billing, ['payment gate', 'unpaid balance', 'payment rules'], { tab: 'payments' }, { perms: PAYMENT_RULE_PERMS }),
  st('Show "Payments due" tab', P.billing, I.billing, ['payments due', 'outstanding balance'], { tab: 'payments' }, { perms: PAYMENT_RULE_PERMS }),
  pg('Credit accounts', P.vendors, I.vendors, ['vendor', 'vendor wallets', 'credit', 'wallet', 'b2b', 'top up', 'vendor credit wallets']),
  pg('Cortex connectors', P.aiConnectors, I.connectors, ['mcp', 'claude', 'connector', 'ai connectors', 'connected apps'], { beta: 'mcp' }),

  // Message channels (WhatsApp, Email, SMS): ONE set of accounts for the organization.
  pg('Message channels', P.orgChannels, I.comms, ['communication', 'whatsapp', 'email', 'sms', 'messages', 'share report', 'send report'], { perms: COMMS_SETTINGS_PERMS }),
  st('Your WhatsApp number', P.orgChannels, I.comms, ['whatsapp number', 'embedded signup', 'whatsapp billing'], { tab: 'whatsapp' }),
  st('Email sender', P.orgChannels, I.comms, ['email', 'smtp', 'mailbox', 'reply to', 'from name', 'own mailbox'], { tab: 'email' }),
  st('Send a test email', P.orgChannels, I.comms, ['test email'], { tab: 'email' }),
  st('SMS Chat', P.orgChannels, I.comms, ['sms', 'text message', 'messages app'], { tab: 'sms' }),

  // Files (Neuron, Synapse, Axon, Myelin, Retina): Organization (beta neuron, dev only).
  { ...pg('Files', P.files, I.files, ['office', 'neuron', 'synapse', 'axon', 'myelin', 'retina', 'sheets', 'spreadsheet', 'documents', 'slides', 'pdf', 'images', 'templates', 'storage', 'trash']), beta: 'neuron', perms: FILES_SETTINGS_PERMS },
  fl('Apps on or off, who can edit', ['neuron', 'synapse', 'axon', 'myelin', 'retina', 'turn off', 'roles']),
  fl('Templates on File → New', ['template', 'letterhead', 'qc log', 'sop']),
  fl('Storage used', ['space', 'gigabytes', 'how much']),
  fl('Edit on phones', ['phone', 'mobile', 'view only']),
  fl('Deleted files kept in Trash', ['trash', 'recycle', 'days', 'restore']),
  fl('Patient names in files', ['patient names', 'export patient data', 'privacy']),
  fl('On the bottom bar by default', ['bottom bar', 'pin', 'role defaults']),

  // ── Your settings (profile menu; any signed-in user; per station) ──
  { title: 'Printing', href: '/printing', section: SETTINGS_SECTION.personal, icon: I.printer, kind: 'page',
    keywords: ['print settings', 'printer', 'bluetooth', 'thermal', 'sticker'] },
  { title: 'Label printer', href: '/printing', section: 'Printing', icon: I.printer, kind: 'setting', keywords: ['bluetooth printer', 'usb printer', 'pair'] },
  { title: 'Label size', href: '/printing', section: 'Printing', icon: I.printer, kind: 'setting', keywords: ['label width', 'label height', 'roll'] },
  { title: 'Invoice / document printer', href: '/printing', section: 'Printing', icon: I.printer, kind: 'setting', keywords: ['receipt printer', 'a4'] },
  { title: 'Code & quality', href: '/printing', section: 'Printing', icon: I.printer, kind: 'setting', keywords: ['darkness', 'speed', 'code size'] },
];

/** Keywords for a settings tile: the page's own keywords plus every setting title on that page. */
export function settingsKeywordsFor(href: string): string[] {
  const out: string[] = [];
  for (const e of SETTINGS_CATALOG) {
    if (e.href !== href) continue;
    if (e.kind === 'page') out.push(...(e.keywords ?? []));
    else out.push(e.title, ...(e.keywords ?? []));
  }
  return out;
}

/**
 * Settings page → where its back chevron goes: the overview, on the section that holds it (generated from the
 * settings map, so a moved page can never keep a stale parent). The one map the back chevron, edge-swipe and
 * Android back all climb (NavBackService).
 */
export const SETTINGS_PARENT: Readonly<Record<string, string>> = {
  ...settingsParents(),
  '/admin/roles': '/admin?section=people',
};

/** The overview: back from a settings page opened from it returns to it (browser history honoured). */
export const SETTINGS_HUBS: readonly string[] = ['/admin'];

/** Personal pages (avatar menu, any signed-in user): back = where you came from. */
export const PERSONAL_SETTINGS_PAGES: readonly string[] = ['/printing', '/signature', '/security'];
