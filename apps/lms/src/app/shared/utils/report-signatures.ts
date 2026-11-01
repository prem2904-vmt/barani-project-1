import type { ReportSignature } from '../models/report.model';

/**
 * Report sign-off geometry — pure, so the paper rules are testable without
 * rendering a PDF (owner, 2026-09-28: "signatures take far too much space").
 *
 *  - Only signatures that are actually PRESENT count. A lab may configure up
 *    to 7 slots, but a slot that resolved to nobody (no name, no image) takes
 *    no width and no height — 7 configured / 2 present lays out as 2.
 *  - Alignment by count, per row:
 *      1 → right;  2 → left + right;  3 → left, centre, right;
 *      4 → four evenly spaced.  In general: the first slot is flush left, the
 *      last flush right, the rest evenly between them (1 is the exception —
 *      a lone signatory signs on the right, where a reader looks for it).
 *  - A row holds at most SIG_MAX_PER_ROW signatories: the usable width divided
 *    by SIG_MIN_W (the narrowest slot a 70pt signature image + a bold name
 *    stays readable in). On A4 with 30pt side margins: 535pt / 120pt → 4.
 *  - More than that wraps into balanced rows, top row fullest:
 *      5 → 3 + 2,  6 → 3 + 3,  7 → 4 + 3.
 *  - Each row is only as tall as what its signatories print (image + name,
 *    plus a title line and a registration line only when someone in the row
 *    has one). No signatories → zero height, nothing reserved.
 */

/** Hard cap on signatories per sign-off block (the admin editor's limit). */
export const SIG_MAX = 7;
/** Narrowest readable signature slot (pt): the 70pt image plus air, and a
 *  ~22-character bold name at 9.5pt before it has to shrink. */
export const SIG_MIN_W = 120;
/** Signature image box (pt). */
export const SIG_IMG_W = 70;
export const SIG_IMG_H = 24;

/** Density overlay (report-density.ts): the air above and under a signature
 *  row. Normal = today's 10 / 7; the renderer sets it per render and resets it. */
let rhythm = { lead: 10, tail: 7 };
export function setSignatureRhythm(r: { lead: number; tail: number } | null): void {
  rhythm = r ? { lead: r.lead, tail: r.tail } : { lead: 10, tail: 7 };
}

/** Vertical rhythm of one signature row (pt, from the row's top). */
export const SIG_ROW = {
  /** Air above the image — separates the row from what precedes it. */
  get lead(): number { return rhythm.lead; },
  /** Image/scribble baseline (image spans baseline-20 … baseline+4). */
  get base(): number { return rhythm.lead + 20; },
  /** Name baseline, relative to `base`. */
  name: 16,
  /** Each optional line (title, registration) adds this much. */
  title: 11,
  reg: 10,
  /** Air under the last baseline. */
  get tail(): number { return rhythm.tail; },
};

/** The signatories that will actually print: a slot needs a name or an
 *  image, and at most SIG_MAX of them. */
export function presentSignatures(sigs: ReadonlyArray<ReportSignature | null | undefined> | null | undefined): ReportSignature[] {
  return (sigs ?? [])
    .filter((s): s is ReportSignature => !!s && (!!(s.name ?? '').trim() || !!s.signatureUrl))
    .slice(0, SIG_MAX);
}

/** How many signatories fit side by side in `usableW`. */
export function signaturesPerRow(usableW: number, minW = SIG_MIN_W): number {
  return Math.max(1, Math.floor(usableW / minW));
}

/** Split `n` signatories into balanced rows of at most `perRow`, fullest
 *  first (7 at 4/row → [4, 3]; 5 → [3, 2]; 6 → [3, 3]). */
export function signatureRowSizes(n: number, perRow: number): number[] {
  if (n <= 0) return [];
  const rows = Math.ceil(n / perRow);
  const base = Math.floor(n / rows);
  const extra = n % rows;
  return Array.from({ length: rows }, (_, i) => base + (i < extra ? 1 : 0));
}

/** X centres of `k` signatures in one row spanning [left, left + usableW],
 *  each in a slot `slotW` wide. 1 → right; ≥2 → first flush left, last flush
 *  right, the rest evenly between (so 4 at slotW = usableW/4 is four equal
 *  columns). */
export function signatureCentres(k: number, left: number, usableW: number, slotW: number): number[] {
  if (k <= 0) return [];
  const half = slotW / 2;
  if (k === 1) return [left + usableW - half];
  const step = (usableW - slotW) / (k - 1);
  return Array.from({ length: k }, (_, i) => left + half + i * step);
}

/** Height (pt) of one row: image + name, plus title / registration lines
 *  only when a signatory in the row prints one. */
export function signatureRowHeight(row: ReadonlyArray<ReportSignature>): number {
  if (row.length === 0) return 0;
  const hasTitle = row.some(s => !!(s.title ?? '').trim());
  const hasReg = row.some(s => !!(s.regNo ?? '').trim());
  return SIG_ROW.base + SIG_ROW.name + (hasTitle ? SIG_ROW.title : 0) + (hasReg ? SIG_ROW.reg : 0) + SIG_ROW.tail;
}

export interface SignatureSlot { sig: ReportSignature; cx: number; }
/** Extra height (pt) a signatory's wrapped lines need beyond the one-line rhythm. */
export interface SignatureExtra { name: number; title: number; reg: number; }
export interface SignatureRowLayout {
  top: number; height: number; slots: SignatureSlot[];
  /** The row's extra lines (the tallest signatory wins each line) — all zero unless text fitting wrapped a name. */
  extra: SignatureExtra;
  /** Offset (pt) from the row top to the image / name baseline. Absent = the image rhythm (`SIG_ROW.base`). */
  base?: number;
  /** Verified-line rows: how many text lines this signatory's attestation takes. */
  lines?: number;
}
export interface SignatureBlockLayout {
  rows: SignatureRowLayout[]; height: number; slotW: number;
  /** Height the block takes on the page: `height`, or the stationery reserve when that is taller (0 with nobody to sign). */
  reserved?: number;
}

/** What prints per signatory (report-signature-space.ts decides, the renderer obeys). */
export type SigShow = 'image' | 'name-only' | 'verified-line';
/** The Phase 6 knobs. Absent = today's geometry, byte for byte. */
export interface SigLayoutOpts {
  show: SigShow;
  /** Signature image height (pt); the image is SIG_IMG_W * imageH / SIG_IMG_H wide, never wider than its slot. */
  imageH: number;
  /** At most this many per row. */
  maxPerRow: number;
  /** Stationery reserve (pt): the block never takes less. 0 = none. */
  reserveH: number;
  /** Verified-line rows: lines the attestation of `s` takes in the full width. */
  linesOf?: (s: ReportSignature) => number;
}

/** One verified-line row: its line height, the air above the first row and under the last. */
export const SIG_VERIFIED = { line: 10, lead: 8, tail: 4 };
/** Name-only rows: the name sits this far above where the image rhythm would put it. */
export const SIG_NAME_ONLY_UP = 8;

/** Baseline offset of a row for the way it prints. */
export function signatureRowBase(opts: Pick<SigLayoutOpts, 'show' | 'imageH'> | undefined): number {
  if (!opts || opts.show === 'image') return SIG_ROW.base + (opts ? opts.imageH - SIG_IMG_H : 0);
  return SIG_ROW.lead - SIG_NAME_ONLY_UP;
}

/** Full sign-off layout for a block starting at `top`. Rows stack with no
 *  extra gap — each row's own `lead` separates it from the one above. */
export function layoutSignatureBlock(
  sigs: ReadonlyArray<ReportSignature | null | undefined> | null | undefined,
  left: number,
  usableW: number,
  top = 0,
  /** Text fitting: the extra height each signatory's name / title / reg line
   *  needs when it wraps inside a slot `slotW` wide. Absent = one line each
   *  (today's geometry, byte-identical). */
  extraOf?: (s: ReportSignature, slotW: number) => SignatureExtra,
  /** Signature space decider (Phase 6). Absent = today. */
  opts?: SigLayoutOpts,
): SignatureBlockLayout {
  const list = presentSignatures(sigs);
  if (opts && opts.show === 'verified-line') return layoutVerifiedBlock(list, left, usableW, top, opts);
  const perRow = opts ? Math.max(1, Math.min(signaturesPerRow(usableW), Math.round(opts.maxPerRow))) : signaturesPerRow(usableW);
  const slotW = usableW / perRow;
  const base = signatureRowBase(opts);
  const rows: SignatureRowLayout[] = [];
  let y = top;
  let i = 0;
  for (const k of signatureRowSizes(list.length, perRow)) {
    const row = list.slice(i, i + k);
    i += k;
    const xs = signatureCentres(k, left, usableW, slotW);
    const extra: SignatureExtra = { name: 0, title: 0, reg: 0 };
    if (extraOf) {
      for (const s of row) {
        const e = extraOf(s, slotW);
        extra.name = Math.max(extra.name, e.name); extra.title = Math.max(extra.title, e.title); extra.reg = Math.max(extra.reg, e.reg);
      }
    }
    const height = (opts ? rowHeightFor(row, base) : signatureRowHeight(row)) + extra.name + extra.title + extra.reg;
    rows.push({ top: y, height, slots: row.map((sig, j) => ({ sig, cx: xs[j] })), extra, ...(opts ? { base } : {}) });
    y += height;
  }
  const height = y - top;
  return { rows, height, slotW, ...(opts ? { reserved: reservedHeight(height, opts) } : {}) };
}

function rowHeightFor(row: ReadonlyArray<ReportSignature>, base: number): number {
  if (row.length === 0) return 0;
  const hasTitle = row.some(s => !!(s.title ?? '').trim());
  const hasReg = row.some(s => !!(s.regNo ?? '').trim());
  return base + SIG_ROW.name + (hasTitle ? SIG_ROW.title : 0) + (hasReg ? SIG_ROW.reg : 0) + SIG_ROW.tail;
}

function reservedHeight(height: number, opts: SigLayoutOpts): number {
  return height > 0 ? Math.max(height, opts.reserveH) : 0;
}

/** "Electronically verified by …" — one line per signatory, stacked. */
function layoutVerifiedBlock(list: ReportSignature[], left: number, usableW: number, top: number, opts: SigLayoutOpts): SignatureBlockLayout {
  const rows: SignatureRowLayout[] = [];
  let y = top;
  list.forEach((sig, i) => {
    const lines = Math.max(1, opts.linesOf ? opts.linesOf(sig) : 1);
    const height = SIG_VERIFIED.line * lines + (i === 0 ? SIG_VERIFIED.lead : 0) + (i === list.length - 1 ? SIG_VERIFIED.tail : 0);
    rows.push({ top: y, height, slots: [{ sig, cx: left }], extra: { name: 0, title: 0, reg: 0 }, lines });
    y += height;
  });
  const height = y - top;
  return { rows, height, slotW: usableW, reserved: reservedHeight(height, opts) };
}
