import type { Order, OrderSample, OrderTest } from '../../../shared/models/order.model';
import { formatPatientMeta, patientDisplayName } from '../../../shared/models/patient.model';
import { plural } from '../../../shared/utils/plural';
import { isSignedOrSkipped, NOT_REPORTED } from '../../../shared/utils/line-status';

/**
 * Reports list — the PARTIAL tab's model (docs/PF-PATTERN.md → "Reports list").
 *
 * A partial report is built per TUBE: `/api/reports/generate/partial` takes the
 * ids of the samples whose every test is validated. The old card counted those
 * tubes and called them "depts", and listed every other tube's department code
 * as pending — so an order with two Microbiology tubes (a signed-out culture +
 * an identification still on the bench) read "MIC" ready AND "Still pending:
 * MIC". Here the card is grouped by DEPARTMENT and every test says where it is:
 * a department is ready (all its tests print), partly ready (some print) or
 * pending (nothing prints yet), and a test is "ready" exactly when it is in the
 * partial PDF (its tube is fully validated).
 *
 * Culture tests keep their result in culture stages + the AST block, not in
 * parameters, so they get a stage summary instead of "No parameter values".
 */

export interface PrelimRow {
  name: string;
  title: string;
  value: unknown;
  unit?: string;
  range?: string;
  flag: 'normal' | 'abnormal' | 'critical';
  /** Saved flag code (H / L / C / A / N / ''). */
  code?: string;
}

export interface CultureLine { label: string; value: string }

export interface PrelimTest {
  id: string;
  name: string;
  /** In the partial PDF: its tube is fully validated. */
  ready: boolean;
  culture: boolean;
  values: PrelimRow[];
  /** Ready culture: Growth / Organism / AST lines. */
  cultureLines: CultureLine[];
  /** Where the test is when it is not ready (plain words). */
  status: string;
}

export type DeptState = 'ready' | 'partial' | 'pending';

export interface PrelimDept {
  key: string;
  name: string;
  code: string;
  state: DeptState;
  readyTests: number;
  tests: PrelimTest[];
}

export interface PendingDept { name: string; detail: string }

export interface PrelimOrder {
  id: string;
  patientName: string;
  /** "29/M · AA0012 · Order LAB-2609-000089 · 6:37 PM" (never "|", never cut). */
  patientMeta: string;
  /** For the search box. */
  searchText: string;
  /** The order's daily patient number (on-screen only). */
  dailyNo?: number | null;
  dailyNoDay?: string | null;
  totalDepts: number;
  readyDepts: number;
  partialDepts: number;
  /** "1 of 3 departments ready" — see deptCountLabel. */
  countLabel: string;
  /** Departments with something in the partial PDF (ready + partly ready). */
  shownDepts: PrelimDept[];
  /** Departments not fully ready, by NAME (+ how much is left). */
  pending: PendingDept[];
  /** Tubes whose every test is validated — what the partial PDF prints. */
  readySampleIds: string[];
}

/** The four root culture stages the bench runs (mw CultureService.DefaultStages). */
export const CULTURE_STAGE_KEYS = ['gram', 'growth', 'identification', 'ast'] as const;

interface StageSnap { key?: string; caseLabel?: string | null; values?: { fields?: Array<{ name?: string; title?: string; value?: string }>; notes?: string } }
interface CultureValues {
  noGrowth?: boolean; colonyCount?: string;
  organisms?: Array<{ name?: string; antibiotics?: Array<{ name?: string; interpretation?: string }> }>;
}
interface CultureSnap { values?: CultureValues; stages?: StageSnap[] }

function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as T) : null;
  } catch { return null; }
}

/** A structured culture test: the ONE marker is microFormat in Parameters. */
export function isCultureTest(t: Pick<OrderTest, 'test' | 'currentResult'>): boolean {
  const p = parseJson<{ microFormat?: string }>(t.test?.parameters);
  if (p?.microFormat === 'culture_sensitivity') return true;
  const snap = parseJson<CultureSnap>(t.currentResult);
  return Array.isArray(snap?.stages) && !!snap?.values && Array.isArray(snap.values.organisms);
}

/** Root (non-subculture) stages that are done, per the result snapshot. */
export function cultureStagesDone(currentResult: string | null | undefined): number {
  const snap = parseJson<CultureSnap>(currentResult);
  const keys = new Set((snap?.stages ?? []).filter(s => !s.caseLabel).map(s => s.key));
  return CULTURE_STAGE_KEYS.filter(k => keys.has(k)).length;
}

/** Growth · Organism · AST — the culture's result in three short lines. */
export function cultureSummary(currentResult: string | null | undefined): CultureLine[] {
  const snap = parseJson<CultureSnap>(currentResult);
  if (!snap) return [];
  const v = snap.values ?? {};
  const stage = (key: string) => (snap.stages ?? []).find(s => s.key === key && !s.caseLabel);
  const fieldVal = (key: string, match: (name: string) => boolean): string =>
    (stage(key)?.values?.fields ?? []).find(f => match((f.name ?? '').toLowerCase()) && (f.value ?? '').trim())?.value?.trim() ?? '';
  const lines: CultureLine[] = [];

  if (v.noGrowth) {
    lines.push({ label: 'Growth', value: 'No growth' });
  } else {
    const growth = fieldVal('growth', n => n === 'growth') || fieldVal('growth', () => true);
    const count = fieldVal('growth', n => n.includes('colony')) || (v.colonyCount ?? '').trim();
    const g = growth && count && growth !== count ? `${growth} (${count})` : (growth || count);
    if (g) lines.push({ label: 'Growth', value: g });
  }

  const orgs = (v.organisms ?? []).map(o => (o.name ?? '').trim()).filter(Boolean);
  const organism = orgs.join(', ') || fieldVal('identification', n => n.includes('organism'));
  if (organism) lines.push({ label: orgs.length > 1 ? 'Organisms' : 'Organism', value: organism });

  if (!v.noGrowth) {
    const drugs = (v.organisms ?? []).flatMap(o => o.antibiotics ?? []).filter(a => (a.name ?? '').trim());
    if (drugs.length) {
      const r = drugs.filter(a => (a.interpretation ?? '').toUpperCase() === 'R').length;
      lines.push({ label: 'AST', value: plural(drugs.length, 'drug') + (r ? ` · ${r} resistant` : '') });
    }
  }
  return lines;
}

const NOT_RECEIVED = new Set(['pending', 'ordered', 'collected', 'dispatched', 'in_transit', 'picked_up']);

/** Where a not-yet-printable test is, in plain words. */
export function pendingStatus(t: OrderTest, sample: Pick<OrderSample, 'status'>, culture: boolean): string {
  const s = (t.status ?? '').toLowerCase();
  if (s === 'validated') return 'Validated · prints when the rest of its tube is validated';
  if (s === 'rejected') return 'Rejected';
  if (s === NOT_REPORTED) return 'Not reported';
  if (culture) {
    const done = cultureStagesDone(t.currentResult);
    if (s === 'entered' || s === 'resulted') return 'Culture awaiting sign-out';
    if (done > 0) return `Culture in progress · ${done} of ${CULTURE_STAGE_KEYS.length} stages done`;
    if (s === 'in_progress') return 'Culture in progress on the bench';
  } else {
    if (s === 'entered' || s === 'resulted') return 'Awaiting validation';
    if (s === 'in_progress') return 'Result entry in progress';
  }
  if (NOT_RECEIVED.has((sample.status ?? '').toLowerCase())) return 'Sample not received at the lab yet';
  return 'Not started';
}

/** "1 of 3 departments ready" / "1 of 2 departments partly ready" /
 *  "1 of 3 departments ready · 1 partly". */
export function deptCountLabel(ready: number, partial: number, total: number): string {
  const of = `of ${total} ${total === 1 ? 'department' : 'departments'}`;
  if (partial === 0) return `${ready} ${of} ready`;
  if (ready === 0) return `${partial} ${of} partly ready`;
  return `${ready} ${of} ready · ${partial} partly`;
}

function orderTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
}

/** "Order LAB-2609-000089", or the short id when a legacy order has no number. */
export function orderLabel(o: Pick<Order, 'id' | 'orderNumber'>): string {
  return o.orderNumber ? `Order ${o.orderNumber}` : `Order #${o.id.slice(0, 8).toUpperCase()}`;
}

/**
 * Every order with at least one fully validated tube and at least one that
 * is not (fully validated orders go through the normal report queue).
 */
export function buildPartialOrders(orders: Order[], extractValues: (t: OrderTest) => PrelimRow[]): PrelimOrder[] {
  const out: PrelimOrder[] = [];
  for (const o of orders) {
    const samples = (o.samples ?? []).filter(s => s.status !== 'rejected');
    if (samples.length === 0) continue;
    // A line closed as NOT REPORTED is done (it never prints) — same rule as
    // the server's partial eligibility.
    const readySamples = samples.filter(s => (s.tests ?? []).some(t => t.status === 'validated')
      && s.tests.every(t => isSignedOrSkipped(t.status)));
    if (readySamples.length === 0 || readySamples.length === samples.length) continue;
    const readyIds = new Set(readySamples.map(s => s.id));

    const depts = new Map<string, PrelimDept>();
    for (const s of samples) {
      const key = s.departmentId || s.department?.id || s.department?.code || s.id;
      let d = depts.get(key);
      if (!d) {
        d = { key, name: s.department?.name || s.department?.code || 'Department', code: s.department?.code ?? '',
              state: 'pending', readyTests: 0, tests: [] };
        depts.set(key, d);
      }
      const ready = readyIds.has(s.id);
      for (const t of s.tests ?? []) {
        if (t.status === NOT_REPORTED) continue;   // never prints, never listed
        const culture = isCultureTest(t);
        d.tests.push({
          id: t.id,
          name: t.test?.name || t.name || 'Test',
          ready,
          culture,
          values: ready && !culture ? extractValues(t) : [],
          cultureLines: ready && culture ? cultureSummary(t.currentResult) : [],
          status: ready ? '' : pendingStatus(t, s, culture),
        });
        if (ready) d.readyTests++;
      }
    }

    const all = [...depts.values()].filter(d => d.tests.length > 0);
    for (const d of all) {
      // Ready tests first inside a department, so what prints reads first.
      d.tests.sort((a, b) => Number(b.ready) - Number(a.ready));
      d.state = d.readyTests === d.tests.length ? 'ready' : d.readyTests > 0 ? 'partial' : 'pending';
    }
    const readyDepts = all.filter(d => d.state === 'ready').length;
    const partialDepts = all.filter(d => d.state === 'partial').length;
    const pending: PendingDept[] = all.filter(d => d.state !== 'ready').map(d => {
      const left = d.tests.length - d.readyTests;
      return { name: d.name, detail: d.state === 'partial' ? `${left} of ${plural(d.tests.length, 'test')}` : '' };
    });

    const p = o.patient;
    const name = patientDisplayName(p) || 'Patient';
    const meta = [p ? formatPatientMeta(p) : '', orderLabel(o), orderTime(o.createdAt)].filter(Boolean).join(' · ');
    out.push({
      id: o.id,
      patientName: name,
      patientMeta: meta,
      dailyNo: o.dailyNo ?? null,
      dailyNoDay: o.dailyNoDay ?? null,
      searchText: [name, p?.mrn, p?.phone, o.orderNumber, o.id].filter(Boolean).join(' ').toLowerCase(),
      totalDepts: all.length,
      readyDepts,
      partialDepts,
      countLabel: deptCountLabel(readyDepts, partialDepts, all.length),
      shownDepts: all.filter(d => d.state !== 'pending'),
      pending,
      readySampleIds: readySamples.map(s => s.id),
    });
  }
  return out;
}

/** The card's ONE status (docs/PF-PATTERN.md → "Reports list"): a dot +
 *  coloured word in the right-hand status column, never a chip, never two.
 *  Tones are the Frontdesk rows' (`--<tone>-text` tokens). Priority:
 *    Failed (red) › Unpaid (red, only while not yet delivered) ›
 *    Delivered (green + check) › Preliminary (amber, a partial report is not
 *    final, so it REPLACES "Completed") › Completed (green).
 *  Whatever the status hides is returned as `extra` for the meta line. */
export type ReportTone = 'green' | 'amber' | 'red';
export interface ReportStatus {
  key: 'failed' | 'unpaid' | 'delivered' | 'preliminary' | 'completed';
  label: string;
  tone: ReportTone;
  /** Facts the one status can't carry ("Preliminary", "Payment due"). */
  extra: string[];
}
export function reportStatus(deliveryStatus: string, type: string | undefined, unpaid: boolean): ReportStatus {
  const prelim = type === 'partial';
  const extra = (hide: { prelim?: boolean; unpaid?: boolean }) =>
    [prelim && !hide.prelim ? 'Preliminary' : '', unpaid && !hide.unpaid ? 'Payment due' : ''].filter(Boolean);
  if (deliveryStatus === 'failed') return { key: 'failed', label: 'Failed', tone: 'red', extra: extra({}) };
  if (deliveryStatus === 'delivered') return { key: 'delivered', label: 'Delivered', tone: 'green', extra: extra({}) };
  if (unpaid) return { key: 'unpaid', label: 'Unpaid', tone: 'red', extra: extra({ unpaid: true }) };
  if (prelim) return { key: 'preliminary', label: 'Preliminary', tone: 'amber', extra: [] };
  return { key: 'completed', label: 'Completed', tone: 'green', extra: [] };
}
