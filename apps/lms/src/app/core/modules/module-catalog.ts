/**
 * THE MODULE CATALOG — the single source of truth for which product modules and
 * per-module features EXIST. Per-tenant on/off state is stored separately
 * (backend TenantModuleConfig.ModulesJson, surfaced via TenantEntitlementsService);
 * this file only declares the shape + defaults.
 *
 * Two levels: a module (Lab, OPD, IPD, Pharmacy, Inventory, Payroll) has a master
 * switch, and inside it a set of feature switches. Adding a module or feature is a
 * change HERE — the admin toggle page, nav gating, and route guards all read this
 * catalog, so nothing else needs editing to introduce one.
 */

export type ModuleId = 'lab' | 'opd' | 'ipd' | 'pharmacy' | 'inventory' | 'payroll' | 'insurance';

export interface ModuleFeatureDef {
  /** Stable key stored in ModulesJson (camelCase). Lab's `reports`/`messages`/
   *  `homeCollection` map to the legacy entitlement flags — do not rename them. */
  key: string;
  label: string;
  hint?: string;
}

export interface ModuleDef {
  id: ModuleId;
  label: string;
  /** Single 24×24 SVG path for the module glyph. */
  iconPath: string;
  /** `live` = built and shippable; `coming_soon` = placeholder scaffold. */
  status: 'live' | 'coming_soon';
  /** Default master state for a tenant that has never configured modules. Lab +
   *  Inventory default ON (today's behavior); the rest OFF until purchased. */
  defaultEnabled: boolean;
  /** Landing route when the module is enabled (placeholders share the shell). */
  route: string;
  blurb: string;
  features: ModuleFeatureDef[];
}

export const MODULE_CATALOG: ModuleDef[] = [
  {
    id: 'lab',
    label: 'Lab (Diagnostics)',
    iconPath: 'M9 3h6M10 3v5.5L5.5 17A2 2 0 0 0 7.3 20h9.4a2 2 0 0 0 1.8-3L14 8.5V3',
    status: 'live',
    defaultEnabled: true,
    route: '/lab/my-work',
    blurb: 'Orders, sample collection, result entry, validation and reports.',
    features: [
      { key: 'reports', label: 'Reports', hint: 'Report generation, templates and delivery.' },
      { key: 'messages', label: 'Messages', hint: 'In-app messaging and calls between staff.' },
      { key: 'homeCollection', label: 'Home Collection', hint: 'Home visit scheduling and field agents.' },
    ],
  },
  {
    id: 'opd',
    label: 'OPD (Outpatient)',
    iconPath: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 21v-2a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v2',
    status: 'coming_soon',
    defaultEnabled: false,
    route: '/opd',
    blurb: 'Appointments, consultation, vitals and prescriptions.',
    features: [
      { key: 'appointments', label: 'Appointments' },
      { key: 'consultation', label: 'Consultation' },
      { key: 'vitals', label: 'Vitals' },
      { key: 'prescriptions', label: 'Prescriptions' },
      { key: 'tokenQueue', label: 'Token / Queue' },
    ],
  },
  {
    id: 'ipd',
    label: 'IPD (Inpatient)',
    iconPath: 'M3 7v12M3 13h18v6M21 19v-4a3 3 0 0 0-3-3h-7v4M7 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
    status: 'coming_soon',
    defaultEnabled: false,
    route: '/ipd',
    blurb: 'Admissions, beds & wards, nursing rounds and discharge.',
    features: [
      { key: 'admissions', label: 'Admissions' },
      { key: 'bedsWards', label: 'Beds & Wards' },
      { key: 'nursingRounds', label: 'Nursing & Rounds' },
      { key: 'discharge', label: 'Discharge' },
    ],
  },
  {
    id: 'pharmacy',
    label: 'Pharmacy',
    iconPath: 'M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7ZM7 7l7 7',
    status: 'coming_soon',
    defaultEnabled: false,
    route: '/pharmacy',
    blurb: 'Dispensing, stock, formulary and purchases.',
    features: [
      { key: 'dispensing', label: 'Dispensing' },
      { key: 'stock', label: 'Stock' },
      { key: 'formulary', label: 'Formulary' },
      { key: 'purchase', label: 'Purchase' },
    ],
  },
  {
    id: 'inventory',
    label: 'Inventory',
    iconPath: 'M21 8 12 3 3 8l9 5 9-5ZM3 8v8l9 5 9-5V8M12 13v8',
    status: 'live',
    defaultEnabled: true,
    route: '/stores',
    blurb: 'Stores, stock counts, vendors, purchase orders and audit.',
    features: [
      { key: 'stores', label: 'Stores' },
      { key: 'stockCount', label: 'Stock Count' },
      { key: 'vendors', label: 'Vendors' },
      { key: 'purchaseOrders', label: 'Purchase Orders' },
      { key: 'audit', label: 'Audit' },
    ],
  },
  {
    id: 'payroll',
    label: 'Payroll',
    iconPath: 'M3 7h18v12H3zM3 11h18M7 15h4M12 3v4',
    status: 'coming_soon',
    defaultEnabled: false,
    route: '/payroll',
    blurb: 'Employees, attendance and payslips.',
    features: [
      { key: 'employees', label: 'Employees' },
      { key: 'attendance', label: 'Attendance' },
      { key: 'payslips', label: 'Payslips' },
    ],
  },
  {
    id: 'insurance',
    label: 'Insurance',
    iconPath: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3ZM9 12l2 2 4-4',
    status: 'coming_soon',
    defaultEnabled: false,
    route: '/insurance',
    blurb: 'Policies, claims, pre-authorization, TPA and reimbursement.',
    features: [
      { key: 'policies', label: 'Policies' },
      { key: 'claims', label: 'Claims' },
      { key: 'preAuth', label: 'Pre-authorization' },
      { key: 'tpa', label: 'TPA' },
      { key: 'reimbursement', label: 'Reimbursement' },
    ],
  },
];

/** Per-tenant enablement state (subset of the catalog, from ModulesJson). */
export interface ModuleState {
  enabled: boolean;
  features?: Record<string, boolean>;
}
export type ModulesState = Record<string, ModuleState>;

export function moduleDef(id: string): ModuleDef | undefined {
  return MODULE_CATALOG.find((m) => m.id === id);
}

/** Catalog default for a module's master switch. Unknown id ⇒ false. */
export function defaultModuleEnabled(id: string): boolean {
  return moduleDef(id)?.defaultEnabled ?? false;
}

/** Build the all-defaults state (used before config loads / as the merge base). */
export function catalogDefaults(): ModulesState {
  const out: ModulesState = {};
  for (const m of MODULE_CATALOG) {
    out[m.id] = { enabled: m.defaultEnabled, features: Object.fromEntries(m.features.map((f) => [f.key, true])) };
  }
  return out;
}
