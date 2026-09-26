import type { ModuleKey } from '../../core/services/tenant-entitlements.service';

/**
 * ONE source for the Admin area's navigation (ND-PATTERN "Admin pages").
 *
 * The categories and pages are the EXISTING ones (same routes, same guards) —
 * this file only describes them once so the Admin home, the two hubs
 * (/admin/manage, /lab/settings), the band search and the back chevron all
 * agree. `perms` / `module` MIRROR the route guards in app.routes.ts: a page
 * the user can't open is never listed, and a category with nothing left is
 * hidden.
 *
 * `ADMIN_SETTINGS` indexes the individual settings INSIDE the pages. Each
 * entry's `id` is the anchor on the page (`pfSettingAnchor`), so a search hit
 * deep-links straight to the row: `/admin/lab-settings#scan-mode`.
 */

/** The admin-config perms that open /admin (mirrors ADMIN_PERMS in app.routes.ts). */
export const ADMIN_HOME_PERMS = ['manage_tests', 'manage_users', 'manage_workflows'];

export interface AdminPage {
  id: string;
  label: string;
  /** One short line under the label. */
  hint: string;
  href: string;
  queryParams?: Record<string, string>;
  icon: string;
  /** Any-of; mirrors the route's permissionGuard. Omitted = any signed-in user. */
  perms?: string[];
  /** Mirrors the route's moduleGuard. */
  module?: ModuleKey;
  /** Plain words + synonyms people might type for this page. */
  kw: string;
  /** Placeholder module screen ("coming soon"). */
  soon?: boolean;
  /** Extra categories whose HUB also lists this page (the Admin home shows
   *  every page once, under its own category). */
  alsoIn?: string[];
}

export interface AdminCategory {
  id: string;
  label: string;
  icon: string;
  /** The category's existing hub page, if it has one. */
  hub?: { href: string; queryParams?: Record<string, string>; perms?: string[]; module?: ModuleKey };
  pages: AdminPage[];
}

export interface AdminSetting {
  /** Anchor id on the page (pfSettingAnchor). */
  id: string;
  /** AdminPage.id the setting lives on. */
  page: string;
  label: string;
  /** Section heading on that page. */
  section: string;
  kw: string;
}

const I = {
  flask: 'M9 3h6M10 3v5.5L5.5 17A2 2 0 0 0 7.3 20h9.4a2 2 0 0 0 1.8-3L14 8.5V3',
  tests: 'M11 4h3v9c-4-1-4-7 0-9ZM6 21h14M9 17h8',
  report: 'M4 4h11l5 5v11H4zM15 4v5h5M8 14h8M8 18h6',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  micro: 'M9 3v6l-5 9a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-5-9V3M9 3h6M14 17h.01',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2ZM11 20a1 1 0 0 0 2 0',
  kpi: 'M3 12h4l3-9 4 18 3-9h4',
  print: 'M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2M8 14h8v6H8z',
  home: 'M3 12l9-9 9 9M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10',
  person: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 21v-2a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v2',
  doctor: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 21v-2a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v2M12 15v4M10 17h4',
  box: 'M21 8 12 3 3 8l9 5 9-5ZM3 8v8l9 5 9-5V8M12 13v8',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 21a6.5 6.5 0 0 1 13 0M17 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  audit: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 12h6M9 16h6',
  building: 'M4 21V7l8-4 8 4v14M9 21v-5h6v5',
  id: 'M3 5h18v14H3zM7 10a2 2 0 1 0 4 0 2 2 0 0 0-4 0M15 9h3M15 13h3M7 16h10',
  calendar: 'M8 2v4M16 2v4M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM3 10h18',
  brush: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM12 2v3M12 19v3M2 12h3M19 12h3',
  money: 'M3 5h18v14H3zM3 10h18M7 15h3',
  chart: 'M3 3v18h18M7 14l4-4 3 3 5-6',
  day: 'M4 4h16v16H4zM8 9h8M8 13h8M8 17h5',
  wallet: 'M21 7H5a2 2 0 0 1 0-4h13v4M3 5v14a2 2 0 0 0 2 2h16V7M17 14h.01',
  partners: 'M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9h.01M9 13h.01M9 17h.01',
  flow: 'M4 5h5v5H4zM15 5h5v5h-5zM9.5 7.5h5.5M9 16h5v4H9z',
  form: 'M3 4h6v6H3zM15 4h6v6h-6zM9 14h6v6H9zM9 7h6M12 14V10',
  puzzle: 'M4 4h7v4a2 2 0 1 0 4 0V4h5v16H4z',
  soon: 'M12 8v4l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z',
};

const LAB_HUB_PERMS = ['manage_tests', 'manage_lab_settings', 'manage_report_template', 'manage_notifications', 'manage_departments'];

export const ADMIN_CATEGORIES: AdminCategory[] = [
  {
    id: 'lab', label: 'Lab', icon: I.flask,
    hub: { href: '/lab/settings', perms: LAB_HUB_PERMS, module: 'lab' },
    pages: [
      { id: 'lab-settings', label: 'Lab settings', hint: 'Samples, work lists, rules', href: '/admin/lab-settings', icon: I.sliders,
        perms: ['manage_lab_settings'],
        kw: 'lab settings sample scan barcode qr sticker label queue work list validation payment gate inventory auto assign counter' },
      { id: 'tests', label: 'Tests & packages', hint: 'Tests, prices, ranges, packages', href: '/admin/tests', icon: I.tests,
        perms: ['manage_tests'],
        kw: 'test master catalogue catalog package profile panel parameter reference range normal range unit price rate tube specimen tat method' },
      { id: 'reports', label: 'Report design', hint: 'Letterhead, columns, signatures', href: '/admin/reports', icon: I.report,
        perms: ['manage_tenant', 'manage_tests'],
        kw: 'report template design letterhead header footer column signature nabl logo layout watermark pdf' },
      { id: 'microbiology', label: 'Microbiology', hint: 'Culture step lock and time targets', href: '/admin/microbiology', icon: I.micro,
        perms: ['manage_lab_settings'], module: 'lab',
        kw: 'microbiology culture sensitivity ast gram stage lock takeover turnaround tat hours' },
      { id: 'notifications', label: 'Alerts', hint: 'Which in-app alerts staff get', href: '/admin/notifications', icon: I.bell,
        perms: ['manage_tenant', 'manage_notifications'],
        kw: 'notifications alerts bell overdue late warning critical reminder message' },
      { id: 'kpis', label: 'KPI cards', hint: 'Numbers shown on each screen', href: '/admin/kpis', icon: I.kpi,
        perms: ADMIN_HOME_PERMS,
        kw: 'kpi metric card dashboard numbers tiles count turnaround' },
      { id: 'home-collection', label: 'Home-collection agents', hint: 'Agents and the areas they cover', href: '/admin/home-collection', icon: I.home,
        perms: ['manage_home_collection'], module: 'homeCollection',
        kw: 'home collection visit agent phlebotomist pickup pincode area route field' },
      { id: 'printing', label: 'Print settings', hint: 'This device: printer and sticker size', href: '/printing', icon: I.print,
        kw: 'print printer label sticker size darkness bluetooth usb thermal alignment invoice printer' },
    ],
  },
  {
    id: 'opd', label: 'OPD', icon: I.doctor,
    hub: { href: '/admin/opd', perms: ADMIN_HOME_PERMS },
    pages: [
      { id: 'opd-doctors', label: 'Doctors & fees', hint: 'Consultation fee per doctor', href: '/admin/opd/doctors', icon: I.doctor,
        perms: ADMIN_HOME_PERMS, kw: 'opd doctor consultation fee charge physician' },
      { id: 'opd-settings', label: 'OPD settings', hint: 'Follow-up visit discount', href: '/admin/opd/settings', icon: I.sliders,
        perms: ADMIN_HOME_PERMS, kw: 'opd follow up follow-up repeat visit revisit discount free visit' },
    ],
  },
  {
    id: 'inventory', label: 'Inventory', icon: I.box,
    pages: [
      { id: 'inventory', label: 'Inventory', hint: 'Items, batches, expiry, test usage', href: '/admin/inventory', icon: I.box,
        perms: ['manage_inventory'], module: 'inventory',
        kw: 'inventory stock store stores batch expiry reagent kit consumable reorder usage' },
    ],
  },
  {
    id: 'people', label: 'People & access', icon: I.users,
    hub: { href: '/admin/manage', queryParams: { cat: 'people' }, perms: ADMIN_HOME_PERMS },
    pages: [
      { id: 'users', label: 'Users & roles', hint: 'Staff, roles, what each can do', href: '/admin/users', icon: I.users,
        perms: ['manage_users'],
        kw: 'users staff employee member role permission access invite password pin login account doctor technician' },
      { id: 'audit', label: 'Audit trail', hint: 'Who changed what, and when', href: '/admin/audit', icon: I.audit,
        perms: ['view_audit_log'], kw: 'audit log history change activity trail who when' },
    ],
  },
  {
    id: 'org', label: 'Branches & organization', icon: I.building,
    hub: { href: '/admin/manage', queryParams: { cat: 'org' }, perms: ADMIN_HOME_PERMS },
    pages: [
      { id: 'branches', label: 'Branches & departments', hint: 'Branches, departments, lab spaces', href: '/admin/branches', icon: I.building,
        perms: ['manage_branches'],
        kw: 'branch branches department lab space location centre tube colour department code' },
      { id: 'organization', label: 'Organization & IDs', hint: 'Name, sign-in word, ID formats', href: '/admin/organization', icon: I.id,
        perms: ['manage_tenant'],
        kw: 'organization name login handle patient id sample id order id number format mrn uhid' },
      { id: 'appointments', label: 'Appointments & queue', hint: 'Queue type, slots, who goes next', href: '/admin/appointments', icon: I.calendar,
        perms: ['manage_tenant'],
        kw: 'appointment booking slot timing hours queue token walk-in priority no-show' },
      { id: 'branding', label: 'Branding', hint: 'Logo and name in the top bar', href: '/setup', icon: I.brush,
        perms: ADMIN_HOME_PERMS, kw: 'branding logo lab name brand top bar appearance' },
    ],
  },
  {
    id: 'finance', label: 'Billing & finance', icon: I.money,
    hub: { href: '/admin/manage', queryParams: { cat: 'finance' }, perms: ADMIN_HOME_PERMS },
    pages: [
      { id: 'billing', label: 'Billing settings', hint: 'GST, discounts, bill number, UPI', href: '/admin/billing', icon: I.money,
        perms: ['manage_tenant'],
        kw: 'billing bill invoice gst tax discount concession upi bank account receipt letterhead proforma' },
      { id: 'finance', label: 'Finance', hint: 'Money in and out, export', href: '/finance', icon: I.chart,
        perms: ['collect_payment', 'create_bill', 'manage_tenant'], kw: 'finance money revenue cash in out collection report export' },
      { id: 'daily-statement', label: 'Daily statement', hint: 'Cash count and day close', href: '/finance/daily', icon: I.day,
        perms: ['collect_payment', 'create_bill', 'manage_tenant'], kw: 'daily statement day close cash count opening closing shift' },
    ],
  },
  {
    id: 'partners', label: 'Referral & vendors', icon: I.partners,
    hub: { href: '/admin/partners', perms: ['manage_tenant', 'manage_tests', 'manage_admin'] },
    pages: [
      { id: 'referral-labs', label: 'Referral labs', hint: 'Outside labs you send tests to', href: '/admin/referral-labs', icon: I.flask,
        perms: ['manage_tests'], alsoIn: ['lab'], kw: 'referral lab outsource outside external send out partner lab' },
      { id: 'referring-network', label: 'Referring doctors', hint: 'Hospitals and doctors who send patients', href: '/admin/referring-network', icon: I.partners,
        perms: ['manage_tenant', 'manage_admin'], alsoIn: ['lab'], kw: 'referring network referral doctor hospital physician commission' },
      { id: 'vendors', label: 'Vendor wallets', hint: 'B2B credit, top-ups, usage', href: '/admin/vendors', icon: I.wallet,
        perms: ['manage_tenant'], alsoIn: ['finance'], kw: 'vendor credit wallet b2b top-up balance partner account' },
    ],
  },
  {
    id: 'automation', label: 'Platform & automation', icon: I.form,
    hub: { href: '/admin/manage', queryParams: { cat: 'automation' }, perms: ADMIN_HOME_PERMS },
    pages: [
      { id: 'process', label: 'Process builder', hint: 'Menus, steps and who sees them', href: '/admin/process', icon: I.flow,
        perms: ['manage_workflows'], kw: 'process workflow menu navigation work area step role access counter' },
      { id: 'workflows', label: 'Form fields', hint: 'Fields on register, order, booking', href: '/admin/workflows', icon: I.form,
        perms: ['manage_workflows'], kw: 'form flow field register order appointment custom field input' },
      { id: 'modules', label: 'Modules', hint: 'Products and their features', href: '/admin/modules', icon: I.puzzle,
        perms: ADMIN_HOME_PERMS, kw: 'modules extension feature enable disable product plan entitlement' },
    ],
  },
  {
    id: 'soon', label: 'Coming soon', icon: I.soon,
    pages: [
      { id: 'radiology', label: 'Radiology', hint: 'X-ray, CT, MRI, scans', href: '/admin/radiology', icon: I.soon, perms: ADMIN_HOME_PERMS, soon: true, kw: 'radiology imaging xray x-ray ct mri ultrasound pacs scan' },
      { id: 'ipd', label: 'IPD', hint: 'Admissions, beds, discharge', href: '/admin/ipd', icon: I.soon, perms: ADMIN_HOME_PERMS, soon: true, kw: 'ipd inpatient admission bed ward discharge' },
      { id: 'pharmacy', label: 'Pharmacy', hint: 'Dispensing and medicine stock', href: '/admin/pharmacy', icon: I.soon, perms: ADMIN_HOME_PERMS, soon: true, kw: 'pharmacy medicine drug dispensing' },
      { id: 'payroll', label: 'Payroll', hint: 'Attendance and payslips', href: '/admin/payroll', icon: I.soon, perms: ADMIN_HOME_PERMS, soon: true, kw: 'payroll salary attendance payslip' },
      { id: 'emergency', label: 'Emergency', hint: 'Triage and ER', href: '/admin/emergency', icon: I.soon, perms: ADMIN_HOME_PERMS, soon: true, kw: 'emergency er triage casualty' },
      { id: 'blood-bank', label: 'Blood bank', hint: 'Donors and blood units', href: '/admin/blood-bank', icon: I.soon, perms: ADMIN_HOME_PERMS, soon: true, kw: 'blood bank donor unit cross match' },
      { id: 'insurance', label: 'Insurance', hint: 'Claims and pre-approval', href: '/admin/insurance', icon: I.soon, perms: ADMIN_HOME_PERMS, soon: true, kw: 'insurance claim tpa pre-auth policy' },
    ],
  },
];

/** Individual settings on the flattened pages — the search's deep-link targets. */
export const ADMIN_SETTINGS: AdminSetting[] = [
  // Lab settings
  { id: 'scan-mode', page: 'lab-settings', section: 'Samples', label: 'How staff find a sample', kw: 'scan barcode qr camera scanner type number manual sample identification find sample read' },
  { id: 'label-code', page: 'lab-settings', section: 'Samples', label: 'Code on tube sticker', kw: 'sticker label tube code barcode qr data matrix print' },
  { id: 'queue-focus', page: 'lab-settings', section: 'Work lists', label: 'Work list shows', kw: 'queue focus work list worklist patient sample group rows' },
  { id: 'lab-structure', page: 'lab-settings', section: 'Work lists', label: 'Lab layout', kw: 'lab structure integrated standalone shared separate department space prefix tubes' },
  { id: 'auto-assign', page: 'lab-settings', section: 'Work lists', label: 'Auto-assign tests', kw: 'auto assign technician route department people roles pool' },
  { id: 'auto-assign-validators', page: 'lab-settings', section: 'Work lists', label: 'Auto-assign result checks', kw: 'auto assign validator checker doctor pathologist review route' },
  { id: 'require-validation', page: 'lab-settings', section: 'Rules', label: 'Doctor must check every result', kw: 'validation validate approve sign off pathologist doctor check result direct flow' },
  { id: 'payment-gate', page: 'lab-settings', section: 'Rules', label: 'Unpaid bill stops', kw: 'payment unpaid dues balance block full payment gate dispatch report money' },
  { id: 'payments-due-tab', page: 'lab-settings', section: 'Rules', label: 'Show Payments due list', kw: 'payments due outstanding balance owed front desk tab list' },
  { id: 'no-scan-claim', page: 'lab-settings', section: 'Rules', label: 'Claim without scanning', kw: 'no scan claim override supervisor damaged broken label' },
  { id: 'inventory-on', page: 'lab-settings', section: 'Rules', label: 'Track stock', kw: 'inventory stock kit reagent consumable deduct' },
  { id: 'counters', page: 'lab-settings', section: 'Counters', label: 'Billing and collection counters', kw: 'counter billing collection front desk separate dedicated' },
  { id: 'calc-constants', page: 'lab-settings', section: 'Calculations', label: 'INR and RPI numbers', kw: 'isi mnpt inr pt hct hematocrit reticulocyte rpi calculation constant reagent' },
  // Organization & IDs
  { id: 'org-name', page: 'organization', section: 'Organization', label: 'Organization name', kw: 'organization lab name display name' },
  { id: 'login-handle', page: 'organization', section: 'Organization', label: 'Sign-in word', kw: 'login handle slug sign in organization word username' },
  { id: 'patient-id', page: 'organization', section: 'Patient ID', label: 'Patient ID format', kw: 'patient id mrn uhid number format prefix' },
  { id: 'sample-id', page: 'organization', section: 'Sample ID', label: 'Sample ID format', kw: 'sample id tube number barcode number format accession' },
  { id: 'order-id', page: 'organization', section: 'Order ID', label: 'Order ID format', kw: 'order id number format bill order' },
  // Billing settings
  { id: 'gst', page: 'billing', section: 'GST', label: 'Charge GST', kw: 'gst tax enable filing scope frequency bill of supply' },
  { id: 'gstin', page: 'billing', section: 'GST', label: 'GST number per branch', kw: 'gstin gst number state code branch tax registration' },
  { id: 'discounts', page: 'billing', section: 'Discounts', label: 'Discount limits', kw: 'discount concession offer limit cap approval percent' },
  { id: 'invoice-number', page: 'billing', section: 'Bill', label: 'Bill number', kw: 'invoice bill number prefix starting series numbering receipt' },
  { id: 'proforma', page: 'billing', section: 'Bill', label: 'Bill only when fully paid', kw: 'proforma estimate full payment invoice issue' },
  { id: 'upi', page: 'billing', section: 'Bill', label: 'UPI payment', kw: 'upi vpa online payment gpay phonepe paytm qr payee' },
  { id: 'bank', page: 'billing', section: 'Bill', label: 'Bank account', kw: 'bank account ifsc settlement account number' },
  { id: 'bill-template', page: 'billing', section: 'Bill look', label: 'Bill style and size', kw: 'invoice template style classic modern cash bill receipt size roll a4 print' },
  { id: 'letterhead', page: 'billing', section: 'Bill look', label: 'Bill letterhead', kw: 'letterhead address phone email logo footer declaration signatory colour jurisdiction' },
  // Appointments & queue
  { id: 'queue-mode', page: 'appointments', section: 'Queue', label: 'Queue type', kw: 'queue mode token walk-in walkin home collection list' },
  { id: 'booking-slots', page: 'appointments', section: 'Booking', label: 'Booking slots', kw: 'booking slot time between appointments hours open 24x7 start end concurrent' },
  { id: 'priority', page: 'appointments', section: 'Who goes next', label: 'Who goes next', kw: 'priority score engine wait grace late no-show urgent order' },
  // Microbiology
  { id: 'stage-lock', page: 'microbiology', section: 'Step lock', label: 'Release held steps', kw: 'stage lock release idle timeout supervisor takeover force culture' },
  { id: 'turnaround', page: 'microbiology', section: 'Time targets', label: 'Time targets', kw: 'turnaround tat hours overdue gram growth organism sensitivity target' },
  // OPD
  { id: 'follow-up', page: 'opd-settings', section: 'Follow-up', label: 'Follow-up discount', kw: 'follow up follow-up repeat visit revisit discount tiers days' },
];

/** Plain-word synonym groups: typing any word finds the others too. */
export const ADMIN_SYNONYMS: string[][] = [
  ['barcode', 'qr', 'scan', 'scanner', 'camera'],
  ['sticker', 'label', 'tube'],
  ['doctor', 'pathologist', 'validator', 'checker', 'physician'],
  ['check', 'validate', 'validation', 'approve', 'sign'],
  ['bill', 'invoice', 'receipt', 'billing'],
  ['gst', 'tax', 'gstin'],
  ['discount', 'concession', 'offer'],
  ['money', 'payment', 'pay', 'cash', 'dues', 'unpaid'],
  ['staff', 'user', 'users', 'employee', 'people', 'technician', 'tech'],
  ['logo', 'branding', 'brand'],
  ['alert', 'alerts', 'notification', 'notifications', 'bell'],
  ['stock', 'inventory', 'kit', 'reagent'],
  ['queue', 'worklist', 'list', 'token'],
  ['test', 'tests', 'catalogue', 'catalog'],
  ['price', 'rate', 'fee', 'charge', 'cost'],
  ['report', 'result'],
  ['print', 'printer'],
  ['appointment', 'booking', 'slot'],
  ['patient', 'mrn', 'uhid'],
  ['branch', 'centre', 'center', 'location'],
  ['outsource', 'referral', 'outside', 'external'],
  ['culture', 'microbiology', 'micro'],
];

/** Anything that can answer "may this user see X?" — keeps this file pure. */
export interface AdminAccess {
  hasAnyPermission(codes: string[]): boolean;
  moduleEnabled(key: ModuleKey): boolean;
}

export function canSee(p: { perms?: string[]; module?: ModuleKey }, a: AdminAccess): boolean {
  if (p.perms?.length && !a.hasAnyPermission(p.perms)) return false;
  if (p.module && !a.moduleEnabled(p.module)) return false;
  return true;
}

/** Categories with only the pages this user may open; empty categories drop out. */
export function visibleCategories(a: AdminAccess, cats: AdminCategory[] = ADMIN_CATEGORIES): AdminCategory[] {
  return cats
    .map((c) => ({ ...c, pages: c.pages.filter((p) => canSee(p, a)) }))
    .filter((c) => c.pages.length > 0);
}

/** The pages a category's HUB shows: its own + pages listed `alsoIn` it. */
export function hubPages(catId: string, a: AdminAccess, cats: AdminCategory[] = ADMIN_CATEGORIES): AdminPage[] {
  const own = cats.find((c) => c.id === catId)?.pages ?? [];
  const extra = cats.flatMap((c) => c.pages.filter((p) => p.alsoIn?.includes(catId)));
  return [...own, ...extra].filter((p) => canSee(p, a));
}

export function findPage(id: string, cats: AdminCategory[] = ADMIN_CATEGORIES): { page: AdminPage; cat: AdminCategory } | null {
  for (const cat of cats) {
    const page = cat.pages.find((p) => p.id === id);
    if (page) return { page, cat };
  }
  return null;
}

/** The Admin-home parent (`/admin?cat=…`) of an admin page URL, or null. */
export function adminParentFor(url: string, cats: AdminCategory[] = ADMIN_CATEGORIES): string | null {
  const path = url.split('?')[0].split('#')[0].replace(/\/+$/, '');
  for (const cat of cats) {
    if (cat.pages.some((p) => p.href === path)) return `/admin?cat=${cat.id}`;
  }
  return null;
}

export type AdminHit =
  | { kind: 'page'; key: string; page: AdminPage; cat: AdminCategory; score: number }
  | { kind: 'setting'; key: string; setting: AdminSetting; page: AdminPage; cat: AdminCategory; score: number };

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9% ]+/g, ' ');
const words = (s: string) => norm(s).split(/\s+/).filter(Boolean);

/** A query word plus its synonyms. */
export function expandWord(w: string, groups: string[][] = ADMIN_SYNONYMS): string[] {
  const out = new Set([w]);
  for (const g of groups) {
    if (g.some((s) => s === w || (w.length >= 3 && s.startsWith(w)))) g.forEach((s) => out.add(s));
  }
  return [...out];
}

/** Score one haystack against the query words: every word (or a synonym)
 *  must match some word of the haystack (whole word or prefix). 0 = no
 *  match. Per word the best of: whole word in the label 5 · prefix in the
 *  label 4 · whole word in the keywords 4 · synonym in the label 3 / 2.5 ·
 *  prefix in the keywords 2 · synonym in the keywords 1. */
function scoreText(qWords: string[], label: string, rest: string): number {
  const lw = words(label);
  const rw = words(rest);
  let score = 0;
  for (const q of qWords) {
    const alts = expandWord(q).filter((a) => a !== q);
    const best = Math.max(
      lw.includes(q) ? 5 : 0,
      lw.some((w) => w.startsWith(q)) ? 4 : 0,
      rw.includes(q) ? 4 : 0,
      lw.some((w) => alts.includes(w)) ? 3 : 0,
      lw.some((w) => alts.some((a) => w.startsWith(a))) ? 2.5 : 0,
      rw.some((w) => w.startsWith(q)) ? 2 : 0,
      rw.some((w) => alts.some((a) => w.startsWith(a))) ? 1 : 0,
    );
    if (!best) return 0;
    score += best;
  }
  return score;
}

/**
 * The Admin band search: pages AND individual settings, plain words +
 * synonyms, only what this user can open. Ranked by score (label hits
 * first), ties keep catalogue order. Setting hits carry the anchor to
 * deep-link to.
 */
export function searchAdmin(
  query: string,
  a: AdminAccess,
  cats: AdminCategory[] = ADMIN_CATEGORIES,
  settings: AdminSetting[] = ADMIN_SETTINGS,
): AdminHit[] {
  const q = words(query);
  if (!q.length) return [];
  const visible = visibleCategories(a, cats);
  const hits: AdminHit[] = [];
  let order = 0;
  const seq = new Map<string, number>();
  for (const cat of visible) {
    for (const page of cat.pages) {
      const s = scoreText(q, page.label, `${page.hint} ${page.kw} ${cat.label}`);
      if (s > 0) { hits.push({ kind: 'page', key: `p:${page.id}`, page, cat, score: s }); seq.set(`p:${page.id}`, order++); }
    }
  }
  for (const st of settings) {
    const found = findPage(st.page, visible);
    if (!found) continue;
    const s = scoreText(q, st.label, `${st.section} ${st.kw}`);
    // A setting whose own label matches outranks the page that holds it.
    if (s > 0) { hits.push({ kind: 'setting', key: `s:${st.id}`, setting: st, page: found.page, cat: found.cat, score: s + 0.5 }); seq.set(`s:${st.id}`, order++); }
  }
  return hits.sort((x, y) => y.score - x.score || (seq.get(x.key)! - seq.get(y.key)!));
}
