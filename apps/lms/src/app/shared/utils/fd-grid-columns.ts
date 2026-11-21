/**
 * Frontdesk WORK grid columns (owner-approved mock grid-settings-v3, 2026-11-21) — the ONE typed catalogue the
 * Settings page ("Work grid columns" in each module's Front desk settings) and the Frontdesk flow grid share.
 *
 *  - Each module (Lab, OPD, IPD, Emergency, Scan) has its own list. Token · Patient · Where now are locked first, Waiting · Next
 *    locked last (Waiting sits right before Next in every grid — the same x in every section, owner 2026-11-21).
 *  - The admin's saved list (an ordered id list + `staffMayHide`, per branch, per module) is merged against this
 *    catalogue: unknown / removed ids are ignored, locked ones are put back in place, catalogue columns added later
 *    stay OFF until the admin adds them. Nothing saved = the catalogue's defaults.
 *  - "Needs data" columns are ones no feed carries today. Each names the row field it reads (`dataField`); the
 *    moment a feed carries it, `columnHasData` sees it and the column becomes available — no catalogue edit needed.
 *  - No Lab "Tests" column (house rule 2026-11-20: long test lists made rows 6–8 lines).
 *
 * Pure: no Angular, no storage except the try/catch localStorage helpers for the per-user hide list.
 */

export type FdModule = 'lab' | 'opd' | 'ipd' | 'er' | 'scan';
export const FD_MODULES: readonly FdModule[] = ['lab', 'opd', 'ipd', 'er', 'scan'];
export const FD_MODULE_LABEL: Record<FdModule, string> = { lab: 'Lab', opd: 'OPD', ipd: 'IPD', er: 'Emergency', scan: 'Scan' };

export type FdColAlign = 'left' | 'center' | 'right';

/** Where a needs-data column's value would come from (the order, or the OPD visit) and under which field name. */
export interface FdDataField { readonly on: 'order' | 'visit'; readonly field: string }

export interface FdColumn {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly defaultOn: boolean;
  /** Always shown, never moved (Token + Patient first, Next last). */
  readonly locked: boolean;
  /** No feed carries this yet: greyed in the palette until `columnHasData` finds it. */
  readonly needsData?: FdDataField;
  readonly align: FdColAlign;
  /** Laid-out minimum width in the work grid (px) and flex share (0 = fixed at `min`). */
  readonly min: number;
  readonly flex: number;
}

const col = (id: string, label: string, description: string, defaultOn: boolean, align: FdColAlign, min: number, flex = 0,
  needsData?: FdDataField): FdColumn => ({ id, label, description, defaultOn, locked: false, align, min, flex, ...(needsData ? { needsData } : {}) });
const locked = (id: string, label: string, description: string, align: FdColAlign, min: number, flex = 0): FdColumn =>
  ({ id, label, description, defaultOn: true, locked: true, align, min, flex });

const TOKEN = (d = 'Visit number for today') => locked('token', 'Token', d, 'center', 100);
const PATIENT = (d = 'Name · age/sex · MRN') => locked('patient', 'Patient', d, 'left', 220, 1.6);
/** Where now = the journey ring + two lines of words in ONE column (owner design D, 2026-11-21) — fixed third, like the
 *  sections (the same x in every section). */
const WHERE = locked('where', 'Where now', 'Journey ring + what is happening now', 'left', 212, 1.2);
/** Waiting is FIXED right before Next (owner 2026-11-21: the same x in every section), so it is locked too. */
const WAITING = (d = 'Time since arrival, rose when late') => locked('waiting', 'Waiting', d, 'center', 112);
const PAYMENT = (d: string) => col('payment', 'Payment', d, true, 'center', 110);
const NEXT = locked('next', 'Next', 'The one action for this row', 'right', 156);

/** The catalogue (the owner's mock lists, in their order). */
export const FD_COLUMNS: Record<FdModule, readonly FdColumn[]> = {
  lab: [
    TOKEN(), PATIENT(), WHERE,
    col('samples', 'Samples', 'Tubes drawn of total', true, 'center', 120),
    PAYMENT('Paid · ₹ due · Not billed'),
    col('due', 'Report due', 'Time left to promised report', false, 'center', 110, 0, { on: 'order', field: 'reportDueAt' }),
    col('priority', 'Priority', 'Urgent / Normal', false, 'center', 104),
    col('refdoc', 'Referred by', 'Referring doctor', false, 'left', 130, 0.8),
    col('visit', 'Visit type', 'Walk-in · Appointment · Home', false, 'left', 120),
    col('orderid', 'Order ID', 'Order number', false, 'left', 150),
    col('branch', 'Branch', 'Multi-branch labs only', false, 'left', 110),
    WAITING(), NEXT,
  ],
  opd: [
    TOKEN(), PATIENT(), WHERE,
    col('doctor', 'Doctor', 'Consulting doctor', true, 'left', 130, 0.8),
    col('vitals', 'Vitals', 'Done · Pending', true, 'center', 110),
    PAYMENT('Paid · ₹ due'),
    col('dept', 'Speciality', 'General medicine, Diabetology…', false, 'left', 140, 0.6),
    col('appt', 'Appointment', 'Booked time, or Walk-in', false, 'center', 120, 0, { on: 'visit', field: 'appointmentTime' }),
    col('visit', 'Visit type', 'New · Follow-up', false, 'left', 120),
    col('ahead', 'Queue', 'How many ahead for this doctor', false, 'center', 100),
    col('room', 'Room', 'Consulting room number', false, 'center', 96, 0, { on: 'visit', field: 'room' }),
    WAITING(), NEXT,
  ],
  ipd: [
    TOKEN('Admission number'), PATIENT(), WHERE,
    col('doctor', 'Doctor', 'Admitting doctor', true, 'left', 130, 0.8),
    col('admitted', 'Admitted', 'Admission date and time', true, 'center', 120),
    PAYMENT('Advance paid · ₹ due'),
    col('days', 'Days in', 'Days since admission', false, 'center', 96),
    col('ward', 'Ward · bed', 'Ward and bed number', false, 'left', 120, 0, { on: 'order', field: 'wardBed' }),
    col('discharge', 'Discharge', 'Planned discharge', false, 'center', 120, 0, { on: 'order', field: 'plannedDischargeAt' }),
    WAITING('Time since admission'), NEXT,
  ],
  er: [
    TOKEN('ER number'), PATIENT('Name · age/sex (or Unknown)'), WHERE,
    col('arrived', 'Arrived', 'Arrival time', true, 'center', 96),
    col('doctor', 'Doctor', 'Doctor on duty', false, 'left', 130, 0.8),
    col('triage', 'Triage', 'Level 1–5', false, 'center', 96, 0, { on: 'order', field: 'triageLevel' }),
    col('bay', 'Bay', 'Bed / bay', false, 'center', 90, 0, { on: 'order', field: 'bay' }),
    WAITING('Time since arrival'), NEXT,
  ],
  scan: [
    TOKEN(), PATIENT(), WHERE,
    col('study', 'Study', 'USG Abdomen, X-ray chest…', true, 'left', 140, 0.8, { on: 'order', field: 'studyName' }),
    PAYMENT('Paid · ₹ due'),
    col('prep', 'Preparation', 'Fasting · full bladder · ready', false, 'left', 120, 0, { on: 'order', field: 'preparation' }),
    col('radiologist', 'Radiologist', 'Reporting doctor', false, 'left', 130, 0, { on: 'order', field: 'radiologistName' }),
    WAITING('Time since arrival'), NEXT,
  ],
};

export const FD_LOCKED_FIRST = ['token', 'patient', 'where'] as const;
/** Locked at the end, in this order: Waiting (fixed before Next), then Next. */
export const FD_LOCKED_LAST = ['waiting', 'next'] as const;

/** Old ids still found in saved settings → today's: the Journey column merged into Where now (same alias as the flow
 *  grid's `flowColId`, frontdesk-landing/flow-grid/flow-fold.ts — keep the two in step). */
export const FD_COL_ALIAS: Readonly<Record<string, string>> = { journey: 'where' };

export function fdColumn(module: FdModule, id: string): FdColumn | undefined {
  return FD_COLUMNS[module].find(c => c.id === id);
}

/** The catalogue defaults, in catalogue order. A needs-data column is never on by default. */
export function defaultFdColumns(module: FdModule): string[] {
  return FD_COLUMNS[module].filter(c => c.defaultOn && !c.needsData).map(c => c.id);
}

/**
 * The columns to show, in order: Token · Patient · the saved middle columns (known, unlocked, each once) · Next.
 * `saved` null / not a list = nothing saved → the defaults. Unknown or removed ids are ignored; catalogue columns that
 * are not in the saved list stay off (a new catalogue column never appears by itself).
 */
export function mergeFdColumns(module: FdModule, saved: readonly unknown[] | null | undefined): string[] {
  if (!Array.isArray(saved)) return defaultFdColumns(module);
  const mid: string[] = [];
  for (const raw of saved) {
    if (typeof raw !== 'string') continue;
    const c = fdColumn(module, FD_COL_ALIAS[raw] ?? raw);
    if (!c || c.locked || mid.includes(c.id)) continue;
    mid.push(c.id);
  }
  return [...FD_LOCKED_FIRST, ...mid, ...FD_LOCKED_LAST];
}

/** Clamp an insertion index so Token + Patient stay first and Waiting · Next stay last. */
function clampIndex(order: readonly string[], index: number): number {
  return Math.max(FD_LOCKED_FIRST.length, Math.min(index, order.length - FD_LOCKED_LAST.length));
}

/**
 * Put `id` at `index` (an index into the CURRENT order, i.e. "before the column now at index"). Moving an existing
 * column accounts for its own slot. Locked or unknown ids leave the order unchanged.
 */
export function insertFdColumn(module: FdModule, order: readonly string[], id: string, index: number): string[] {
  const c = fdColumn(module, id);
  if (!c || c.locked) return [...order];
  const next = [...order];
  let at = index;
  const from = next.indexOf(id);
  if (from >= 0) { next.splice(from, 1); if (from < at) at--; }
  at = clampIndex(next, at);
  next.splice(at, 0, id);
  return next;
}

/** The + button: add at the end of the movable columns (before Waiting · Next). */
export function addFdColumn(module: FdModule, order: readonly string[], id: string): string[] {
  if (order.includes(id)) return [...order];
  return insertFdColumn(module, order, id, order.length - FD_LOCKED_LAST.length);
}

/** Drag back to the palette, or ✕: locked columns stay. */
export function removeFdColumn(module: FdModule, order: readonly string[], id: string): string[] {
  const c = fdColumn(module, id);
  if (!c || c.locked) return [...order];
  return order.filter(x => x !== id);
}

/** Alt+← / Alt+→ on a focused header: one step, never past the locked columns. */
export function moveFdColumn(module: FdModule, order: readonly string[], id: string, delta: -1 | 1): string[] {
  const i = order.indexOf(id);
  const c = fdColumn(module, id);
  if (i < 0 || !c || c.locked) return [...order];
  const to = i + delta;
  if (to < FD_LOCKED_FIRST.length || to > order.length - FD_LOCKED_LAST.length - 1) return [...order];
  const next = [...order];
  next.splice(i, 1);
  next.splice(to, 0, id);
  return next;
}

/** Palette: what can be added (catalogue order) and what is waiting for data. */
export function fdPalette(module: FdModule, order: readonly string[], ready: ReadonlySet<string> = new Set()):
  { ready: FdColumn[]; soon: FdColumn[] } {
  const off = FD_COLUMNS[module].filter(c => !c.locked && !order.includes(c.id));
  return {
    ready: off.filter(c => !c.needsData || ready.has(c.id)),
    soon: off.filter(c => !!c.needsData && !ready.has(c.id)),
  };
}

// ── Saved config ────────────────────────────────────────────────────────────────────────────────────────────

export interface FdGridConfig { columns: string[]; staffMayHide: boolean }
export type FdGridSettings = Partial<Record<FdModule, FdGridConfig>>;

/** The effective config for a module from what the server returned (null = nothing saved). Staff may hide by default. */
export function fdConfigOf(module: FdModule, saved: Partial<FdGridConfig> | null | undefined): FdGridConfig {
  return {
    columns: mergeFdColumns(module, saved && Array.isArray(saved.columns) ? saved.columns : null),
    staffMayHide: saved?.staffMayHide ?? true,
  };
}

export function isDefaultFdColumns(module: FdModule, order: readonly string[]): boolean {
  const d = defaultFdColumns(module);
  return d.length === order.length && d.every((x, i) => order[i] === x);
}

// ── Needs data ──────────────────────────────────────────────────────────────────────────────────────────────

/** Any row shape that carries the order and / or the OPD visit (the Frontdesk FlowRow does). */
export interface FdDataSource { order?: object | null; visit?: object | null }

const present = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== '';

/** The value a needs-data column would show, read from its named field (undefined while no feed carries it). */
export function fdDataValue(c: FdColumn, row: FdDataSource): unknown {
  if (!c.needsData) return undefined;
  const src = (c.needsData.on === 'visit' ? row.visit : row.order) as Record<string, unknown> | null | undefined;
  return src ? src[c.needsData.field] : undefined;
}

/** True when at least one of `rows` carries the column's data (a column without `needsData` always has it). */
export function columnHasData(c: FdColumn, rows: readonly FdDataSource[]): boolean {
  if (!c.needsData) return true;
  return rows.some(r => present(fdDataValue(c, r)));
}

/** The needs-data columns of `module` that the given rows already carry (the palette offers them). */
export function readyFdColumns(module: FdModule, rows: readonly FdDataSource[]): Set<string> {
  return new Set(FD_COLUMNS[module].filter(c => c.needsData && columnHasData(c, rows)).map(c => c.id));
}

// ── Staff hide (per user, this browser) ─────────────────────────────────────────────────────────────────────

export const fdHiddenKey = (tenantId: string | null | undefined, userId: string | null | undefined, module: FdModule) =>
  `pf.fd.hiddenCols.${tenantId || 'tenant'}.${userId || 'anon'}.${module}`;

export function loadFdHidden(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const v = raw ? JSON.parse(raw) : null;
    return Array.isArray(v) ? v.filter((x: unknown): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

export function saveFdHidden(key: string, ids: readonly string[]): void {
  try {
    if (ids.length) localStorage.setItem(key, JSON.stringify(ids));
    else localStorage.removeItem(key);
  } catch { /* private mode: not remembered */ }
}

/** What one person sees: the admin's columns minus the ones they hid (only while staff may hide; never a locked one). */
export function visibleFdColumns(module: FdModule, cfg: FdGridConfig, hidden: readonly string[]): string[] {
  if (!cfg.staffMayHide || !hidden.length) return [...cfg.columns];
  return cfg.columns.filter(id => fdColumn(module, id)?.locked || !hidden.includes(id));
}
