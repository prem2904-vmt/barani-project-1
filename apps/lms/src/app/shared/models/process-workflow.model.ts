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
  /**
   * Shipped by us, not the lab: read-only to the tenant and refreshed by every
   * deploy so improvements reach every lab. Saving one does NOT update it — the
   * API forks it into the tenant's own workflow — so the builder must offer
   * "Customise" rather than "Save", or the admin is left wondering why the
   * default they edited is unchanged and a new workflow appeared.
   */
  isSystemDefault?: boolean;
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
  { type: 'billing', label: 'Billing', route: '/frontdesk/order', permissions: ['create_bill', 'collect_payment'],
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
  { type: 'lost_and_found', label: 'Lost & Found', route: '/lost-and-found',
    permissions: ['receive_sample', 'reject_sample', 'cancel_order', 'manage_users'],
    iconPath: ['M22 12h-6l-2 3h-4l-2-3H2', 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z'],
    hint: 'Recover records stranded by a workflow change' },
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

/** A pickable work-area icon (rendered as an inline stroke SVG, viewBox 0 0 24 24). */
export interface WorkAreaIcon { key: string; label: string; path: string[]; }

/** The curated icon set shown in the work-area icon picker (process builder).
 *  A ProcessCategory.icon holds one of these keys; the builder + nav render it
 *  via workAreaIconPath(). Keep viewBox 0 0 24 24, stroke-style (no fills). */
export const WORKAREA_ICONS: WorkAreaIcon[] = [
  { key: 'folder',     label: 'Folder',      path: ['M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z'] },
  { key: 'clipboard',  label: 'Clipboard',   path: ['M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2', 'M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z'] },
  { key: 'reception',  label: 'Reception',   path: ['M9 8a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20a6.5 6.5 0 0 1 13 0', 'M19 8v6M16 11h6'] },
  { key: 'calendar',   label: 'Calendar',    path: ['M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z'] },
  { key: 'billing',    label: 'Billing',     path: ['M3 5h18v14H3zM3 10h18M7 15h3'] },
  { key: 'tube',       label: 'Test tube',   path: ['M9 3h6v4a3 3 0 0 1-1 2.2l-.5.4v8.4A2 2 0 0 1 11.5 20h-3A2 2 0 0 1 6.5 18V9.6L6 9.2A3 3 0 0 1 5 7V3h4'] },
  { key: 'droplet',    label: 'Blood drop',  path: ['M12 2.7 6.34 8.36a8 8 0 1 0 11.32 0z'] },
  { key: 'dispatch',   label: 'Dispatch',    path: ['M3 7h11v8H3z', 'M14 10h4l3 3v2h-7z', 'M7 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z'] },
  { key: 'flask',      label: 'Lab flask',   path: ['M3 12h5l2 3h4l2-3h5', 'M5 12 8 4h8l3 8v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6Z'] },
  { key: 'microscope', label: 'Microscope',  path: ['M6 18h8', 'M3 22h18', 'M14 22a7 7 0 1 0 0-14h-1', 'M9 14h2', 'M9 12a2 2 0 0 1-2-2V6h4v4a2 2 0 0 1-2 2Z', 'M12 6V3a1 1 0 0 0-1-1H8'] },
  { key: 'check',      label: 'Validate',    path: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M8 12l3 3 5-6'] },
  { key: 'report',     label: 'Report',      path: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M9 13h6M9 17h6'] },
  { key: 'inbox',      label: 'Inbox',       path: ['M22 12h-6l-2 3h-4l-2-3H2', 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z'] },
  { key: 'home',       label: 'Home',        path: ['M3 12l9-9 9 9M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10', 'M9 21v-6h6v6'] },
  { key: 'users',      label: 'Team',        path: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'] },
  { key: 'chat',       label: 'Messages',    path: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'] },
  { key: 'pill',       label: 'Pharmacy',    path: ['M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7Z', 'M8.5 8.5l7 7'] },
  { key: 'shield',     label: 'Shield',      path: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z'] },
  { key: 'grid',       label: 'Grid',        path: ['M4 5h5v5H4zM15 5h5v5h-5zM9 16h5v4H9z'] },
];

/** Resolve a work-area icon key to its SVG path list; unknown/empty → Folder. */
export function workAreaIconPath(key: string | null | undefined): string[] {
  return WORKAREA_ICONS.find(i => i.key === key)?.path ?? WORKAREA_ICONS[0].path;
}

/**
 * Lock policy — the professional guardrails. A `locked` action can't be dragged
 * out of its `home` work-area; a `mandatory` action can't be switched off or
 * removed. Code-level (not stored in config) so it can't drift or be bypassed
 * by editing a saved workflow. Actions absent here (billing, queue, dispatch,
 * home_visits, messages) are free to move and disable.
 *
 * LOCKED + REPEATABLE (sample_collection): the lock pins the HOME copy — the
 * one in the system Collect area — which can't be dragged out or removed.
 * Extra copies placed in other areas (Frontdesk, Lab, a billing counter, a
 * custom area) stay freely movable, removable and toggleable. Use
 * isLockedItem() for a placed item; isLocked() only says the TYPE has a lock.
 */
export interface ActionPolicy { home: string; locked?: boolean; mandatory?: boolean; homeMandatory?: boolean; }
export const ACTION_POLICY: Record<string, ActionPolicy> = {
  // homeMandatory: the Collect area's home copy is always on (only its roles
  // change — owner 2026-09-26); copies placed in other areas stay toggleable.
  sample_collection:    { home: 'collect',   locked: true, homeMandatory: true },
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
 * so a screen can't be half-built (no collection ⇒ no dispatch either).
 * Registration is mandatory so deps on it are always satisfied.
 *
 * NOTE: result_entry does NOT require sample_collection. A lab can run without a
 * collection stage — when the collection step is removed, samples are born
 * already "received" at the lab (backend OrderService.CreateAsync), so result
 * entry / validate / results stay live and the order lands straight in the lab.
 * Only dispatch (and its coupled lab_intake) fall away with collection, which is
 * the intended bypass: skip collection + dispatch, land received.
 */
export const ACTION_REQUIRES: Record<string, string[]> = {
  billing:       ['patient_registration'],
  dispatch:      ['sample_collection'],
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
  frontdesk: '/frontdesk', collect: '/sample-collection', lab: '/lab/my-work', validate: '/pathologist',
  results: '/reports', homecoll: '/home-collections', messages: '/messages',
};
export const COUNTER_SCREEN: Record<string, string> = {
  billing: '/billing-counter', sample_collection: '/sample-collection',
  queue: '/frontdesk/queue', home_visits: '/home-collections', messages: '/messages',
  lost_and_found: '/lost-and-found',
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

/**
 * Is THIS placed item pinned (no drag-out, no removal)? A locked, non-repeatable
 * action is pinned wherever it sits (it only ever sits in its home). A locked
 * REPEATABLE action pins only its copy in the home area — the other copies are
 * ordinary placements.
 */
export function isLockedItem(type: string, areaId: string | null | undefined): boolean {
  if (!isLocked(type)) return false;
  return !isRepeatable(type) || areaId === actionHome(type);
}

/** Can THIS placed item never be switched off? Mandatory types everywhere, plus
 *  a `homeMandatory` type's copy in its home area (the Collect area's Sample
 *  collection) — its other copies stay toggleable. */
export function isMandatoryItem(type: string, areaId: string | null | undefined): boolean {
  if (isMandatory(type)) return true;
  const pol = ACTION_POLICY[type];
  return !!pol?.homeMandatory && areaId === pol.home;
}

/** The system "Collect" work-area: its screen is the Collect page
 *  (/sample-collection) and it is the locked home of `sample_collection`. */
export const COLLECT_AREA_ID = 'collect';
export const COLLECT_AREA_DEFAULT_ROLES = ['Sample Collector', 'Lab Admin', 'Branch Manager'];
/** Stable id of the home `sample_collection` copy the normaliser inserts — a
 *  fixed id keeps normalisation idempotent across reads. */
export const COLLECT_HOME_ACTION_ID = 'collect-home';

/** Area ids that are system areas in their own right — never adopted as the
 *  Collect area even if they only hold collection. */
const NON_COLLECT_SYSTEM_AREAS = new Set(['frontdesk', 'lab', 'validate', 'results', 'homecoll', 'messages']);

/**
 * THE shared workflow normaliser: guarantee the system Collect area and its
 * locked home `sample_collection` copy. Saved workflows predating the Collect
 * area (every tenant workflow + the shipped defaults) are brought forward on
 * READ — the live nav gets Collect with no DB write; saving in the builder
 * persists it.
 *
 *  • Already has `collect` → only ensures its home copy exists.
 *  • Has a dedicated collection menu (a non-system area whose only actions are
 *    `sample_collection`, e.g. "Collection Center") → THAT menu becomes the
 *    Collect area (id remapped to `collect`; name, icon, roles, order and the
 *    copy's enabled state kept) instead of adding a duplicate.
 *  • Otherwise → inserts "Collect" right after the frontdesk area with an
 *    ENABLED home copy and the default roles.
 *
 * Empty / missing configs are returned untouched (no workflow ⇒ the static
 * fallback nav applies). Idempotent; returns the SAME object when nothing
 * needed changing.
 */
export function normalizeWorkflow<T extends ProcessWorkflowConfig | null | undefined>(cfg: T): T {
  if (!cfg || !Array.isArray(cfg.categories) || cfg.categories.length === 0) return cfg;
  const actions = cfg.actions ?? [];
  const hasHomeCopy = (acts: ProcessAction[]) =>
    acts.some(a => a.type === 'sample_collection' && a.categoryId === COLLECT_AREA_ID);
  const homeCopy = (order: number): ProcessAction => ({
    id: COLLECT_HOME_ACTION_ID, type: 'sample_collection', categoryId: COLLECT_AREA_ID, order, enabled: true,
  });

  // The home copy is always on (homeMandatory) — heal a saved "off".
  const homeOff = actions.some(a => a.type === 'sample_collection' && a.categoryId === COLLECT_AREA_ID && !a.enabled);
  if (homeOff) {
    return normalizeWorkflow({
      ...cfg,
      actions: actions.map(a => a.type === 'sample_collection' && a.categoryId === COLLECT_AREA_ID ? { ...a, enabled: true } : a),
    } as T);
  }

  if (cfg.categories.some(c => c.id === COLLECT_AREA_ID)) {
    if (hasHomeCopy(actions)) return cfg;
    const n = actions.filter(a => a.categoryId === COLLECT_AREA_ID).length;
    return { ...cfg, actions: [...actions, homeCopy(n)] } as T;
  }

  const sorted = [...cfg.categories].sort((a, b) => a.order - b.order);
  // A dedicated collection menu: a non-system area whose only actions are
  // sample_collection copies. First by order wins.
  const dedicated = sorted.find(c => {
    if (NON_COLLECT_SYSTEM_AREAS.has(c.id)) return false;
    const inArea = actions.filter(a => a.categoryId === c.id);
    return inArea.length > 0 && inArea.every(a => a.type === 'sample_collection');
  });
  if (dedicated) {
    const oldId = dedicated.id;
    return {
      ...cfg,
      categories: cfg.categories.map(c => c.id === oldId ? { ...c, id: COLLECT_AREA_ID } : c),
      actions: actions.map(a => a.categoryId === oldId ? { ...a, categoryId: COLLECT_AREA_ID, enabled: true } : a),
    } as T;
  }

  // Insert right after the frontdesk area (the literal system id, else the
  // area holding registration); none → first.
  const fdId = sorted.some(c => c.id === 'frontdesk') ? 'frontdesk' : frontdeskMenu(cfg);
  const fdIdx = fdId ? sorted.findIndex(c => c.id === fdId) : -1;
  const collect: ProcessCategory = {
    id: COLLECT_AREA_ID, name: 'Collect', icon: 'tube', color: '#7c3aed', order: 0,
    roles: [...COLLECT_AREA_DEFAULT_ROLES],
  };
  sorted.splice(fdIdx + 1, 0, collect);
  return {
    ...cfg,
    categories: sorted.map((c, i) => ({ ...c, order: i })),
    actions: [...actions, homeCopy(0)],
  } as T;
}

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

/**
 * The work-areas (category ids) that hold an ENABLED `sample_collection` in the
 * active workflow — the Process builder's placements. Drives the band "Collect"
 * entry point (pf-collect-band-button): every screen of such an area gets it.
 * No workflow configured → [] (no band button; screens keep their own flows).
 */
export function areasWithCollection(cfg: ProcessWorkflowConfig | null | undefined): string[] {
  return collectionLocations(cfg);
}

/** Screen key for the separate billing counter (/billing-counter). It has no
 *  fixed work-area id — it belongs to whichever area holds `billing`. */
export const BILLING_COUNTER_SCREEN = 'billing-counter';

/**
 * The work-area a SCREEN belongs to, mirroring the nav's area → route mapping
 * (SYSTEM_AREA_SCREEN / COUNTER_SCREEN / `/w/:id`):
 *   • 'frontdesk'        → the menu holding registration (FD landing, Order & Payments)
 *   • 'billing-counter'  → the menu holding the enabled `billing` action
 *   • anything else      → taken as the area id itself ('lab', a `/w/:id` menuId)
 */
export function screenWorkArea(screen: string, cfg: ProcessWorkflowConfig | null | undefined): string | null {
  if (!screen) return null;
  if (screen === 'frontdesk') return frontdeskMenu(cfg) ?? 'frontdesk';
  if (screen === BILLING_COUNTER_SCREEN) {
    return cfg?.actions?.find(a => a.type === 'billing' && a.enabled)?.categoryId ?? null;
  }
  return screen;
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

/**
 * True when the workflow puts sample collection AT the separate billing
 * counter — an enabled `sample_collection` sits in the same (non-frontdesk)
 * menu as the enabled `billing` action. The billing counter only offers
 * "Collect sample" after payment when this holds; otherwise the paid patient
 * simply moves on to wherever collection lives (the collection queue).
 */
export function collectsAtBillingCounter(cfg: ProcessWorkflowConfig | null | undefined): boolean {
  const bill = cfg?.actions?.find(a => a.type === 'billing' && a.enabled)?.categoryId;
  if (!bill || bill === frontdeskMenu(cfg)) return false;
  return areasWithCollection(cfg).includes(bill);
}

/** The categoryId of the built-in Lab work-area (see SYSTEM_AREA_SCREEN). */
export const LAB_MENU_ID = 'lab';

/**
 * True when sample collection is placed in the LAB work-area — a patient can
 * give the sample at the lab itself, where collection doubles as intake and
 * auto-receives into the work queue (backend SampleService.CollectAsync, gated by
 * ShouldAutoReceiveAsync). It does NOT switch the transport pair off (owner,
 * 2026-09-26): the front desk may still collect + dispatch, so Dispatch and Lab
 * Intake keep whatever state the admin set. NOTE: the backend's auto-receive is
 * workflow-wide today (any enabled lab copy ⇒ every collection auto-receives) —
 * see ProcessWorkflowService.dispatchStepEnabled.
 */
export function collectsInLab(cfg: ProcessWorkflowConfig | null | undefined): boolean {
  return collectionLocations(cfg).includes(LAB_MENU_ID);
}
