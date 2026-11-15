import { PhiSource } from './office.service';

/** Plain words for why a file is flagged as holding patient data (the server's source codes never reach the screen). */
export const PHI_SOURCE_WORDS: Record<string, string> = {
  results: 'Lab results were inserted',
  patient: "A patient's details were added",
  report: 'Made from a patient report',
  partner_report: "Made from a partner lab's report",
  image: "A patient's picture was added",
  copy: 'Copied from a file that contains patient data',
};
export const phiSourceWords = (source: string): string => PHI_SOURCE_WORDS[source] ?? 'Patient data was added';

const when = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
};

/** "Lab results were inserted, 15 Nov, by Lakshmi Admin" (the lab's own wording when the server kept a detail). */
export function phiLine(s: PhiSource): string {
  const base = s.detail && s.detail.trim() ? s.detail.trim() : phiSourceWords(s.source);
  return [base, when(s.at), s.byName ? `by ${s.byName}` : ''].filter(Boolean).join(', ');
}
