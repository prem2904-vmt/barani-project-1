import { formatAge, type AgeStyle } from './patient-age';
import type { ReportPatientStyle } from './report-style';

/**
 * The WORDS of the patient block (report layout plan §3.5, phase 2) — pure,
 * DI-free, no jsPDF. The renderer (report-pdf.ts) and the editor's live
 * sample chip both read these, so "45 Y / Male" on screen is "45 Y / Male" on
 * paper.
 *
 * Every function takes the template's `reportStyle.patient`. With the default
 * style each one returns exactly what the renderer printed before:
 *  - `ageStyle: 'auto'`   → the layout's own age wording ("34 Years" / "34 yrs")
 *  - `labelJoiner: 'auto'`→ each label keeps its own punctuation ("Age : ", "Ref. By: ")
 *  - `sexStyle: 'word'`   → the sex as stored ("Female")
 *  - no `labels`          → the built-in label text
 */

/** What the renderer needs of the snapshot's patient. */
export interface StripPatient {
  age?: number | string;
  ageDisplay?: string | null;
  ageYears?: number | null;
  sex?: string;
}

/** Built-in label text + its own punctuation, per patient-strip item key. */
export const PATIENT_LABELS: Readonly<Record<string, { text: string; joiner: string }>> = Object.freeze({
  name: { text: 'Patient name', joiner: ' : ' },
  age: { text: 'Age', joiner: ' : ' },
  sex: { text: 'Sex', joiner: ' : ' },
  ageSex: { text: 'Age / Sex', joiner: ' : ' },
  mrn: { text: 'MRN', joiner: ' : ' },
  phone: { text: 'Phone', joiner: ' : ' },
  orderid: { text: 'Order', joiner: ' : ' },
  refdoctor: { text: 'Ref. By', joiner: ': ' },
  refhospital: { text: 'Ref. Hospital', joiner: ': ' },
  collectedby: { text: 'Collected by', joiner: ': ' },
  department: { text: 'Department', joiner: ': ' },
  branch: { text: 'Centre', joiner: ': ' },
  registered: { text: 'Registered on', joiner: ': ' },
  collected: { text: 'Collected on', joiner: ': ' },
  reported: { text: 'Reported on', joiner: ': ' },
  reportStatus: { text: 'Report status', joiner: ' : ' },
});

/** The fields whose label a lab may rename (the editor's list), in strip order. */
export const RENAMEABLE_LABEL_KEYS: readonly string[] = [
  'name', 'ageSex', 'age', 'sex', 'mrn', 'orderid', 'phone', 'refdoctor', 'refhospital',
  'collectedby', 'department', 'branch', 'registered', 'collected', 'reported', 'reportStatus',
];

/** Joiners the editor offers between a label and its value. */
export const LABEL_JOINER_CHOICES: readonly { value: string; label: string }[] = [
  { value: 'auto', label: 'As today' },
  { value: ' : ', label: 'Name : value' },
  { value: ': ', label: 'Name: value' },
  { value: ' - ', label: 'Name - value' },
];

/** Age styles the editor offers, with a sample of how 45 prints. */
export const AGE_STYLE_CHOICES: readonly { value: ReportPatientStyle['ageStyle']; label: string }[] = [
  { value: 'short', label: '45 Y' },
  { value: 'Years', label: '45 Years' },
  { value: 'yrs', label: '45 yrs' },
  { value: 'long', label: '45 years' },
  { value: 'Y', label: '45Y' },
];

/** The label to print for `key`. `literal` is what the renderer printed before
 *  this feature ("Age : ", "Ref. By: ") and is returned untouched when the lab
 *  set nothing — that is what keeps untouched templates byte-identical. */
export function patientLabel(p: ReportPatientStyle, key: string, literal: string): string {
  const custom = (p.labels[key] ?? '').trim();
  if (!custom && p.labelJoiner === 'auto') return literal;
  const own = PATIENT_LABELS[key];
  const text = custom || own?.text || literal.replace(/\s*:\s*$/, '');
  const joiner = p.labelJoiner === 'auto' ? (own?.joiner ?? ': ') : p.labelJoiner;
  return text + joiner;
}

/** Upper-case, spaces kept — for the 4-column grid's caption labels. */
export function gridLabel(p: ReportPatientStyle, key: string, literal: string): string {
  const custom = (p.labels[key] ?? '').trim();
  return custom ? custom.toUpperCase() : literal;
}

/** Sex in the chosen style ('Female' → 'Female' | 'F'). Empty when unknown. */
export function sexText(sex: string | null | undefined, style: ReportPatientStyle['sexStyle']): string {
  const s = (sex ?? '').trim();
  if (!s) return '';
  return style === 'letter' ? s.charAt(0).toUpperCase() : s;
}

/** The age in `style` ('auto' → `fallback`, the wording the layout always used). */
export function ageText(patient: StripPatient | null | undefined, p: ReportPatientStyle, fallback: AgeStyle): string {
  if (!patient) return '';
  const age = typeof patient.age === 'string' ? (patient.age.trim() === '' ? null : Number(patient.age)) : patient.age;
  const style: AgeStyle = p.ageStyle === 'auto' ? fallback : p.ageStyle;
  return formatAge({ age: age ?? null, ageDisplay: patient.ageDisplay ?? null, ageYears: patient.ageYears ?? null }, style);
}

/** "45 Y / Male" — age and sex as ONE field. */
export function ageSexText(patient: StripPatient | null | undefined, p: ReportPatientStyle, fallback: AgeStyle): string {
  return [ageText(patient, p, fallback), sexText(patient?.sex, p.sexStyle)].filter(Boolean).join(p.joiner);
}

/** The "Report status" value. */
export function reportStatusText(isPartial: boolean | undefined): string {
  return isPartial ? 'Preliminary' : 'Final';
}

/** "Page 2 of 3". */
export function pageOfText(n: number, m: number): string {
  return `Page ${n} of ${m}`;
}

/** The one-line patient identity printed at the top of every continuation page:
 *  `Name  ·  45 Y / Male  ·  MRN …  ·  Order …`. Pieces with no value are left out. */
export function miniStripText(
  patient: (StripPatient & { displayName?: string; mrn?: string }) | null | undefined,
  orderNumber: string | null | undefined,
  p: ReportPatientStyle,
): string {
  const parts = [
    (patient?.displayName ?? '').trim() || '—',
    ageSexText(patient, p, 'short'),
    (patient?.mrn ?? '').trim() ? `MRN ${(patient?.mrn ?? '').trim()}` : '',
    (orderNumber ?? '').trim() ? `Order ${(orderNumber ?? '').trim()}` : '',
  ].filter(Boolean);
  return parts.join('  ·  ');
}

/** Choosing Combined / Separate rewrites the arranged columns: `age` + `sex`
 *  become ONE `ageSex` chip (where the first of them stood) and back. The drag
 *  arrangement stays the single source of truth. A column set that holds
 *  neither is returned as is, so a default (never-arranged) strip is not
 *  turned into an arranged one. */
export function swapAgeSexColumns(cols: readonly (readonly string[])[], toCombined: boolean): string[][] {
  const out = cols.map(c => [...c]);
  if (toCombined) {
    let at: [number, number] | null = null;
    out.forEach((c, ci) => c.forEach((k, ki) => { if (!at && (k === 'age' || k === 'sex')) at = [ci, ki]; }));
    if (!at) return out;
    const [ci, ki] = at as [number, number];
    out.forEach((c, i) => { out[i] = c.filter((k, j) => !(k === 'age' || k === 'sex') || (i === ci && j === ki)); });
    out[ci] = out[ci].map(k => (k === 'age' || k === 'sex' ? 'ageSex' : k));
    return out;
  }
  return out.map(c => c.flatMap(k => (k === 'ageSex' ? ['age', 'sex'] : [k])));
}
