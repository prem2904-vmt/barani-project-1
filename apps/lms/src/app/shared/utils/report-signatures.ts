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

/** Vertical rhythm of one signature row (pt, from the row's top). */
export const SIG_ROW = {
  /** Air above the image — separates the row from what precedes it. */
  lead: 10,
  /** Image/scribble baseline (image spans baseline-20 … baseline+4). */
  base: 30,
  /** Name baseline, relative to `base`. */
  name: 16,
  /** Each optional line (title, registration) adds this much. */
  title: 11,
  reg: 10,
  /** Air under the last baseline. */
  tail: 7,
} as const;

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
export interface SignatureRowLayout { top: number; height: number; slots: SignatureSlot[]; }
export interface SignatureBlockLayout { rows: SignatureRowLayout[]; height: number; slotW: number; }

/** Full sign-off layout for a block starting at `top`. Rows stack with no
 *  extra gap — each row's own `lead` separates it from the one above. */
export function layoutSignatureBlock(
  sigs: ReadonlyArray<ReportSignature | null | undefined> | null | undefined,
  left: number,
  usableW: number,
  top = 0,
): SignatureBlockLayout {
  const list = presentSignatures(sigs);
  const perRow = signaturesPerRow(usableW);
  const slotW = usableW / perRow;
  const rows: SignatureRowLayout[] = [];
  let y = top;
  let i = 0;
  for (const k of signatureRowSizes(list.length, perRow)) {
    const row = list.slice(i, i + k);
    i += k;
    const xs = signatureCentres(k, left, usableW, slotW);
    const height = signatureRowHeight(row);
    rows.push({ top: y, height, slots: row.map((sig, j) => ({ sig, cx: xs[j] })) });
    y += height;
  }
  return { rows, height: y - top, slotW };
}
