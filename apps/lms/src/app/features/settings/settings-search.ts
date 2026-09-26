import { SETTINGS_GROUPS } from './settings-registry';
import { SettingDef, SettingsTool } from './settings.model';

/**
 * Settings search = the band rule (every word must appear) over a row's
 * label, one-liner, option labels, group name and `synonyms[]`. Each query
 * word may also match its everyday synonym from a small table
 * ("bar code" → barcode, "tax" → gst, "notification" → alert).
 */

/** Everyday word → a word the registry uses (either may match). */
const WORD_SYNONYMS: Record<string, string> = {
  'bar-code': 'barcode',
  'qrcode': 'qr',
  'notification': 'alert',
  'notifications': 'alert',
  'alarm': 'alert',
  'tax': 'gst',
  'taxes': 'gst',
  'invoice': 'bill',
  'invoices': 'bill',
  'receipt': 'bill',
  'mrn': 'patient number',
  'uhid': 'patient number',
  'prices': 'price',
  'rate': 'price',
  'rates': 'price',
  'login': 'sign-in',
  'signin': 'sign-in',
  'printer': 'print',
  'label': 'sticker',
  'labels': 'sticker',
  'organisation': 'lab name',
  'organization': 'lab name',
  'appointment': 'appointments',
  'slot': 'appointment',
};

/** Two-word phrases folded before word splitting. */
const PHRASES: Array<[RegExp, string]> = [
  [/\bbar\s+code\b/g, 'barcode'],
  [/\bqr\s+code\b/g, 'qr'],
  [/\bdata\s+matrix\b/g, 'datamatrix'],
  [/\bsign\s+in\b/g, 'sign-in'],
];

/** Lower-case, fold phrases, split into words. */
export function queryWords(q: string | null | undefined): string[] {
  let s = (q ?? '').toLowerCase().trim();
  for (const [re, to] of PHRASES) s = s.replace(re, to);
  return s.split(/\s+/).filter(Boolean);
}

/** Every query word must appear in the haystack — as typed OR as its
 *  everyday synonym ("tax" finds GST, "label" finds sticker). */
export function wordsMatch(words: readonly string[], hay: string): boolean {
  const h = hay.toLowerCase();
  const hs = h.replace(/-/g, ' ');
  return words.every((w) => {
    const alt = WORD_SYNONYMS[w];
    return h.includes(w) || hs.includes(w) || (!!alt && (h.includes(alt) || hs.includes(alt)));
  });
}

function groupLabel(id: string): string { return SETTINGS_GROUPS.find((g) => g.id === id)?.label ?? ''; }

export function rowHaystack(d: SettingDef, extra = ''): string {
  return [
    d.label, d.help, groupLabel(d.group), ...(d.synonyms ?? []),
    ...(d.control.options ?? []).map((o) => o.label),
    ...(d.control.fields ?? []).map((f) => f.label),
    extra,
  ].filter(Boolean).join(' ');
}

/** Does this row match? `extra` = dynamic text (e.g. alert names). */
export function matchRow(d: SettingDef, query: string, extra = ''): boolean {
  const w = queryWords(query);
  return !w.length || wordsMatch(w, rowHaystack(d, extra));
}

export function matchTool(t: SettingsTool, query: string): boolean {
  const w = queryWords(query);
  return !w.length || wordsMatch(w, [t.label, t.help, groupLabel(t.group), ...(t.synonyms ?? [])].filter(Boolean).join(' '));
}

/** Rank: label hits first, then synonyms, then the rest; stable otherwise. */
export function searchRows(rows: readonly SettingDef[], query: string, extra: (d: SettingDef) => string = () => ''): SettingDef[] {
  const w = queryWords(query);
  if (!w.length) return rows.slice();
  const hits = rows.filter((d) => matchRow(d, query, extra(d)));
  const score = (d: SettingDef): number => {
    if (wordsMatch(w, d.label)) return 0;
    if (wordsMatch(w, (d.synonyms ?? []).join(' '))) return 1;
    return 2;
  };
  return hits.map((d, i) => ({ d, i, s: score(d) })).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.d);
}
