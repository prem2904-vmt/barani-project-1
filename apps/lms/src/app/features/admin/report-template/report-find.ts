/**
 * The report page's band search (owner 2026-11-17: ONE page for the report).
 * Each entry names a setting in plain words, the tab it lives on and — when the
 * tab is made of titled groups — the group heading to scroll to. Typing matches
 * the label and the extra words; nothing here reaches the server.
 */
export interface ReportFindHit {
  readonly label: string;
  readonly tab: 'letterhead' | 'patient' | 'table' | 'columns' | 'sequence' | 'footer' | 'sending';
  /** The `.pf-rtb-h` heading text of the group to bring into view. */
  readonly heading?: string;
  readonly words?: string;
}

export const REPORT_FIND: readonly ReportFindHit[] = [
  { label: 'Logo, lab name and tagline', tab: 'letterhead', words: 'header brand colour address nabl accreditation background image' },
  { label: 'Pre-printed letterhead paper', tab: 'letterhead', words: 'letterhead area blank top margin' },
  { label: 'Department patient strip', tab: 'patient', heading: 'Who is this strip for?', words: 'microbiology department scope' },
  { label: 'Patient block layout', tab: 'patient', heading: 'Patient block', words: 'columns fields arrange' },
  { label: 'Long text', tab: 'patient', heading: 'Long text', words: 'long names wrap shrink fit overlap' },
  { label: 'Age and sex', tab: 'patient', heading: 'Age & sex', words: 'age sex gender years combined' },
  { label: 'Field names', tab: 'patient', heading: 'Field names', words: 'rename label mrn uhid lab no order' },
  { label: 'Patient strip frame', tab: 'patient', heading: 'Frame', words: 'border box line' },
  { label: 'Patient line on every page', tab: 'patient', heading: 'Every page', words: 'continuation page numbers page 2 of 3' },
  { label: 'QR codes', tab: 'patient', heading: 'QR codes', words: 'qr order profile link' },
  { label: 'Date and time format', tab: 'patient', heading: 'Date & time format', words: 'date time collected reported' },
  { label: 'Arrange the fields', tab: 'patient', heading: 'Arrange the fields', words: 'drag order fields' },
  { label: 'Table columns per department', tab: 'columns', words: 'columns width unit method reference range' },
  { label: 'Report theme', tab: 'table', heading: 'Report theme', words: 'theme font style preset' },
  { label: 'Page density', tab: 'table', heading: 'Page density', words: 'squeeze compact fit pages' },
  { label: 'Charts', tab: 'table', heading: 'Charts', words: 'trend graph trendogram chart' },
  { label: 'Table colours', tab: 'table', heading: 'Table colours', words: 'palette colour color zebra stripes' },
  { label: 'Typography and table', tab: 'table', heading: 'Typography & table', words: 'font size bold rows lines' },
  { label: 'Abnormal results', tab: 'table', heading: 'Abnormal results', words: 'high low flag critical abnormal summary sheet' },
  { label: 'Departments and details', tab: 'table', heading: 'Departments & details', words: 'department heading method sample type' },
  { label: 'Print order of departments and tests', tab: 'sequence', words: 'sequencing order sequence' },
  { label: 'Disclaimer and end of report', tab: 'footer', words: 'footer disclaimer end of report' },
  { label: 'Signatures', tab: 'footer', words: 'sign off pathologist signature consultant' },
  { label: 'Watermark and page numbers', tab: 'footer', words: 'watermark page number' },
  { label: 'Report notes', tab: 'table', heading: 'Report notes', words: 'tech notes report notes technician' },
  { label: 'WhatsApp Auto', tab: 'sending', heading: 'Send reports on WhatsApp', words: 'send report whatsapp auto auto send report sending' },
  { label: 'Send again when a report is corrected', tab: 'sending', heading: 'Send reports on WhatsApp', words: 'resend regenerated amended' },
  { label: 'WhatsApp message', tab: 'sending', heading: 'Send reports on WhatsApp', words: 'template message language' },
];

/** Up to eight settings matching every word typed, best (label start) first. */
export function findReportSettings(query: string, index: readonly ReportFindHit[] = REPORT_FIND): ReportFindHit[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hay = (h: ReportFindHit) => `${h.label} ${h.words ?? ''}`.toLowerCase().replace(/&/g, 'and');
  const hits = index.filter(h => words.every(w => hay(h).includes(w.replace(/&/g, 'and'))));
  const first = words[0];
  return hits
    .map((h, i) => ({ h, i, lead: h.label.toLowerCase().startsWith(first) ? 0 : 1 }))
    .sort((a, b) => a.lead - b.lead || a.i - b.i)
    .slice(0, 8)
    .map(x => x.h);
}
