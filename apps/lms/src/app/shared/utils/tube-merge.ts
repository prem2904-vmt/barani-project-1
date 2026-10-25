/**
 * Pour one tube into another at collection (owner 2026-10-25: a baby's red
 * tube poured into the grey one). The SERVER decides everything
 * (`SharedTubeRules.CanManualMerge` / `OrderService.MergeTubesAsync`); this
 * file only reads its answers and turns them into plain words.
 *
 *   GET  /api/samples/{keepId}/merge-candidates → MergeCandidate[]
 *   POST /api/samples/{keepId}/merge { sampleIds, confirmWarnings }
 *        200 → MergeResult · 409 merge_needs_confirm · 400 refusal codes
 *
 * The kept tube keeps its Sample ID; a poured tube's ID is retired but still
 * scans. The kept tube carries `metadata.manualMerge` (one entry per poured
 * tube) — the "+ Red (2610…)" chips. A drawn poured tube stays as status
 * `merged` (audit only): every screen hides it.
 */

export interface MergeWarning { code: string; message: string; }

export interface MergeCandidate {
  id: string;
  barcode?: string | null;
  tubeColor?: string | null;
  status?: string | null;
  tests?: string[];
  eligible: boolean;
  reason?: string | null;
  warnings?: MergeWarning[];
}

export interface ManualMergeEntry {
  barcode: string;
  tubeColor?: string | null;
  by?: string | null;
  at?: string | null;
}

export interface MergeResult<S = unknown> {
  sample: S;
  warnings?: MergeWarning[];
  retired?: string[];
}

/** The server's status for a drawn tube that was poured into another. */
export const MERGED_STATUS = 'merged';

export function isMergedTube(s: { status?: string | null } | null | undefined): boolean {
  return (s?.status ?? '') === MERGED_STATUS;
}

/** Sample metadata arrives as a JSON string (OrderSample.metadata) or, from
 *  some endpoints, already parsed. Unreadable → {}. */
export function sampleMeta(s: { metadata?: unknown } | null | undefined): Record<string, unknown> {
  const raw = s?.metadata;
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** The tubes poured into this one (newest last), from `metadata.manualMerge`. */
export function manualMergesOf(s: { metadata?: unknown } | null | undefined): ManualMergeEntry[] {
  const list = sampleMeta(s)['manualMerge'];
  if (!Array.isArray(list)) return [];
  return list
    .filter((e): e is ManualMergeEntry => !!e && typeof (e as ManualMergeEntry).barcode === 'string' && !!(e as ManualMergeEntry).barcode)
    .map(e => ({ barcode: e.barcode, tubeColor: e.tubeColor ?? null, by: e.by ?? null, at: e.at ?? null }));
}

/** Short tube names for the chips and the picker ("Red", "Grey" …). */
const SHORT_TUBE: Record<string, string> = {
  plain: 'Red', red: 'Red', sst: 'Gold', edta: 'Lavender', lavender: 'Lavender',
  fluoride: 'Grey', grey: 'Grey', gray: 'Grey', heparin: 'Green', citrate: 'Blue', blue: 'Blue',
  esr: 'Black', trace: 'Royal blue', sterile: 'Sterile pot', urine: 'Urine bottle',
  blood_culture: 'Culture bottle', multiple: 'Multiple',
};

export function shortTubeName(tubeColor: string | null | undefined): string {
  const k = (tubeColor ?? '').trim().toLowerCase();
  if (!k) return 'Tube';
  return SHORT_TUBE[k] ?? (k.charAt(0).toUpperCase() + k.slice(1));
}

/** "+ Red (26104)" — one chip per tube poured into the kept tube. */
export function mergeChipLabel(e: ManualMergeEntry): string {
  return `+ ${shortTubeName(e.tubeColor)} (${e.barcode})`;
}

/** Plain words for the server's refusal codes (the server's own message wins
 *  when it sends one). */
const REFUSALS: Record<string, string> = {
  merge_different_order: 'Only tubes of the same order can be poured together.',
  merge_outsourced: 'An outsourced tube can’t be poured — it goes to the partner lab.',
  merge_micro_container: 'Culture and sterile pots can’t be poured.',
  merge_timed_series: 'Timed (series) draws can’t be poured into another tube.',
  merge_has_results: 'This tube already has results.',
  merge_already_received: 'The lab has already received this tube.',
  merge_dead_tube: 'This tube was cancelled, rejected or missed.',
  merge_self: 'A tube can’t be poured into itself.',
};

export function mergeRefusalText(code: string | null | undefined, serverMessage?: string | null): string {
  const m = (serverMessage ?? '').trim();
  if (m) return m;
  return (code && REFUSALS[code]) || 'This tube can’t be poured into that one.';
}

/** The tubes of one order a tube may be poured INTO: the other live tubes
 *  (not merged away, not the same tube). The server still has the last word
 *  through the candidates call. */
export function pourTargets<T extends { id: string; orderId?: string; status?: string | null }>(
  source: T, samples: readonly T[],
): T[] {
  return samples.filter(s =>
    s.id !== source.id &&
    (!source.orderId || !s.orderId || s.orderId === source.orderId) &&
    !isMergedTube(s));
}

/** May this tube offer "Pour into another tube…"? Only a tube still at the
 *  counter: pending or collected, in-house, not part of a timed series. A
 *  sterile / culture pot never pours. The server checks every rule again. */
export function canOfferPour(s: {
  status?: string | null;
  outsourcedVendorId?: string | null;
  repeatOffsetMin?: number | null;
  tubeColor?: string | null;
}): boolean {
  const st = s.status ?? '';
  if (st !== 'pending' && st !== 'collected') return false;
  if (s.outsourcedVendorId) return false;
  if (s.repeatOffsetMin != null) return false;
  const k = (s.tubeColor ?? '').toLowerCase();
  if (k === 'sterile' || k === 'blood_culture' || k === 'urine') return false;
  return true;
}

/** Warnings as one plain sentence list for the confirm dialog. */
export function warningLines(ws: readonly MergeWarning[] | null | undefined): string[] {
  return [...new Set((ws ?? []).map(w => (w?.message ?? '').trim()).filter(Boolean))];
}
