/**
 * Two-way (bidirectional) analyzer settings — pure logic, no Angular DI.
 * The `bidirectional` block of an instrument's ConfigJson (bidi CONTRACT §1):
 *
 *   mode: off | query | worklist | both   (absent = off = today's behaviour)
 *   sendPatient, hl7Query, hl7Order, worklistWindowHours (1..168),
 *   worklistPollSeconds (15..3600), orderCodes { testCatalogKey → code }
 *
 * Old instruments stay BYTE-IDENTICAL: a config with no block that is saved
 * with the section untouched (still the defaults) gets NO block written —
 * `buildBidirectional` returns undefined. Once a block exists it is always
 * written back in full (mode "off" included) and keys this UI doesn't know
 * survive. Spec'd in instrument-two-way.spec.ts.
 */
import type { PfSelectOption } from '../primitives/select.component';
import type { Test } from '../models/test.model';
import type { ParserType } from './instrument.models';

export type TwoWayMode = 'off' | 'query' | 'worklist' | 'both';
export type Hl7QueryStyle = 'auto' | 'qry_q02' | 'qbp_q11';
export type Hl7OrderType = 'orm_o01' | 'oml_o21';

/** The stored ConfigJson block (contract §1). */
export interface BidirectionalConfig {
  mode: TwoWayMode;
  sendPatient: boolean;
  hl7Query: Hl7QueryStyle;
  hl7Order: Hl7OrderType;
  worklistWindowHours: number;
  worklistPollSeconds: number;
  orderCodes: Record<string, string>;
  [k: string]: unknown;
}

export interface OrderCodeRow { testCatalogKey: string; code: string }

/** The editor's model of the block (form-friendly: numbers may be blank). */
export interface TwoWayForm {
  mode: TwoWayMode;
  sendPatient: boolean;
  hl7Query: Hl7QueryStyle;
  hl7Order: Hl7OrderType;
  worklistWindowHours: number | null;
  worklistPollSeconds: number | null;
  orderCodes: OrderCodeRow[];
}

export const TWO_WAY_LIMITS = {
  windowHours: { min: 1, max: 168, def: 24 },
  pollSeconds: { min: 15, max: 3600, def: 60 },
  codeMax: 32,
} as const;

/** Characters an HL7 / ASTM order code may never carry (field / component /
 *  repeat / escape / sub-component delimiters + line breaks). */
const FORBIDDEN_CODE_CHARS = /[|^~\\&\r\n]/;

const MODES: readonly TwoWayMode[] = ['off', 'query', 'worklist', 'both'];
const QUERY_STYLES: readonly Hl7QueryStyle[] = ['auto', 'qry_q02', 'qbp_q11'];
const ORDER_TYPES: readonly Hl7OrderType[] = ['orm_o01', 'oml_o21'];

export function emptyTwoWayForm(): TwoWayForm {
  return {
    mode: 'off', sendPatient: false, hl7Query: 'auto', hl7Order: 'orm_o01',
    worklistWindowHours: TWO_WAY_LIMITS.windowHours.def, worklistPollSeconds: TWO_WAY_LIMITS.pollSeconds.def,
    orderCodes: [],
  };
}

// ── Option lists (plain words first, the code as secondary text) ─────────
export interface TwoWayModeOption { value: TwoWayMode; label: string; desc: string }
export const TWO_WAY_MODES: readonly TwoWayModeOption[] = [
  { value: 'off', label: 'Off', desc: 'The analyzer only sends results. Prefrontal never tells it which tests to run.' },
  { value: 'query', label: 'Analyzer asks by barcode', desc: 'The analyzer reads the tube barcode and asks Prefrontal which tests to run.' },
  { value: 'worklist', label: 'Send worklist to analyzer', desc: 'Prefrontal sends today’s collected samples and their tests to the analyzer before you load them.' },
  { value: 'both', label: 'Both', desc: 'Prefrontal sends the worklist ahead, and the analyzer can still ask about any tube it reads.' },
];

export const HL7_QUERY_OPTIONS: PfSelectOption<Hl7QueryStyle>[] = [
  { value: 'auto', label: 'Answer the way the analyzer asked', hint: 'Recommended' },
  { value: 'qry_q02', label: 'Older style', hint: 'QRY^Q02 · e.g. Mindray, Autolab' },
  { value: 'qbp_q11', label: 'Newer style', hint: 'QBP^Q11' },
];

export const HL7_ORDER_OPTIONS: PfSelectOption<Hl7OrderType>[] = [
  { value: 'orm_o01', label: 'Order message', hint: 'ORM^O01 · most analyzers' },
  { value: 'oml_o21', label: 'Lab order message', hint: 'OML^O21 · newer HL7 analyzers' },
];

export const hasQuery = (m: TwoWayMode): boolean => m === 'query' || m === 'both';
export const hasWorklist = (m: TwoWayMode): boolean => m === 'worklist' || m === 'both';
/** HL7 choices only matter when the analyzer speaks (or may speak) HL7. */
export const showsHl7Options = (p: ParserType): boolean => p === 'hl7' || p === 'auto';

export function modeLabel(m: TwoWayMode): string {
  return TWO_WAY_MODES.find((o) => o.value === m)?.label ?? 'Off';
}

// ── ConfigJson → form ────────────────────────────────────────────────────
function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}
function intOr(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/** The block as stored (or absent / malformed) → the editor model. Missing →
 *  Off with the contract defaults; an unknown mode reads as Off. */
export function twoWayFromConfig(raw: unknown): TwoWayForm {
  const f = emptyTwoWayForm();
  if (!isObj(raw)) return f;
  f.mode = pick(raw['mode'], MODES, 'off');
  f.sendPatient = raw['sendPatient'] === true;
  f.hl7Query = pick(raw['hl7Query'], QUERY_STYLES, 'auto');
  f.hl7Order = pick(raw['hl7Order'], ORDER_TYPES, 'orm_o01');
  f.worklistWindowHours = intOr(raw['worklistWindowHours'], TWO_WAY_LIMITS.windowHours.def);
  f.worklistPollSeconds = intOr(raw['worklistPollSeconds'], TWO_WAY_LIMITS.pollSeconds.def);
  const codes = raw['orderCodes'];
  if (isObj(codes)) {
    f.orderCodes = Object.entries(codes)
      .filter(([k, v]) => !!k && typeof v === 'string')
      .map(([k, v]) => ({ testCatalogKey: k, code: v as string }));
  }
  return f;
}

/** True when nothing differs from a fresh (absent) block. */
export function isDefaultTwoWay(f: TwoWayForm): boolean {
  const d = emptyTwoWayForm();
  return f.mode === d.mode && f.sendPatient === d.sendPatient && f.hl7Query === d.hl7Query && f.hl7Order === d.hl7Order
    && (f.worklistWindowHours ?? d.worklistWindowHours) === d.worklistWindowHours
    && (f.worklistPollSeconds ?? d.worklistPollSeconds) === d.worklistPollSeconds
    && !f.orderCodes.some((r) => r.testCatalogKey.trim() && r.code.trim());
}

/** Order-code rows → the stored map: complete rows only, trimmed. */
export function orderCodesMap(rows: readonly OrderCodeRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    const k = r.testCatalogKey.trim();
    const c = r.code.trim();
    if (k && c) out[k] = c;
  }
  return out;
}

/**
 * Form → the stored block. `base` = the block the instrument was loaded with
 * (undefined when it had none). Returns undefined — write NO block — when
 * there was none and the section is still at its defaults, so an old
 * instrument saved without touching this section is unchanged.
 */
export function buildBidirectional(f: TwoWayForm, base?: unknown): BidirectionalConfig | undefined {
  if (!isObj(base) && isDefaultTwoWay(f)) return undefined;
  const extra = isObj(base) ? { ...base } : {};
  return {
    ...extra,
    mode: f.mode,
    sendPatient: f.sendPatient,
    hl7Query: f.hl7Query,
    hl7Order: f.hl7Order,
    worklistWindowHours: f.worklistWindowHours ?? TWO_WAY_LIMITS.windowHours.def,
    worklistPollSeconds: f.worklistPollSeconds ?? TWO_WAY_LIMITS.pollSeconds.def,
    orderCodes: orderCodesMap(f.orderCodes),
  };
}

// ── Validation ───────────────────────────────────────────────────────────
export interface TwoWayIssue { field: 'window' | 'poll' | 'code'; index?: number; message: string }

/** Why an order code can't be used (null = fine). */
export function orderCodeProblem(code: string): string | null {
  const c = code.trim();
  if (!c) return 'Type the code the analyzer expects';
  if (c.length > TWO_WAY_LIMITS.codeMax) return `Keep the code to ${TWO_WAY_LIMITS.codeMax} characters or fewer`;
  if (FORBIDDEN_CODE_CHARS.test(c)) return 'A code can’t contain | ^ ~ \\ or &';
  return null;
}

function inRange(n: number | null, r: { min: number; max: number }): boolean {
  return typeof n === 'number' && Number.isInteger(n) && n >= r.min && n <= r.max;
}

/** Worklist numbers are checked only in worklist modes (hidden otherwise);
 *  order codes are visible — and checked — in every mode, Off included. */
export function validateTwoWay(f: TwoWayForm): TwoWayIssue[] {
  const out: TwoWayIssue[] = [];
  if (hasWorklist(f.mode)) {
    const w = TWO_WAY_LIMITS.windowHours;
    const p = TWO_WAY_LIMITS.pollSeconds;
    if (!inRange(f.worklistWindowHours, w)) out.push({ field: 'window', message: `Hours must be a whole number from ${w.min} to ${w.max}` });
    if (!inRange(f.worklistPollSeconds, p)) out.push({ field: 'poll', message: `Seconds must be a whole number from ${p.min} to ${p.max}` });
  }
  const seen = new Set<string>();
  f.orderCodes.forEach((r, index) => {
    const key = r.testCatalogKey.trim();
    const code = r.code.trim();
    if (!key && !code) return; // a blank row is ignored on save
    if (!key) { out.push({ field: 'code', index, message: 'Pick the test this code is for' }); return; }
    if (seen.has(key)) { out.push({ field: 'code', index, message: 'This test already has an order code' }); return; }
    seen.add(key);
    const problem = orderCodeProblem(code);
    if (problem) out.push({ field: 'code', index, message: problem });
  });
  return out;
}

// ── Test options (any Test Master test with a catalogue key, panels too) ─
export function orderCodeTestOptions(tests: readonly Test[], rows: readonly OrderCodeRow[]): PfSelectOption<string>[] {
  const seen = new Set<string>();
  const out: PfSelectOption<string>[] = [];
  const kind = (t: Test) => (t.type === 'profile' ? 'Profile' : t.type === 'package' ? 'Package' : '');
  for (const t of tests) {
    const key = t.catalogKey?.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ value: key, label: t.name, hint: [t.testCode || t.code, kind(t)].filter(Boolean).join(' · ') || key });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  // A saved key the list no longer carries (switched off / other branch) keeps a label.
  for (const r of rows) {
    const key = r.testCatalogKey.trim();
    if (key && !seen.has(key)) { seen.add(key); out.push({ value: key, label: key, hint: 'Not in the test list' }); }
  }
  return out;
}

// ── "Test a barcode" preview (contract §2 DeviceOrdersDto) ───────────────
export interface DeviceOrderPatient { id: string; name: string; sex: 'M' | 'F' | 'U' | string; dob?: string | null; ageYears?: number | null }
export interface DeviceOrderTest { code: string; testCatalogKey: string; name: string }
export interface DeviceOrdersDto {
  sampleId: string;
  found: boolean;
  priority?: 'urgent' | 'normal' | string | null;
  collectedAt?: string | null;
  specimen?: string | null;
  patient?: DeviceOrderPatient | null;
  tests: DeviceOrderTest[];
  unmapped: { testCatalogKey: string; name: string }[];
}

export interface PreviewView {
  found: boolean;
  sampleId: string;
  /** "Urgent · Whole blood · Collected 14 Oct, 10:40 am" (only parts the data has). */
  meta: string;
  tests: DeviceOrderTest[];
  unmapped: { testCatalogKey: string; name: string }[];
  /** Shown only when patient details are switched on AND the server sent them. */
  patientLine: string | null;
}

const SEX_WORD: Record<string, string> = { M: 'Male', F: 'Female', U: 'Sex not recorded' };

export function patientLine(p: DeviceOrderPatient): string {
  const parts = [p.name?.trim() || 'Name not recorded', SEX_WORD[p.sex] ?? p.sex];
  if (typeof p.ageYears === 'number') parts.push(`${p.ageYears} y`);
  if (p.id) parts.push(`ID ${p.id}`);
  return parts.filter(Boolean).join(' · ');
}

export function previewView(dto: DeviceOrdersDto, sendPatient: boolean, fmtTime: (iso: string) => string = (s) => s): PreviewView {
  const meta: string[] = [];
  if (dto.found) {
    if (dto.priority) meta.push(dto.priority === 'urgent' ? 'Urgent' : 'Normal');
    if (dto.specimen) meta.push(dto.specimen);
    if (dto.collectedAt) meta.push(`Collected ${fmtTime(dto.collectedAt)}`);
  }
  return {
    found: !!dto.found,
    sampleId: dto.sampleId,
    meta: meta.join(' · '),
    tests: dto.found ? dto.tests ?? [] : [],
    unmapped: dto.found ? dto.unmapped ?? [] : [],
    patientLine: dto.found && sendPatient && dto.patient ? patientLine(dto.patient) : null,
  };
}

/** A preview failure in plain words (ApiError code + message). */
export function previewErrorText(code: string | null | undefined, message?: string | null): string {
  if (code === 'not_found') return 'This instrument was not found — it may have been removed.';
  return message?.trim() || 'Couldn’t check that barcode. Try again.';
}

/** Order-code rows for the preview's unmapped tests (blank code, ready to type). */
export function withOrderCodeRowsFor(rows: readonly OrderCodeRow[], keys: readonly string[]): OrderCodeRow[] {
  const have = new Set(rows.map((r) => r.testCatalogKey.trim()).filter(Boolean));
  const out = [...rows];
  for (const k of keys) if (k && !have.has(k)) { have.add(k); out.push({ testCatalogKey: k, code: '' }); }
  return out;
}

export function ordersPreviewUrl(id: string, sampleId: string): string {
  return `/api/instruments/${encodeURIComponent(id)}/orders-preview?sampleId=${encodeURIComponent(sampleId.trim())}`;
}
