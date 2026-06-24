/**
 * Process workflow — the admin-defined set of operational ACTIONS grouped into
 * CATEGORIES (work-areas) that drive the app's navigation. Distinct from the
 * per-screen form workflow (workflow.model.ts). One active workflow per tenant.
 */

/** A menu (work-area). Its `roles` decide who can access it — empty = anyone
 *  who can reach at least one of its actions by permission. */
export interface ProcessCategory {
  id: string;
  name: string;
  icon: string;        // catalog key (rendered to an svg by the builder/nav)
  color: string;       // accent hex
  order: number;
  roles?: string[];    // role names that can access this menu
}

export interface ProcessAction {
  id: string;
  type: string;        // ACTION_CATALOG key → route/icon/permission
  label?: string;      // optional override of the catalog label
  categoryId: string;
  order: number;
  enabled: boolean;
}

export interface ProcessWorkflowConfig {
  categories: ProcessCategory[];
  actions: ProcessAction[];
}

/** API record (configJson is the serialized ProcessWorkflowConfig). */
export interface ProcessWorkflowRecord {
  id: string;
  /** Branch this workflow configures; null = the tenant-wide default scope. */
  branchId?: string | null;
  name: string;
  isActive: boolean;
  configJson: string;
  version: number;
  updatedAt: string;
}

/** A built-in action: maps a `type` to its route, icon and permissions. */
export interface ActionCatalogEntry {
  type: string;
  label: string;
  route: string;
  iconPath: string[];
  permissions?: string[];   // OR-semantics; empty/undefined = always visible
  hint?: string;
}

/** The catalog of ACTIONS (operations) the admin places inside menus. Each maps
 *  to an existing screen — no screens are rewritten. */
export const ACTION_CATALOG: ActionCatalogEntry[] = [
  { type: 'appointment', label: 'Appointments', route: '/frontdesk/appointments', permissions: ['register_patient', 'create_order'],
    iconPath: ['M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z'], hint: 'Book / view appointments' },
  { type: 'patient_registration', label: 'Register Patient', route: '/frontdesk/patients/new', permissions: ['register_patient'],
    iconPath: ['M9 8a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20a6.5 6.5 0 0 1 13 0', 'M19 8v6M16 11h6'], hint: 'New patient registration' },
  { type: 'walk_in_order', label: 'New Order', route: '/frontdesk/order', permissions: ['create_order', 'register_patient'],
    iconPath: ['M9 2h6a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z', 'M12 8v6M9 11h6'], hint: 'Walk-in / create an order' },
  { type: 'billing', label: 'Billing', route: '/frontdesk/billing', permissions: ['create_bill', 'collect_payment'],
    iconPath: ['M3 5h18v14H3zM3 10h18M7 15h3'], hint: 'Collect payment' },
  { type: 'queue', label: 'Queue', route: '/frontdesk/queue', permissions: ['register_patient', 'create_order', 'collect_sample'],
    iconPath: ['M3 6h18M3 12h18M3 18h18', 'M7 6v0M7 12v0M7 18v0'], hint: 'Live collection queue' },
  { type: 'dispatch', label: 'Dispatch', route: '/frontdesk/queue', permissions: ['dispatch_sample'],
    iconPath: ['M3 7h11v8H3zM14 10h4l3 3v2h-7zM7 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z'], hint: 'Dispatch samples to the lab' },
  { type: 'sample_collection', label: 'Sample Collection', route: '/sample-collection', permissions: ['collect_sample'],
    iconPath: ['M9 3h6v4a3 3 0 0 1-1 2.2l-.5.4v8.4A2 2 0 0 1 11.5 20h-3A2 2 0 0 1 6.5 18V9.6L6 9.2A3 3 0 0 1 5 7V3h4'], hint: 'Draw / scan tubes' },
  { type: 'home_visits', label: 'Home Visits', route: '/home-collections', permissions: ['collect_sample', 'manage_home_collection'],
    iconPath: ['M3 12l9-9 9 9M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10', 'M9 21v-6h6v6'], hint: 'Home-collection visits' },
  { type: 'lab_intake', label: 'Lab Intake', route: '/lab/receive', permissions: ['receive_sample'],
    iconPath: ['M3 12h5l2 3h4l2-3h5', 'M5 12 8 4h8l3 8v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6Z'], hint: 'Receive samples at the lab' },
  { type: 'result_entry', label: 'Result Entry', route: '/lab/my-work', permissions: ['enter_result'],
    iconPath: ['M10 3h4v5l5 9a2.5 2.5 0 0 1-2.3 3.5H7.3A2.5 2.5 0 0 1 5 17l5-9V3Zm-2 9h8'], hint: 'Enter test results' },
  { type: 'validate', label: 'Validate', route: '/pathologist', permissions: ['validate_result'],
    iconPath: ['M20 6 9 17l-5-5'], hint: 'Pathologist sign-off' },
  { type: 'results', label: 'Results', route: '/reports', permissions: ['deliver_report', 'view_report'],
    iconPath: ['M4 5h16v14H4zM8 10h8M8 14h5'], hint: 'Deliver / view reports' },
  { type: 'messages', label: 'Messages', route: '/messages',
    iconPath: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'], hint: 'Team chat & calls' },
];

/** The roles an admin can assign to a menu (seeded role names). The builder also
 *  fetches live roles from the API; this is the fallback list. */
export const KNOWN_ROLES = [
  'Receptionist', 'Billing Counter', 'Sample Collector', 'Lab Technician',
  'Pathologist', 'Home Collection Agent', 'Branch Manager', 'Lab Admin',
];

export function catalogFor(type: string): ActionCatalogEntry | undefined {
  return ACTION_CATALOG.find(a => a.type === type);
}

/**
 * Lock policy — the professional guardrails. A `locked` action can't be dragged
 * out of its `home` work-area; a `mandatory` action can't be switched off or
 * removed. Code-level (not stored in config) so it can't drift or be bypassed
 * by editing a saved workflow. Actions absent here (billing, sample_collection,
 * queue, dispatch, home_visits, messages) are free to move and disable.
 */
export interface ActionPolicy { home: string; locked?: boolean; mandatory?: boolean; }
export const ACTION_POLICY: Record<string, ActionPolicy> = {
  patient_registration: { home: 'frontdesk', locked: true, mandatory: true },
  appointment:          { home: 'frontdesk', locked: true },
  walk_in_order:        { home: 'frontdesk', locked: true },
  result_entry:         { home: 'lab',       locked: true },
  lab_intake:           { home: 'lab',       locked: true },
  validate:             { home: 'validate',  locked: true },
  results:              { home: 'results',   locked: true },
};
export const isLocked    = (type: string): boolean => !!ACTION_POLICY[type]?.locked;
export const isMandatory = (type: string): boolean => !!ACTION_POLICY[type]?.mandatory;
export const actionHome  = (type: string): string | null => ACTION_POLICY[type]?.home ?? null;

/**
 * Actions that must share the same enabled state — toggling or removing one
 * mirrors to the other. `dispatch` + `lab_intake` are the transport pair: with no
 * courier dispatch there's nothing for the lab to receive, so intake collapses
 * too (the lab auto-receives at collection and the TAT clock starts there). Add
 * more pairs here as the lifecycle grows.
 */
export const ACTION_COUPLINGS: string[][] = [
  ['dispatch', 'lab_intake'],
];
export function coupledTypes(type: string): string[] {
  return ACTION_COUPLINGS.flatMap(g => g.includes(type) ? g.filter(t => t !== type) : []);
}

/**
 * One-way prerequisites: an action only makes sense when the actions it REQUIRES
 * are also live in the flow. Enabling/adding an action enables its prerequisites;
 * disabling/removing a prerequisite cascades off the actions that depend on it —
 * so a screen can't be half-built (no collection ⇒ no dispatch/results either).
 * Registration is mandatory so deps on it are always satisfied.
 */
export const ACTION_REQUIRES: Record<string, string[]> = {
  billing:       ['patient_registration'],
  dispatch:      ['sample_collection'],
  result_entry:  ['sample_collection'],
  validate:      ['result_entry'],
  results:       ['validate'],
};
export function requiresOf(type: string): string[] { return ACTION_REQUIRES[type] ?? []; }
export function dependentsOf(type: string): string[] {
  return Object.keys(ACTION_REQUIRES).filter(t => ACTION_REQUIRES[t].includes(type));
}

/**
 * Work-area → screen routing for the workflow-driven nav. A SYSTEM work-area
 * (matched by id) opens its bespoke screen; a single-purpose COUNTER area opens
 * that action's dedicated screen; anything else (custom / multi-action) opens
 * the generic host at /w/:id which renders the placed actions as panels.
 */
export const SYSTEM_AREA_SCREEN: Record<string, string> = {
  frontdesk: '/frontdesk', lab: '/lab/my-work', validate: '/pathologist',
  results: '/reports', homecoll: '/home-collections', messages: '/messages',
};
export const COUNTER_SCREEN: Record<string, string> = {
  billing: '/billing-counter', sample_collection: '/sample-collection',
  queue: '/frontdesk/queue', home_visits: '/home-collections', messages: '/messages',
};
export function workAreaRoute(area: ProcessCategory, cfg: ProcessWorkflowConfig): string {
  if (SYSTEM_AREA_SCREEN[area.id]) return SYSTEM_AREA_SCREEN[area.id];
  const enabled = (cfg.actions ?? []).filter(a => a.categoryId === area.id && a.enabled);
  if (enabled.length === 1 && COUNTER_SCREEN[enabled[0].type]) return COUNTER_SCREEN[enabled[0].type];
  return `/w/${area.id}`;
}

/**
 * Derive the billing/collection "separate counter" modes FROM the workflow —
 * the workflow is the single source of truth. A billing/collection action that
 * sits in a DIFFERENT menu from patient registration = a separate counter.
 * Returns null when there's no usable workflow (callers fall back to stored).
 */
export function deriveModes(cfg: ProcessWorkflowConfig | null | undefined):
  { collectionMode: 'front_desk' | 'dedicated_counter'; billingMode: 'front_desk' | 'separate_counter' } | null {
  if (!cfg?.actions?.length) return null;
  const menuOf = (type: string) => cfg.actions.find(a => a.type === type && a.enabled)?.categoryId;
  const fd = frontdeskMenu(cfg);
  const coll = collectionLocations(cfg);
  const bill = menuOf('billing');
  return {
    // Backward-compatible projection: any non-frontdesk placement → counter.
    collectionMode: hasDedicatedCollection(cfg) ? 'dedicated_counter' : 'front_desk',
    billingMode: bill && bill !== fd ? 'separate_counter' : 'front_desk',
  };
}

/** Actions that may be placed in MORE THAN ONE menu at once (e.g. sample
 *  collection at the front desk AND a dedicated counter AND the lab). The
 *  builder keeps these in the palette after a drop and mints a fresh instance
 *  per placement. */
export const REPEATABLE_ACTIONS = new Set<string>(['sample_collection']);
export function isRepeatable(type: string): boolean { return REPEATABLE_ACTIONS.has(type); }

/** The categoryId of the "frontdesk" menu (where registration/order live). */
export function frontdeskMenu(cfg: ProcessWorkflowConfig | null | undefined): string | undefined {
  const menuOf = (type: string) => cfg?.actions?.find(a => a.type === type && a.enabled)?.categoryId;
  return menuOf('patient_registration') ?? menuOf('walk_in_order') ?? menuOf('appointment');
}

/** All menus (categoryIds) where an ENABLED `sample_collection` instance sits —
 *  supports the action being placed in several menus at once. */
export function collectionLocations(cfg: ProcessWorkflowConfig | null | undefined): string[] {
  return [...new Set((cfg?.actions ?? [])
    .filter(a => a.type === 'sample_collection' && a.enabled)
    .map(a => a.categoryId))];
}

/** True when collection is placed in the frontdesk menu. */
export function collectsAtFrontdesk(cfg: ProcessWorkflowConfig | null | undefined): boolean {
  const fd = frontdeskMenu(cfg);
  return !!fd && collectionLocations(cfg).includes(fd);
}

/** True when collection is placed in any non-frontdesk menu (a dedicated counter
 *  or the lab). */
export function hasDedicatedCollection(cfg: ProcessWorkflowConfig | null | undefined): boolean {
  const fd = frontdeskMenu(cfg);
  return collectionLocations(cfg).some(m => m !== fd);
}
