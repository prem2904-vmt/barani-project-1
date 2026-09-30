import type { ReportTemplate } from '../models/report.model';
import { parseTemplateMeta } from './report-header-layout';

/**
 * REPORT SEQUENCING — the order things print in (Report designer → Sequencing).
 *
 * Today's order (the DEFAULT, kept byte-for-byte until a lab edits it):
 *   The renderer prints the report snapshot in its own order. The server builds
 *   that order tube by tube (tubes in creation order, a timed series' later draws
 *   after the ordinary tubes); inside a tube the lines keep the order they were
 *   requested at the desk (`Position`, then name); a profile's members are
 *   gathered at the profile's first line in the profile's printed-report order
 *   (`reportOrder[]`, else its lab-entry `items[]`). Departments then print in
 *   the order they are FIRST SEEN in that sequence, and each department's tests
 *   in that same sequence. Nothing sorts by test number today.
 *
 * A lab can change it — stored in the report template's metadata (tenant-wide,
 * like the template itself) under `sequencing`:
 *   - `departments`: the department print order. Departments not listed (added
 *     later) print after the listed ones, in today's first-seen order.
 *   - `mode`: the lab-wide order INSIDE a department — 'ordered' (today),
 *     'code' (test number), 'alpha' (alphabetical).
 *   - `depts[<department id>]`: a department's own mode, incl. 'custom' with an
 *     `items` list. Unlisted items (a test added later) print after the listed
 *     ones, in the lab-wide mode's order.
 *
 * The unit being ordered is an ITEM: a test ordered on its own, or a PROFILE as
 * one block (its members keep the profile's internal order). Reordering the
 * snapshot's tests before the renderer runs moves everything that follows that
 * order — department bands + sign-offs, the abnormal-results sheet, culture /
 * narrative sections, charts, "Tested at" lines — with no other renderer change.
 *
 * Identity: departments by id (snapshots from mw carrying `departmentId`), then
 * by code, then by name (older snapshots); items by test id, then by test code.
 */

export type SequenceMode = 'ordered' | 'code' | 'alpha';
export type DeptSequenceMode = SequenceMode | 'custom';

/** A stored reference to a department / orderable item. `code` / `name` are
 *  fallbacks for snapshots without the id (and a readable label when the
 *  referenced row is gone). */
export interface SequenceRef { id: string; code?: string | null; name?: string | null }

/** One department's own order. `code` / `name` identify the department on a
 *  snapshot that carries no department id. */
export interface DeptSequence { mode?: DeptSequenceMode; items?: SequenceRef[]; code?: string | null; name?: string | null }

export interface ReportSequencing {
  departments?: SequenceRef[];
  mode?: SequenceMode;
  depts?: Record<string, DeptSequence>;
}

const MODES: readonly string[] = ['ordered', 'code', 'alpha'];
const DEPT_MODES: readonly string[] = [...MODES, 'custom'];

function cleanRef(v: unknown): SequenceRef | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const id = typeof o['id'] === 'string' ? o['id'].trim() : '';
  const code = typeof o['code'] === 'string' && o['code'].trim() ? o['code'].trim() : null;
  const name = typeof o['name'] === 'string' && o['name'].trim() ? o['name'].trim() : null;
  if (!id && !code && !name) return null;
  const r: SequenceRef = { id };
  if (code) r.code = code;
  if (name) r.name = name;
  return r;
}

const cleanRefs = (v: unknown): SequenceRef[] =>
  Array.isArray(v) ? v.map(cleanRef).filter((r): r is SequenceRef => !!r) : [];

/** The template's sequencing config, cleaned. Empty object = today's order. */
export function readReportSequencing(tpl: Pick<ReportTemplate, 'metadata'> | null | undefined): ReportSequencing {
  const raw = parseTemplateMeta(tpl)['sequencing'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const src = raw as Record<string, unknown>;
  const out: ReportSequencing = {};
  const departments = cleanRefs(src['departments']);
  if (departments.length) out.departments = departments;
  if (typeof src['mode'] === 'string' && MODES.includes(src['mode']) && src['mode'] !== 'ordered') {
    out.mode = src['mode'] as SequenceMode;
  }
  const d = src['depts'];
  if (d && typeof d === 'object' && !Array.isArray(d)) {
    const depts: Record<string, DeptSequence> = {};
    for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
      if (!k || !v || typeof v !== 'object') continue;
      const e = v as Record<string, unknown>;
      const mode = typeof e['mode'] === 'string' && DEPT_MODES.includes(e['mode']) ? e['mode'] as DeptSequenceMode : undefined;
      if (!mode) continue;                                   // no mode = follows the lab-wide one
      const ds: DeptSequence = { mode };
      if (mode === 'custom') ds.items = cleanRefs(e['items']);
      if (typeof e['code'] === 'string' && e['code'].trim()) ds.code = e['code'].trim();
      if (typeof e['name'] === 'string' && e['name'].trim()) ds.name = e['name'].trim();
      depts[k] = ds;
    }
    if (Object.keys(depts).length) out.depts = depts;
  }
  return out;
}

/** True when the config changes nothing — the renderer then leaves the
 *  snapshot untouched (byte-identical output for labs that never edit it). */
export function isDefaultSequencing(s: ReportSequencing | null | undefined): boolean {
  return !s || (!s.departments?.length && (s.mode ?? 'ordered') === 'ordered' && !s.depts);
}

/** New `metadata` string with the sequencing written (removed when default),
 *  keeping every other metadata key. */
export function writeReportSequencing(tpl: Pick<ReportTemplate, 'metadata'> | null | undefined, s: ReportSequencing | null): string {
  const meta = parseTemplateMeta(tpl);
  const clean = s ? readReportSequencing({ metadata: JSON.stringify({ sequencing: s }) }) : {};
  if (isDefaultSequencing(clean)) delete meta['sequencing'];
  else meta['sequencing'] = clean;
  return JSON.stringify(meta);
}

// ─── Applying it ────────────────────────────────────────────────────────────

/** The snapshot fields the sequencer reads (a subset of ReportSnapshot tests). */
export interface SequencedTest {
  testId?: string;
  name?: string;
  code?: string | null;
  department?: string;
  departmentCode?: string;
  departmentId?: string | null;
  packageTestId?: string | null;
  packageType?: string | null;
  packageName?: string | null;
  profileTestId?: string | null;
  profileName?: string | null;
  profileCode?: string | null;
}

/** The PROFILE a line compiles under on the report — the same rule the
 *  renderer groups with: its nearest profile, else a profile-typed bundle,
 *  else (legacy snapshot without packageType) the ordered bundle. */
export function reportBundleOf(t: SequencedTest): string | null {
  const legacy = t.packageType == null;
  return t.profileTestId
    ?? (t.packageType === 'profile' ? t.packageTestId : null)
    ?? (legacy ? t.packageTestId : null)
    ?? null;
}

interface Unit<T> {
  tests: T[];
  /** Department identity of the unit's first line. */
  deptId: string; deptCode: string; deptName: string;
  itemId: string; itemCode: string; itemName: string;
  seen: number;
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toUpperCase();

/** Test-number compare: numeric-aware ("BIO2" < "BIO10"), missing codes last. */
export function compareTestCodes(a: string, b: string): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
}

const compareNames = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });

/** Index of a unit in a ref list: id first, then code (then name for
 *  departments — `useName`). -1 = not listed. */
function refIndex(refs: SequenceRef[], id: string, code: string, name: string, useName: boolean): number {
  if (id) { const i = refs.findIndex(r => !!r.id && r.id === id); if (i >= 0) return i; }
  if (code) { const i = refs.findIndex(r => norm(r.code) === code); if (i >= 0) return i; }
  if (useName && name) { const i = refs.findIndex(r => norm(r.name) === name); if (i >= 0) return i; }
  return -1;
}

function sortUnits<T>(units: Unit<T>[], mode: SequenceMode): Unit<T>[] {
  const u = units.slice();
  if (mode === 'code') u.sort((a, b) => compareTestCodes(a.itemCode, b.itemCode) || a.seen - b.seen);
  else if (mode === 'alpha') u.sort((a, b) => compareNames(a.itemName, b.itemName) || a.seen - b.seen);
  else u.sort((a, b) => a.seen - b.seen);
  return u;
}

/** The department config that applies to a unit's department (by id, then by
 *  the code / name of a listed department with that key). */
function deptConfig<T>(s: ReportSequencing, u: Unit<T>): DeptSequence | undefined {
  const depts = s.depts;
  if (!depts) return undefined;
  if (u.deptId && depts[u.deptId]) return depts[u.deptId];
  // Older snapshot (no departmentId): match the department's code, then name.
  const own = Object.values(depts);
  return (u.deptCode ? own.find(d => norm(d.code) === u.deptCode) : undefined)
    ?? (u.deptName ? own.find(d => norm(d.name) === u.deptName) : undefined);
}

/**
 * Reorder a report's tests by the lab's sequencing. Returns the SAME array when
 * the config is the default (today's order). Every line stays; only the order
 * changes. A profile's lines move as one block and keep their relative order.
 */
export function applyReportSequencing<T extends SequencedTest>(tests: T[], s: ReportSequencing | null | undefined): T[] {
  if (!Array.isArray(tests) || tests.length < 2 || !s || isDefaultSequencing(s)) return tests;

  // 1. Units: a standalone line, or every line of one profile (at the slot of
  //    its first line — the renderer compiles them there anyway).
  const units: Unit<T>[] = [];
  const byBundle = new Map<string, Unit<T>>();
  tests.forEach((t, i) => {
    if (!t) return;
    const bundle = reportBundleOf(t);
    if (bundle) {
      const hit = byBundle.get(bundle);
      if (hit) { hit.tests.push(t); return; }
    }
    const unit: Unit<T> = {
      tests: [t],
      deptId: (t.departmentId ?? '').trim(),
      deptCode: norm(t.departmentCode),
      deptName: norm(t.department),
      itemId: bundle ?? (t.testId ?? ''),
      // A profile sorts by its OWN number (mw `profileCode`); a snapshot from
      // before that field falls back to its first member's number.
      itemCode: norm(bundle ? (t.profileCode || t.code) : t.code),
      itemName: ((bundle
        ? (t.profileTestId === bundle ? t.profileName : t.packageName) || t.profileName || t.packageName
        : null) || t.name || '').trim(),
      seen: i,
    };
    if (bundle) byBundle.set(bundle, unit);
    units.push(unit);
  });
  // Lines the loop skipped (null entries) keep nothing to order — rare junk;
  // never drop them: they ride at the end exactly as before.
  const junk = tests.filter(t => !t);

  // 2. Departments in today's first-seen order.
  const deptKey = (u: Unit<T>) => u.deptId || u.deptCode || u.deptName;
  const deptOrder: string[] = [];
  const byDept = new Map<string, Unit<T>[]>();
  for (const u of units) {
    const k = deptKey(u);
    if (!byDept.has(k)) { byDept.set(k, []); deptOrder.push(k); }
    byDept.get(k)!.push(u);
  }

  // 3. The lab's department order: listed first (by list position), the rest
  //    after in first-seen order.
  const refs = s.departments ?? [];
  const rank = (k: string) => {
    const u = byDept.get(k)![0];
    const i = refIndex(refs, u.deptId, u.deptCode, u.deptName, true);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const sortedDepts = deptOrder
    .map((k, i) => ({ k, i, r: rank(k) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(x => x.k);

  // 4. Inside each department.
  const labMode: SequenceMode = s.mode ?? 'ordered';
  const out: T[] = [];
  for (const k of sortedDepts) {
    const du = byDept.get(k)!;
    const cfg = deptConfig(s, du[0]);
    const mode = cfg?.mode ?? labMode;
    let ordered: Unit<T>[];
    if (mode === 'custom') {
      const items = cfg?.items ?? [];
      const base = sortUnits(du, labMode);
      const pos = new Map(base.map((u, i) => [u, i]));
      const idx = (u: Unit<T>) => {
        const i = refIndex(items, u.itemId, u.itemCode, '', false);
        return i < 0 ? Number.MAX_SAFE_INTEGER : i;
      };
      ordered = base.slice().sort((a, b) => idx(a) - idx(b) || pos.get(a)! - pos.get(b)!);
    } else {
      ordered = sortUnits(du, mode);
    }
    for (const u of ordered) out.push(...u.tests);
  }
  out.push(...junk);
  return out;
}

/** Order a list of departments for the designer: the saved order first
 *  (matched by id → code → name), departments added since appended in the
 *  given (default) order. Saved entries whose department is gone are dropped. */
export function orderDepartmentsForEditor<D extends { id: string; code?: string | null; name?: string | null }>(
  all: D[], saved: SequenceRef[] | undefined,
): D[] {
  if (!saved?.length) return all.slice();
  const withRank = all.map((d, i) => ({
    d, i, r: (() => { const x = refIndex(saved, d.id, norm(d.code), norm(d.name), true); return x < 0 ? Number.MAX_SAFE_INTEGER : x; })(),
  }));
  return withRank.sort((a, b) => a.r - b.r || a.i - b.i).map(x => x.d);
}

/** Order a department's orderable items for the Custom list: saved order
 *  first (id → code), items added since appended in `fallback` order. */
export function orderItemsForEditor<I extends { id: string; code?: string | null; name?: string | null }>(
  all: I[], saved: SequenceRef[] | undefined,
): I[] {
  if (!saved?.length) return all.slice();
  const withRank = all.map((it, i) => ({
    it, i, r: (() => { const x = refIndex(saved, it.id, norm(it.code), '', false); return x < 0 ? Number.MAX_SAFE_INTEGER : x; })(),
  }));
  return withRank.sort((a, b) => a.r - b.r || a.i - b.i).map(x => x.it);
}

/** Sort designer items the way a mode prints them (the Custom list's seed). */
export function sortItemsByMode<I extends { code?: string | null; name?: string | null }>(items: I[], mode: SequenceMode): I[] {
  const x = items.map((it, i) => ({ it, i }));
  if (mode === 'code') x.sort((a, b) => compareTestCodes(norm(a.it.code), norm(b.it.code)) || a.i - b.i);
  else if (mode === 'alpha') x.sort((a, b) => compareNames((a.it.name ?? '').trim(), (b.it.name ?? '').trim()) || a.i - b.i);
  return x.map(v => v.it);
}
