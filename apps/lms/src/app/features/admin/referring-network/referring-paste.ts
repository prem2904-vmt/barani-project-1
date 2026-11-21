import { hospitalErrors, referralDoctorErrors } from '../../../shared/forms/contact-validate';
import { validatePhoneNumber } from '../../../shared/forms/validate';
import { statusWords, type StatusWords } from '../../../shared/utils/status-words';
import type { Doctor, Hospital } from './referring-network.model';

/**
 * PASTE FROM A SHEET (owner 2026-11-21: "so it's easy to copy-paste and it works wherever they have worked"). Rows
 * copied from Excel / Google Sheets / Neuron arrive as tab-separated text (one line per row). Pure, no Angular:
 *  - {@link parseSheetText}: TSV (or CSV when there is no tab) → cells; quoted cells with tabs / line breaks kept.
 *  - {@link pasteRows}: cells → doctor / hospital rows. A first row whose cells are known headers ("Name",
 *    "Hospital", "Mobile"…) maps the columns by header, in any order; otherwise the default order applies
 *    (doctors: Name · Qualification · Hospital(s) · Department · Phone; hospitals: Name · Code · Phone · Address · Email).
 *  - {@link checkDoctorRows} / {@link checkHospitalRows}: row-by-row checks — a name is required, the same field
 *    rules as the single editor, duplicates (already in the list, or twice in the paste) flagged and never saved,
 *    hospitals linked to existing ones by name (case- and space-insensitive) or listed as NEW (created on confirm).
 * A doctor may belong to several hospitals: the Hospital(s) cell splits on ";" "," "|" or a line break.
 */

export type PasteMode = 'doctors' | 'hospitals';

/** One pasted row (an editable grid row). `n` = its 1-based position in the paste. */
export interface PasteRow {
  key: string;
  n: number;
  name: string;
  qualification: string;
  /** Doctors: the hospital names as typed ("Apollo; Kauvery"). */
  hospitals: string;
  department: string;
  phone: string;
  /** Hospitals. */
  code: string;
  address: string;
  email: string;
  /** Set after a save: 'saved' or the server's message. */
  result?: { ok: boolean; message: string; id?: string };
}

export type PasteState = 'ready' | 'new-hospital' | 'duplicate' | 'invalid' | 'saved' | 'failed';

export interface CheckedRow {
  row: PasteRow;
  state: PasteState;
  /** Plain words for the Check column. */
  words: StatusWords;
  /** Doctors: existing hospital ids this row links to (first = primary). */
  hospitalIds: string[];
  /** Doctors: hospital names this row needs that do not exist yet (as typed, first spelling). */
  newHospitals: string[];
}

export interface PasteCheck {
  rows: CheckedRow[];
  /** Rows a Save would send (ready + new-hospital). */
  saveable: CheckedRow[];
  /** Distinct new hospitals across the saveable rows (first spelling wins). */
  newHospitals: string[];
  counts: Record<PasteState, number>;
}

const FIELDS = ['name', 'qualification', 'hospitals', 'department', 'phone', 'code', 'address', 'email'] as const;
type Field = (typeof FIELDS)[number];

/** Default column order when the paste has no header row. */
export const DEFAULT_ORDER: Record<PasteMode, Field[]> = {
  doctors: ['name', 'qualification', 'hospitals', 'department', 'phone'],
  hospitals: ['name', 'code', 'phone', 'address', 'email'],
};

/** Header words → field, per mode ("Hospital" is the doctor's hospitals in doctors mode, the name in hospitals mode). */
const HEADERS: Record<PasteMode, Record<string, Field>> = {
  doctors: {
    name: 'name', doctor: 'name', 'doctor name': 'name', 'full name': 'name', 'referring doctor': 'name',
    qualification: 'qualification', qualifications: 'qualification', degree: 'qualification', degrees: 'qualification', qual: 'qualification',
    hospital: 'hospitals', hospitals: 'hospitals', 'hospital(s)': 'hospitals', 'hospital name': 'hospitals', clinic: 'hospitals', clinics: 'hospitals', 'works at': 'hospitals',
    department: 'department', dept: 'department', speciality: 'department', specialty: 'department', specialisation: 'department', specialization: 'department',
    phone: 'phone', mobile: 'phone', 'mobile no': 'phone', 'mobile number': 'phone', 'phone number': 'phone', 'phone no': 'phone', contact: 'phone', 'contact no': 'phone',
    email: 'email', 'e-mail': 'email', mail: 'email',
  },
  hospitals: {
    name: 'name', hospital: 'name', 'hospital name': 'name', clinic: 'name',
    code: 'code', 'short code': 'code',
    phone: 'phone', mobile: 'phone', 'phone number': 'phone', contact: 'phone', 'contact no': 'phone',
    address: 'address', location: 'address', city: 'address',
    email: 'email', 'e-mail': 'email', mail: 'email',
  },
};

/** Spreadsheet clipboard text → rows of cells. Tab-separated (Excel / Sheets / Neuron); CSV only when no line has a tab.
 *  A cell in double quotes may hold tabs, commas and line breaks ("" = a quote). Blank lines are dropped. */
export function parseSheetText(text: string): string[][] {
  const src = String(text ?? '').replace(/\r\n?/g, '\n');
  if (!src.trim()) return [];
  const sep = src.includes('\t') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let atStart = true;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && atStart) { quoted = true; atStart = false; continue; }
    if (ch === sep) { row.push(cell); cell = ''; atStart = true; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; atStart = true; continue; }
    cell += ch;
    atStart = false;
  }
  row.push(cell);
  rows.push(row);
  return rows
    .map(r => r.map(c => c.replace(/\s+/g, ' ').trim()))
    .filter(r => r.some(c => c !== ''));
}

const norm = (s: string | null | undefined) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
/** Header cell → field (null = not a header word). */
function headerField(mode: PasteMode, cell: string): Field | null {
  const k = norm(cell).replace(/[:*.]+$/g, '').trim();
  return HEADERS[mode][k] ?? null;
}

/** Is this the header row? (at least one cell is a known header and none of the known ones repeat a field). */
export function isHeaderRow(mode: PasteMode, cells: string[]): boolean {
  const hits = cells.map(c => headerField(mode, c)).filter((f): f is Field => !!f);
  return hits.length >= 1 && hits.length >= Math.ceil(cells.filter(c => c).length / 2) && new Set(hits).size === hits.length;
}

let seq = 0;
export function blankRow(n: number): PasteRow {
  return { key: `p${++seq}`, n, name: '', qualification: '', hospitals: '', department: '', phone: '', code: '', address: '', email: '' };
}

/** Cells → rows (header row mapped by name, else the default order). `from` = the first row number to give. */
export function pasteRows(mode: PasteMode, cells: string[][], from = 1): PasteRow[] {
  if (!cells.length) return [];
  let order: (Field | null)[] = DEFAULT_ORDER[mode];
  let body = cells;
  if (isHeaderRow(mode, cells[0])) {
    order = cells[0].map(c => headerField(mode, c));
    body = cells.slice(1);
  }
  return body.map((r, i) => {
    const row = blankRow(from + i);
    r.forEach((v, c) => {
      const f = order[c];
      if (f) row[f] = row[f] ? `${row[f]}; ${v}` : v;
    });
    return row;
  });
}

/** "Apollo; Kauvery, MIOT" → ["Apollo", "Kauvery", "MIOT"] (blanks and repeats dropped, first spelling kept). */
export function splitHospitals(cell: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of String(cell ?? '').split(/[;,|\n]+/)) {
    const v = raw.replace(/\s+/g, ' ').trim();
    if (!v || seen.has(norm(v))) continue;
    seen.add(norm(v));
    out.push(v);
  }
  return out;
}

/** The key two doctor names are the same person by: case, spaces, dots and a leading "Dr" ignored. */
export function doctorKey(name: string | null | undefined): string {
  return norm(name).replace(/^dr\.?\s+/, '').replace(/^dr\./, '').replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
}
export function hospitalKey(name: string | null | undefined): string {
  return norm(name).replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
}

const COUNTS = (): Record<PasteState, number> => ({ ready: 0, 'new-hospital': 0, duplicate: 0, invalid: 0, saved: 0, failed: 0 });
/** Lower = shown first when the Check column sorts ascending (problems first). */
export const STATE_RANK: Record<PasteState, number> = { invalid: 0, duplicate: 1, failed: 2, 'new-hospital': 3, ready: 4, saved: 5 };
const isEmpty = (r: PasteRow) => FIELDS.every(f => !String(r[f] ?? '').trim());

function firstError(errs: Record<string, string>): string | null {
  const k = Object.keys(errs)[0];
  return k ? errs[k] : null;
}

/** Row-by-row checks of pasted doctors against the lab's doctors and hospitals. */
export function checkDoctorRows(rows: readonly PasteRow[], doctors: readonly Pick<Doctor, 'name' | 'isActive'>[], hospitals: readonly Pick<Hospital, 'id' | 'name' | 'isActive'>[]): PasteCheck {
  const existing = new Set(doctors.map(d => doctorKey(d.name)));
  const byName = new Map<string, Pick<Hospital, 'id' | 'name' | 'isActive'>>();
  // Active hospitals win a name clash with an inactive one.
  for (const h of hospitals) { const k = hospitalKey(h.name); const had = byName.get(k); if (!had || (!had.isActive && h.isActive)) byName.set(k, h); }
  const firstAt = new Map<string, number>();
  const out: CheckedRow[] = [];
  const counts = COUNTS();
  const newNames = new Map<string, string>();
  for (const row of rows) {
    if (isEmpty(row)) continue;
    const hospitalIds: string[] = [];
    const newHospitals: string[] = [];
    for (const name of splitHospitals(row.hospitals)) {
      const h = byName.get(hospitalKey(name));
      if (h) { if (!hospitalIds.includes(h.id)) hospitalIds.push(h.id); } else newHospitals.push(name);
    }
    const linked = [...hospitalIds.map(id => hospitals.find(h => h.id === id)!.name), ...newHospitals];
    const k = doctorKey(row.name);
    let state: PasteState;
    let words: StatusWords;
    if (row.result) {
      state = row.result.ok ? 'saved' : 'failed';
      words = row.result.ok ? statusWords('Saved', linked.length ? `At ${linked.join(', ')}` : 'Independent', 'done') : statusWords('Not saved', row.result.message, 'late');
    } else if (!row.name.trim()) {
      state = 'invalid'; words = statusWords('Name missing', 'Type the doctor\'s name', 'late');
    } else {
      const err = firstError(referralDoctorErrors({ name: row.name, department: row.department, qualification: row.qualification, phone: row.phone, email: row.email }, validatePhoneNumber));
      if (err) { state = 'invalid'; words = statusWords('Check this row', err, 'late'); }
      else if (existing.has(k)) { state = 'duplicate'; words = statusWords('Duplicate', 'Already in your doctors — not saved', 'late'); }
      else if (firstAt.has(k)) { state = 'duplicate'; words = statusWords('Duplicate', `Same as row ${firstAt.get(k)} — not saved`, 'late'); }
      else if (newHospitals.length) {
        state = 'new-hospital';
        words = statusWords('New hospital', `Creates ${newHospitals.join(', ')}`, 'normal');
      } else {
        state = 'ready';
        words = statusWords('Ready', linked.length ? `At ${linked.join(', ')}` : 'Independent doctor', 'normal');
      }
    }
    if (k && !firstAt.has(k) && !row.result) firstAt.set(k, row.n);
    if (state === 'new-hospital') for (const n of newHospitals) if (!newNames.has(hospitalKey(n))) newNames.set(hospitalKey(n), n);
    counts[state]++;
    out.push({ row, state, words, hospitalIds, newHospitals });
  }
  const saveable = out.filter(r => r.state === 'ready' || r.state === 'new-hospital');
  return { rows: out, saveable, newHospitals: [...newNames.values()], counts };
}

/** Row-by-row checks of pasted hospitals against the lab's hospitals (same name or same code = duplicate). */
export function checkHospitalRows(rows: readonly PasteRow[], hospitals: readonly Pick<Hospital, 'name' | 'code'>[]): PasteCheck {
  const names = new Set(hospitals.map(h => hospitalKey(h.name)));
  const codes = new Set(hospitals.map(h => norm(h.code)).filter(Boolean));
  const firstAt = new Map<string, number>();
  const out: CheckedRow[] = [];
  const counts = COUNTS();
  for (const row of rows) {
    if (isEmpty(row)) continue;
    const k = hospitalKey(row.name);
    const code = norm(row.code);
    let state: PasteState;
    let words: StatusWords;
    if (row.result) {
      state = row.result.ok ? 'saved' : 'failed';
      words = row.result.ok ? statusWords('Saved', null, 'done') : statusWords('Not saved', row.result.message, 'late');
    } else if (!row.name.trim()) {
      state = 'invalid'; words = statusWords('Name missing', 'Type the hospital\'s name', 'late');
    } else {
      const err = firstError(hospitalErrors({ name: row.name, code: row.code, address: row.address, phone: row.phone, email: row.email }));
      if (err) { state = 'invalid'; words = statusWords('Check this row', err, 'late'); }
      else if (names.has(k)) { state = 'duplicate'; words = statusWords('Duplicate', 'Already in your hospitals — not saved', 'late'); }
      else if (code && codes.has(code)) { state = 'duplicate'; words = statusWords('Duplicate', `Code ${row.code} is already used — not saved`, 'late'); }
      else if (firstAt.has(k)) { state = 'duplicate'; words = statusWords('Duplicate', `Same as row ${firstAt.get(k)} — not saved`, 'late'); }
      else if (code && firstAt.has(`code:${code}`)) { state = 'duplicate'; words = statusWords('Duplicate', `Same code as row ${firstAt.get(`code:${code}`)} — not saved`, 'late'); }
      else { state = 'ready'; words = statusWords('Ready', 'New hospital', 'normal'); }
    }
    if (!row.result) {
      if (k && !firstAt.has(k)) firstAt.set(k, row.n);
      if (code && !firstAt.has(`code:${code}`)) firstAt.set(`code:${code}`, row.n);
    }
    counts[state]++;
    out.push({ row, state, words, hospitalIds: [], newHospitals: [] });
  }
  return { rows: out, saveable: out.filter(r => r.state === 'ready'), newHospitals: [], counts };
}

/** The POST body for a pasted doctor (the single editor's shape): first linked hospital = primary. */
export function doctorBody(r: PasteRow, hospitalIds: string[]) {
  const t = (v: string) => (v.trim() ? v.trim() : null);
  return {
    hospitalId: hospitalIds[0] ?? null, hospitalIds,
    name: r.name.trim(), designation: null, department: t(r.department), qualification: t(r.qualification),
    specialisation: null, registrationNo: null, phone: t(r.phone), email: t(r.email),
  };
}
/** The POST body for a pasted (or auto-created) hospital (the hospital editor's shape). */
export function hospitalBody(r: Pick<PasteRow, 'name'> & Partial<PasteRow>) {
  const t = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
  return { name: r.name.trim(), code: t(r.code), address: t(r.address), phone: t(r.phone), email: t(r.email), gstin: null, notes: null };
}

/** "Save 4 doctors" · "Save 1 hospital". */
export function saveLabel(mode: PasteMode, n: number): string {
  const what = mode === 'doctors' ? (n === 1 ? 'doctor' : 'doctors') : (n === 1 ? 'hospital' : 'hospitals');
  return n ? `Save ${n} ${what}` : `Save ${what}`;
}
