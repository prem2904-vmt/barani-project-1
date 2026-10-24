/**
 * Custom sample-number location ("sampleIdPath") — the editor side.
 *
 * The lab taps the sample number in a REAL received message; we compute the
 * path, show a live preview and save it as parser.<block>.sampleIdPath. The
 * desktop connector reads it with electron/instruments/core/parsers/sample-id-path.js
 * — this file is its tested TS mirror (same grammar, same "which segment"
 * rule, trim only). Keep the two in step.
 *
 *   HL7      SEG[n].field[.component[.subcomponent]]   PID.5.2 · OBR.3 · OBX[2].5
 *   ASTM     Type[n].field[.component]                 O.3 · P.6.2
 *   Text     line:start-end (0-based chars, end not included) or a regex
 *   HBPro    start-end (one record) or a regex
 *   Sinocare Root.key.key   Patient.medicalRecordNo · Observation.sampleNo · Device.serialNumber
 */
import { ParserType } from './instrument.models';

export type SampleIdFormat = 'hl7' | 'astm' | 'text' | 'hbpro' | 'sinocare';

/** One tappable value in the picker. */
export interface PickCell { path: string; value: string; /** short position label, e.g. "5.2" */ label: string }
/** One segment / record row (HL7, ASTM). */
export interface PickRow { name: string; cells: PickCell[] }
/** Text / HBPro: one line of characters. */
export interface PickLine { line: number; text: string }
/** Sinocare: one JSON leaf. */
export interface PickLeaf { group: string; path: string; key: string; value: string }

export interface PickModel {
  format: SampleIdFormat;
  rows: PickRow[];
  lines: PickLine[];
  leaves: PickLeaf[];
}

const SEG_RE = /^([A-Za-z][A-Za-z0-9]{2})(?:\[(\d+)\])?\.(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;
const REC_RE = /^([A-Za-z])(?:\[(\d+)\])?\.(\d+)(?:\.(\d+))?$/;
const RANGE_RE = /^(?:(\d+):)?(\d+)-(\d+)$/;

/** A sample number is never this long — longer values (embedded images) are not offered. */
const MAX_CELL = 64;
const clean = (s: unknown): string => (s == null ? '' : String(s).trim());

/** The path grammar for the instrument's protocol (auto → sniff the message). */
export function formatFor(protocol: ParserType, raw?: string | null): SampleIdFormat {
  switch (protocol) {
    case 'hl7': return 'hl7';
    case 'astm': return 'astm';
    case 'text': return 'text';
    case 'lifedx-hbpro': return 'hbpro';
    case 'sinocare-fhir': return 'sinocare';
    default: {
      const t = String(raw ?? '');
      if (/(^|[\r\n\x0b])MSH\|/.test(t)) return 'hl7';
      if (/(^|[\r\n])[\x02]?[0-7]?H\|[^\r\n]{3}/.test(t) && /(^|[\r\n])[\x02]?[0-7]?[RO]\|/.test(t)) return 'astm';
      if (/^\s*\{[\s\S]*"sinocare"\s*:\s*1/.test(t)) return 'sinocare';
      return 'text';
    }
  }
}

// ── shared record model (HL7 segments / ASTM records) ──────────────────────
interface Rec { name: string; parts: string[] }
interface Delims { field: string; component: string; repeat: string; sub: string; escape: string }

function splitLines(raw: string): string[] {
  return String(raw ?? '').replace(/[\x0b\x1c\x02\x03\x04\x05]/g, '\r').split(/\r\n|\r|\n/).filter((l) => l.length > 0);
}

function hl7Delims(recs: string[]): Delims {
  const msh = recs.find((s) => s.startsWith('MSH'));
  if (!msh) return { field: '|', component: '^', repeat: '~', escape: '\\', sub: '&' };
  const field = msh[3] || '|';
  const enc = msh.slice(4).split(field)[0] || '^~\\&';
  return { field, component: enc[0] || '^', repeat: enc[1] || '~', escape: enc[2] || '\\', sub: enc[3] || '&' };
}

function astmDelims(recs: string[]): Delims {
  const h = recs.find((l) => l[0] === 'H');
  if (!h) return { field: '|', repeat: '\\', component: '^', escape: '&', sub: '\u0000' };
  const field = h[1] || '|';
  const end = h.indexOf(field, 2) >= 0 ? h.indexOf(field, 2) : 5;
  const enc = h.slice(2, end);
  return { field, repeat: enc[0] || '\\', component: enc[1] || '^', escape: enc[2] || '&', sub: '\u0000' };
}

function unescapeHl7(v: string, e: Delims): string {
  if (!v || v.indexOf(e.escape) < 0) return v;
  const x = e.escape.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const map: Record<string, string> = { F: e.field, S: e.component, T: e.sub, R: e.repeat, E: e.escape };
  return v.replace(new RegExp(`${x}([FSTRE])${x}`, 'g'), (_m, k: string) => map[k] ?? _m);
}
function unescapeAstm(v: string, d: Delims): string {
  if (!v || !d.escape || v.indexOf(d.escape) < 0) return v;
  const x = d.escape.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const map: Record<string, string> = { F: d.field, S: d.component, R: d.repeat, E: d.escape };
  return v.replace(new RegExp(`${x}([FSRE])${x}`, 'g'), (_m, k: string) => map[k] ?? _m);
}

function hl7Recs(raw: string): { recs: Rec[]; e: Delims } {
  const segs = splitLines(raw).filter((s) => s.length >= 3);
  const e = hl7Delims(segs);
  return { recs: segs.map((s) => ({ name: s.slice(0, 3).toUpperCase(), parts: s.split(e.field) })), e };
}
function astmRecs(raw: string): { recs: Rec[]; d: Delims } {
  const ls = splitLines(raw).map((l) => (/^[0-7][HPOCRQLM][^A-Za-z0-9]/.test(l) ? l.slice(1) : l));
  const d = astmDelims(ls);
  return { recs: ls.map((l) => ({ name: (l[0] || '').toUpperCase(), parts: l.split(d.field) })), d };
}

/** Same rule as the connector's pickRecord: [n] = n-th in the message; the
 *  order type = this order; anything else = nearest before the order, else first. */
function pickRecord(all: Rec[], name: string, occ: number | null, orderIdx: number, orderType: string): Rec | null {
  if (occ) {
    let n = 0;
    for (const r of all) if (r.name === name && ++n === occ) return r;
    return null;
  }
  if (name === orderType && orderIdx >= 0) return all[orderIdx];
  for (let i = (orderIdx >= 0 ? orderIdx : all.length) - 1; i >= 0; i--) if (all[i].name === name) return all[i];
  return all.find((r) => r.name === name) ?? null;
}

// ── extract (live preview — mirrors the connector, first order) ────────────
export function extractSampleId(raw: string | null | undefined, format: SampleIdFormat, path: string | null | undefined): string {
  const p = clean(path);
  if (!raw || !p) return '';
  if (format === 'hl7') {
    const m = SEG_RE.exec(p);
    if (!m || +m[3] < 1) return '';
    const seg = m[1].toUpperCase(); const occ = m[2] ? Math.max(1, +m[2]) : null; const field = +m[3];
    const comp = m[4] ? +m[4] : null; const sub = m[5] ? +m[5] : null;
    const { recs, e } = hl7Recs(raw);
    const r = pickRecord(recs, seg, occ, recs.findIndex((x) => x.name === 'OBR'), 'OBR');
    if (!r) return '';
    const v0 = (seg === 'MSH' ? r.parts[field - 1] : r.parts[field]) ?? '';
    if (seg === 'MSH' && field <= 2) return clean(v0);
    let v = String(v0).split(e.repeat)[0];
    if (comp) v = v.split(e.component)[comp - 1] ?? '';
    if (sub) v = v.split(e.sub)[sub - 1] ?? '';
    return clean(unescapeHl7(v, e));
  }
  if (format === 'astm') {
    const m = REC_RE.exec(p);
    if (!m || +m[3] < 1) return '';
    const type = m[1].toUpperCase(); const occ = m[2] ? Math.max(1, +m[2]) : null; const field = +m[3]; const comp = m[4] ? +m[4] : null;
    const { recs, d } = astmRecs(raw);
    const r = pickRecord(recs, type, occ, recs.findIndex((x) => x.name === 'O'), 'O');
    if (!r) return '';
    let v = String(r.parts[field - 1] ?? '');
    if (type === 'H' && field === 2) return clean(v);
    v = v.split(d.repeat)[0];
    if (comp) v = v.split(d.component)[comp - 1] ?? '';
    return clean(unescapeAstm(v, d));
  }
  if (format === 'text' || format === 'hbpro') return textValue(raw, p);
  return sinocareValue(raw, p);
}

export function textValue(text: string, path: string): string {
  const p = clean(path);
  if (!p) return '';
  const ls = String(text ?? '').replace(/[\x02\x03]/g, '').split(/\r\n|\r|\n/).filter((l) => l.length > 0);
  const r = RANGE_RE.exec(p);
  if (r) {
    const line = ls[(r[1] ? Math.max(1, +r[1]) : 1) - 1];
    const s = +r[2]; const en = +r[3];
    if (line == null || en <= s) return '';
    return clean(line.slice(s, en));
  }
  let re: RegExp;
  try { re = new RegExp(p, 'i'); } catch { return ''; }
  for (const l of ls) {
    const m = re.exec(l);
    if (m) return clean(m.groups?.['id'] ?? m[1] ?? '');
  }
  return '';
}

interface SinoParts { res: unknown; patient: unknown; device: unknown }
function sinocareParts(raw: string): SinoParts | null {
  let env: Record<string, unknown>;
  try { env = JSON.parse(raw); } catch { return null; }
  if (!env || typeof env !== 'object') return null;
  const isEnv = env['sinocare'] === 1;
  const body = (isEnv ? env['body'] : env) as Record<string, unknown> | undefined;
  if (!body || typeof body !== 'object') return null;
  const res = (body['fhir'] || body['resource'] || body) as Record<string, unknown>;
  const ctx = ((isEnv && env['context']) || {}) as { patient?: unknown; patients?: Record<string, unknown>; device?: unknown };
  const ext = res['extension'] as Record<string, unknown> | undefined;
  const ownPos = clean(ext?.['position']) || clean(res['position']);
  let patient: unknown = null;
  if (ownPos && ctx.patients && ctx.patients[ownPos]) patient = ctx.patients[ownPos];
  else if (!ownPos) patient = ctx.patient ?? null;
  return { res, patient, device: ctx.device ?? null };
}

function sinocareValue(raw: string, path: string): string {
  const parts = sinocareParts(raw);
  const keys = clean(path).split('.').filter((k) => k !== '');
  if (!parts || keys.length < 2) return '';
  const root = keys[0].toLowerCase();
  let o: unknown = root === 'patient' ? parts.patient : root === 'device' ? parts.device : parts.res;
  for (const k of keys.slice(1)) {
    if (o == null || typeof o !== 'object') return '';
    o = (o as Record<string, unknown>)[k];
  }
  return o == null || typeof o === 'object' ? '' : clean(o);
}

// ── picker model ───────────────────────────────────────────────────────────
function rowsFor(recs: Rec[], orderType: string, isHl7: boolean, d: Delims): PickRow[] {
  const orderIdx = recs.findIndex((r) => r.name === orderType);
  const seen = new Map<string, number>();
  const rows: PickRow[] = [];
  recs.forEach((r) => {
    const occ = (seen.get(r.name) ?? 0) + 1;
    seen.set(r.name, occ);
    // Omit [n] when the plain path already lands on this row (the usual case).
    const plain = pickRecord(recs, r.name, null, orderIdx, orderType) === r;
    const base = plain ? r.name : `${r.name}[${occ}]`;
    const cells: PickCell[] = [];
    r.parts.forEach((raw, i) => {
      if (i === 0) return; // segment / record name
      const n = isHl7 && r.name === 'MSH' ? i + 1 : isHl7 ? i : i + 1;
      if ((isHl7 && r.name === 'MSH' && n <= 2) || (!isHl7 && r.name === 'H' && n <= 2)) return; // delimiters
      const first = String(raw).split(d.repeat)[0];
      const comps = first.split(d.component);
      comps.forEach((c, ci) => {
        const subs = isHl7 && c.indexOf(d.sub) >= 0 ? c.split(d.sub) : [c];
        subs.forEach((sv, si) => {
          const value = clean(isHl7 ? unescapeHl7(sv, d) : unescapeAstm(sv, d));
          if (!value || value.length > MAX_CELL) return;
          const tail = [n, comps.length > 1 || subs.length > 1 ? ci + 1 : null, subs.length > 1 ? si + 1 : null].filter((x) => x != null).join('.');
          cells.push({ path: `${base}.${tail}`, value, label: tail });
        });
      });
    });
    rows.push({ name: plain ? r.name : `${r.name} ${occ}`, cells });
  });
  return rows;
}

function leavesOf(group: string, o: unknown, prefix: string, out: PickLeaf[], depth = 0): void {
  if (o == null || depth > 6) return;
  if (typeof o !== 'object') {
    const value = clean(o);
    if (value && value.length <= MAX_CELL) out.push({ group, path: prefix, key: prefix.split('.').slice(1).join('.'), value });
    return;
  }
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) leavesOf(group, v, `${prefix}.${k}`, out, depth + 1);
}

export function pickModel(raw: string | null | undefined, format: SampleIdFormat): PickModel {
  const m: PickModel = { format, rows: [], lines: [], leaves: [] };
  if (!raw) return m;
  if (format === 'hl7') { const { recs, e } = hl7Recs(raw); m.rows = rowsFor(recs, 'OBR', true, e); }
  else if (format === 'astm') { const { recs, d } = astmRecs(raw); m.rows = rowsFor(recs, 'O', false, d); }
  else if (format === 'text' || format === 'hbpro') {
    m.lines = String(raw).replace(/[\x02\x03]/g, '').split(/\r\n|\r|\n/).filter((l) => l.length > 0).map((text, i) => ({ line: i + 1, text }));
  } else {
    const p = sinocareParts(raw);
    if (p) {
      leavesOf('Observation', p.res, 'Observation', m.leaves);
      leavesOf('Patient', p.patient, 'Patient', m.leaves);
      leavesOf('Device', p.device, 'Device', m.leaves);
    }
  }
  return m;
}

/** Two taps on a text line (any order) → the saved range path. */
export function rangePath(format: SampleIdFormat, line: number, a: number, b: number): string {
  const s = Math.min(a, b); const e = Math.max(a, b) + 1;
  return format === 'hbpro' && line === 1 ? `${s}-${e}` : `${line}:${s}-${e}`;
}

/** The path in plain words for the "read from …" line. */
export function pathLabel(format: SampleIdFormat, path: string | null | undefined): string {
  const p = clean(path);
  if (!p) return '';
  if (format === 'hl7') return p.replace(/^([A-Za-z0-9]{3}(?:\[\d+\])?)\./, '$1-');
  if (format === 'astm') { const m = REC_RE.exec(p); return m ? `${m[1].toUpperCase()} record${m[2] ? ` ${m[2]}` : ''}, field ${m[3]}${m[4] ? `.${m[4]}` : ''}` : p; }
  if (format === 'text' || format === 'hbpro') {
    const r = RANGE_RE.exec(p);
    if (!r) return `the pattern ${p}`;
    const where = `characters ${r[2]}–${+r[3] - 1}`;
    return r[1] && !(format === 'hbpro' && r[1] === '1') ? `line ${r[1]}, ${where}` : where;
  }
  return p;
}

/** The character range a text path selects (for highlighting). */
export function rangeOf(path: string | null | undefined): { line: number; start: number; end: number } | null {
  const r = RANGE_RE.exec(clean(path));
  return r ? { line: r[1] ? +r[1] : 1, start: +r[2], end: +r[3] } : null;
}
