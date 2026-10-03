/**
 * Compare consults side by side (owner, consult v6) — PURE. Each picked
 * consult (today's draft or a past one from GET …/patients/{id}/history,
 * which already carries its form + answers, diagnoses, Rx and tests) becomes
 * a column; matching lines share a row — the same form question, the same
 * drug — and a value that differs from the column to its left is flagged.
 */
import { allQuestions, normalizeSchema, printRows } from '../admin/forms/renderer';

export interface CompareConsult {
  id: string;
  /** yyyy-MM-dd. */
  date: string;
  /** Column title ("Today", "12 Aug 2026"). */
  label: string;
  sub: string;
  complaint: string;
  schema: unknown;
  answers: Record<string, unknown>;
  diagnoses: string[];
  /** One per drug: key (drug id, else the name) + its shorthand. */
  rx: { key: string; name: string; text: string }[];
  tests: string[];
}

export interface CompareRow { key: string; label: string; cells: string[]; changed: boolean[]; }
export interface CompareMatrix { findings: CompareRow[]; diagnosis: CompareRow; rx: CompareRow[]; tests: CompareRow; }

function row(key: string, label: string, cells: string[]): CompareRow {
  const changed = cells.map((c, i) => i > 0 && (c || cells[i - 1]) !== '' && c !== cells[i - 1]);
  return { key, label, cells, changed };
}

/** The answered form lines of one consult as label → text (sides as "R: … · L: …"). */
export function findingsOf(c: Pick<CompareConsult, 'schema' | 'answers'>): { key: string; label: string; text: string }[] {
  const qs = allQuestions(normalizeSchema(c.schema));
  return printRows(qs, c.answers ?? {}).map(r => ({
    key: r.key, label: r.label,
    text: r.text ?? (r.sides ? [r.sides.r ? 'R: ' + r.sides.r : '', r.sides.l ? 'L: ' + r.sides.l : ''].filter(Boolean).join(' · ')
      : r.table ? 'Table' : r.files ? `${r.files} file${r.files === 1 ? '' : 's'}` : ''),
  })).filter(x => x.text);
}

/** Columns oldest → newest; rows aligned by question key / drug. Pure. */
export function compareMatrix(cols: readonly CompareConsult[]): CompareMatrix {
  const per = cols.map(c => new Map(findingsOf(c).map(f => [f.key, f])));
  const order: { key: string; label: string }[] = [];
  const seen = new Set<string>();
  per.forEach(m => m.forEach(f => { if (!seen.has(f.key)) { seen.add(f.key); order.push({ key: f.key, label: f.label }); } }));
  const findings = [
    row('complaint', 'Complaint', cols.map(c => c.complaint.trim())),
    ...order.map(o => row(o.key, o.label, per.map(m => m.get(o.key)?.text ?? ''))),
  ].filter(r => r.cells.some(Boolean));
  const drugs: { key: string; name: string }[] = [];
  const seenD = new Set<string>();
  cols.forEach(c => c.rx.forEach(d => { if (!seenD.has(d.key)) { seenD.add(d.key); drugs.push({ key: d.key, name: d.name }); } }));
  return {
    findings,
    diagnosis: row('dx', 'Diagnosis', cols.map(c => c.diagnoses.join(', '))),
    rx: drugs.map(d => row(d.key, d.name, cols.map(c => c.rx.find(x => x.key === d.key)?.text ?? ''))),
    tests: row('tests', 'Tests', cols.map(c => c.tests.join(', '))),
  };
}
