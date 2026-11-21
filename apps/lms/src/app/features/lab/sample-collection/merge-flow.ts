/**
 * Collect — merge tubes in place (owner-approved design 2026-11-21, mock tube-pour-v1, "Pour" style).
 * Pure rules for the inline flow; the component only wires signals and the animation.
 *
 *  - drop a tube on another: not drawn → it slides in; drawn → it pours in;
 *  - a different additive (serum into fluoride…) asks INLINE on the target card, never a dialog;
 *  - the screen updates OPTIMISTICALLY (no refetch) and rolls back when the server refuses;
 *  - the kept tube shows "+ Gold · 26310" chips; a chip takes that tube back out (Separate) until the
 *    kept tube has left the counter.
 */
import { manualMergesOf, sampleMeta, shortTubeName } from '../../../shared/utils/tube-merge';

/** What a tube holds, for the "Serum into Fluoride" words (mirror of SharedTubeRules.Subject). */
const ADDITIVE: Record<string, string> = {
  plain: 'serum', red: 'serum', sst: 'serum', gold: 'serum',
  fluoride: 'fluoride', grey: 'fluoride', gray: 'fluoride',
  edta: 'edta', lavender: 'edta', purple: 'edta',
  citrate: 'citrate', blue: 'citrate', heparin: 'heparin', green: 'heparin', esr: 'esr', black: 'esr',
};
const ADDITIVE_WORD: Record<string, string> = {
  serum: 'Serum', fluoride: 'Fluoride', edta: 'EDTA', citrate: 'Citrate', heparin: 'Heparin', esr: 'ESR',
};

export function additiveOf(tubeColor: string | null | undefined): string | null {
  return ADDITIVE[(tubeColor ?? '').trim().toLowerCase()] ?? null;
}

/** "Serum into Fluoride" when the two tubes hold different additives (serum and serum-gel are the same);
 *  null when they match or either is unknown (the server still warns if it knows better). */
export function additiveWords(src: { tubeColor?: string | null }, dst: { tubeColor?: string | null }): string | null {
  const a = additiveOf(src.tubeColor), b = additiveOf(dst.tubeColor);
  if (!a || !b || a === b) return null;
  return `${ADDITIVE_WORD[a]} into ${ADDITIVE_WORD[b]}`;
}

/** Not drawn yet → the tube slides in (no liquid); drawn → it pours. */
export function pourMotion(src: { status?: string | null }): 'slide' | 'pour' {
  const st = src.status ?? '';
  return st === '' || st === 'pending' ? 'slide' : 'pour';
}

/** One tube poured into the kept tube, as the chip needs it. `sampleId` is set for pours made since Separate
 *  existed (metadata.manualMerge[].restore.sampleId, or the optimistic entry). */
export interface MergedIn { barcode: string; tubeColor: string | null; sampleId: string | null; drawn: boolean }

export function mergedInto(s: { metadata?: unknown } | null | undefined): MergedIn[] {
  const raw = sampleMeta(s)['manualMerge'];
  const list = Array.isArray(raw) ? raw : [];
  const byBarcode = new Map<string, Record<string, unknown>>();
  for (const e of list) if (e && typeof e === 'object' && typeof (e as { barcode?: unknown }).barcode === 'string') byBarcode.set((e as { barcode: string }).barcode, e as Record<string, unknown>);
  return manualMergesOf(s).map(e => {
    const full = byBarcode.get(e.barcode) ?? {};
    const restore = (full['restore'] ?? {}) as Record<string, unknown>;
    const sid = (typeof restore['sampleId'] === 'string' ? restore['sampleId'] : null) as string | null;
    return { barcode: e.barcode, tubeColor: e.tubeColor ?? null, sampleId: sid, drawn: restore['drawn'] === true };
  });
}

/** "+ Gold · 26310" — the chip on the kept tube. */
export function chipText(m: { barcode: string; tubeColor: string | null }): string {
  return `+ ${shortTubeName(m.tubeColor)} · ${m.barcode}`;
}

/** "2 tubes in one" on the kept tube's status line (null when nothing was poured in). */
export function tubesInOne(s: { metadata?: unknown }): string | null {
  const n = manualMergesOf(s).length;
  return n > 0 ? `${n + 1} tubes in one` : null;
}

/** May a chip take its tube back out? Only while the kept tube is still at the counter, and only for a pour
 *  the server can undo (made since Separate existed). `why` is the plain reason shown on hover. */
export function chipSeparable(keep: { status?: string | null; dispatchedAt?: string | null; receivedAtLab?: string | null },
  m: MergedIn): { ok: boolean; why: string | null } {
  const st = keep.status ?? '';
  if (keep.dispatchedAt || keep.receivedAtLab || !(st === 'pending' || st === 'collected'))
    return { ok: false, why: 'This tube has left the counter, so it can’t be separated any more.' };
  if (!m.sampleId) return { ok: false, why: 'Poured in before Separate existed, so it can’t be taken back out.' };
  return { ok: true, why: null };
}

/** Plain words for the server's Separate refusals. */
const SEPARATE_REFUSALS: Record<string, string> = {
  separate_dispatched: 'This tube has left the counter, so it can’t be separated any more.',
  separate_has_results: 'Work has started on that tube’s tests, so it can’t be separated.',
  separate_order: 'Take out the tube poured in last first.',
  separate_not_found: 'That tube is no longer poured into this one.',
  separate_unavailable: 'Poured in before Separate existed, so it can’t be taken back out.',
};
export function separateRefusalText(code: string | null | undefined, serverMessage?: string | null): string {
  const m = (serverMessage ?? '').trim();
  if (m) return m;
  return (code && SEPARATE_REFUSALS[code]) || 'That tube can’t be taken back out.';
}

interface Tube { id: string; status?: string | null; barcode?: string | null; tubeColor?: string | null; metadata?: unknown; collectedAt?: string | null }

function withEntry(metadata: unknown, entry: Record<string, unknown> | null, removeBarcode?: string): string {
  const meta = { ...sampleMeta({ metadata }) } as Record<string, unknown>;
  let list = Array.isArray(meta['manualMerge']) ? [...(meta['manualMerge'] as unknown[])] : [];
  let retired = Array.isArray(meta['mergedFromBarcodes']) ? [...(meta['mergedFromBarcodes'] as unknown[])] : [];
  if (entry) {
    list.push(entry);
    if (typeof entry['barcode'] === 'string' && !retired.includes(entry['barcode'])) retired.push(entry['barcode']);
  }
  if (removeBarcode) {
    list = list.filter(e => (e as { barcode?: string })?.barcode !== removeBarcode);
    retired = retired.filter(b => b !== removeBarcode);
  }
  if (list.length) meta['manualMerge'] = list; else delete meta['manualMerge'];
  if (retired.length) meta['mergedFromBarcodes'] = retired; else delete meta['mergedFromBarcodes'];
  return JSON.stringify(meta);
}

/**
 * The screen right after a pour, before the server answers: the poured tube leaves the list, the kept tube
 * carries its chip (and is "collected" when a drawn tube went into an undrawn one — the server does the same).
 * Returns the new list plus the snapshot to roll back to.
 */
export function optimisticMerge<T extends Tube>(list: readonly T[], keepId: string, goneId: string, nowIso: string):
  { list: T[]; snapshot: T[]; gone: T | null } {
  const snapshot = [...list];
  const gone = list.find(x => x.id === goneId) ?? null;
  const keep = list.find(x => x.id === keepId);
  if (!gone || !keep) return { list: snapshot, snapshot, gone: null };
  const drawn = pourMotion(gone) === 'pour';
  const entry = { barcode: gone.barcode ?? '', tubeColor: gone.tubeColor ?? null, at: nowIso, restore: { sampleId: gone.id, drawn }, optimistic: true };
  const next = list.filter(x => x.id !== goneId).map(x => {
    if (x.id !== keepId) return x;
    const raise = drawn && (x.status ?? 'pending') === 'pending';
    return { ...x, metadata: withEntry(x.metadata, entry), ...(raise ? { status: 'collected', collectedAt: gone.collectedAt ?? nowIso } : {}) };
  });
  return { list: next, snapshot, gone };
}

/**
 * The screen right after Separate, before the server answers: the chip leaves the kept tube and the tube is
 * back right after it with its own Sample ID (`restored` = the tube as it was, or a placeholder built from
 * the chip). Returns the new list plus the snapshot to roll back to.
 */
export function optimisticSeparate<T extends Tube>(list: readonly T[], keepId: string, restored: T):
  { list: T[]; snapshot: T[] } {
  const snapshot = [...list];
  const idx = list.findIndex(x => x.id === keepId);
  if (idx < 0) return { list: snapshot, snapshot };
  const next = list.filter(x => x.id !== restored.id).map(x =>
    x.id === keepId ? { ...x, metadata: withEntry(x.metadata, null, restored.barcode ?? '') } : x);
  next.splice(next.findIndex(x => x.id === keepId) + 1, 0, restored);
  return { list: next, snapshot };
}

/** A stand-in for a tube taken back out whose original row this screen no longer holds. */
export function placeholderTube<T extends Tube>(keep: T, m: MergedIn): T {
  return { ...keep, id: m.sampleId ?? `restored-${m.barcode}`, barcode: m.barcode, tubeColor: m.tubeColor,
    status: m.drawn ? 'collected' : 'pending', metadata: null, tests: [] } as unknown as T;
}
