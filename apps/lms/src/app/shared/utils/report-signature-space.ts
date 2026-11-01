import type { ReportSignature } from '../models/report.model';
import { DEFAULT_REPORT_STYLE, type ReportSignatureStyle } from './report-style';
import {
  SIG_IMG_H, SIG_MAX, layoutSignatureBlock, presentSignatures,
  type SigLayoutOpts, type SigShow, type SignatureBlockLayout, type SignatureExtra,
} from './report-signatures';

/**
 * Signature SPACE DECIDER (report layout plan section 3.10) — pure.
 *
 * Decides WHERE the sign-off prints (end of each department, once after the
 * End-of-Report line, or at the foot of every page), HOW it prints (signature
 * image, name only, or one "Electronically verified by ..." line) and how much
 * paper it takes. The renderer (report-pdf.ts) and the editor's live readout
 * both ask this one module, so the screen and the paper cannot disagree.
 *
 * WHO signs is not decided here and never changes: the signatories come in
 * per department exactly as the snapshot carries them (present-only, at most
 * 7). This module only moves and re-draws them.
 *
 * Defaults = today: `department` + `image` + 24 pt + 4 per row + no reserve is
 * `sigOptsFrom() === undefined`, so the renderer runs its original code.
 */

/** Millimetres to points. */
export const MM_PT = 72 / 25.4;

export type SigPlacement = ReportSignatureStyle['placement'];

/** The signatory style as the plan reads it. */
export function signatureStyleOf(style: { signatures?: Partial<ReportSignatureStyle> } | null | undefined): ReportSignatureStyle {
  return { ...DEFAULT_REPORT_STYLE.signatures, ...(style?.signatures ?? {}) };
}

/** A stationery reserve prints names only: never an image over a printed signature. */
export function effectiveShow(s: Pick<ReportSignatureStyle, 'show' | 'reserveMm'>): SigShow {
  return s.reserveMm && s.show === 'image' ? 'name-only' : s.show;
}

/** The geometry knobs, or `undefined` when they are all today's (so the
 *  renderer stays on its original path, byte for byte). */
export function sigOptsFrom(s: ReportSignatureStyle, linesOf?: SigLayoutOpts['linesOf']): SigLayoutOpts | undefined {
  const d = DEFAULT_REPORT_STYLE.signatures;
  const show = effectiveShow(s);
  if (show === 'image' && s.imageH === d.imageH && s.maxPerRow === d.maxPerRow && !s.reserveMm) return undefined;
  return { show, imageH: s.imageH, maxPerRow: s.maxPerRow, reserveH: s.reserveMm ? s.reserveMm * MM_PT : 0, linesOf };
}

/** Image box (pt) for a slot: 70 x 24 at the default height, scaled with the
 *  chosen height, and never wider than the slot leaves room for. */
export function signatureImageBox(imageH: number, slotW: number): { w: number; h: number } {
  const full = 70 * (imageH / SIG_IMG_H);
  const w = Math.min(full, Math.max(40, slotW - 6));
  return { w, h: imageH * (w / full) };
}

// ── who, merged ────────────────────────────────────────────────────────────

const sigKey = (s: ReportSignature) =>
  [(s.name ?? '').trim().toLowerCase(), (s.regNo ?? '').trim().toLowerCase(), s.signatureUrl ?? '', (s.title ?? '').trim().toLowerCase()].join('|');

export interface DeptSignatures { department: string; sigs: ReadonlyArray<ReportSignature | null | undefined> }

/** Every department's present signatories as ONE list: a user who signs two
 *  departments appears once, in the order they first sign. Their own title
 *  line (their designation, which already names the specialty) is kept as it
 *  is - a department list appended to it only ever collided with the next
 *  signatory's. */
export function mergeSignatories(depts: ReadonlyArray<DeptSignatures>): ReportSignature[] {
  const out: ReportSignature[] = [];
  for (const d of depts) {
    for (const sig of presentSignatures(d.sigs)) {
      if (!out.some(o => sigKey(o) === sigKey(sig))) out.push(sig);
    }
  }
  return out.slice(0, SIG_MAX);
}

// ── verified line ──────────────────────────────────────────────────────────

/** "01 Nov 2026 14:32" — the moment printed in the verified line. */
export function formatVerifiedStamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())} ${m} ${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The attestation line for one signatory. `{name}`, `{title}`, `{reg}` and
 *  `{datetime}` are replaced; a registration number the text does not place
 *  itself follows the name in brackets. A missing time drops the "on ..." tail. */
export function verifiedLine(sig: ReportSignature, text: string, stamp: string): string {
  const name = (sig.name ?? '').trim() || (sig.title ?? '').trim() || 'the signatory';
  const reg = (sig.regNo ?? '').trim();
  const title = (sig.title ?? '').trim();
  const placesReg = /\{reg\}/.test(text);
  let out = text
    .replace(/\{name\}/g, reg && !placesReg ? `${name} (Reg. ${reg})` : name)
    .replace(/\{reg\}/g, reg)
    .replace(/\{title\}/g, title)
    .replace(/\{datetime\}/g, stamp);
  if (!stamp) out = out.replace(/\s+on\s*$/i, '').replace(/\s+on\s+(?=[.,;]|$)/i, ' ');
  return out.replace(/\s{2,}/g, ' ').trim();
}

// ── the plan ───────────────────────────────────────────────────────────────

export interface SignaturePlanBlock { label: string; sigs: ReportSignature[]; layout: SignatureBlockLayout; rowSizes: number[] }
export interface SignaturePlan {
  placement: SigPlacement;
  show: SigShow;
  blocks: SignaturePlanBlock[];
  /** Signatories in the largest block. */
  count: number;
  /** Rows in the largest block (verified-line: lines). */
  rows: number;
  /** Height (pt) the tallest block takes (reserve included). */
  blockH: number;
  /** Height (pt) taken on EVERY page — only the every-page placement costs this. */
  perPageH: number;
  /** The stationery reserve (pt), 0 when none. */
  reservedH: number;
  /** The reserve is smaller than what prints in it. */
  reserveTooSmall: boolean;
}

export interface PlanInput {
  style: ReportSignatureStyle;
  /** Present signatories per department, in report order. */
  departments: ReadonlyArray<DeptSignatures>;
  /** Report-level signatories (the every-page placement prints these; else the merged list). */
  reportLevel?: ReadonlyArray<ReportSignature | null | undefined>;
  usableW: number;
  left?: number;
  extraOf?: (s: ReportSignature, slotW: number) => SignatureExtra;
  linesOf?: SigLayoutOpts['linesOf'];
}

export function planSignatures(input: PlanInput): SignaturePlan {
  const { style, usableW } = input;
  const left = input.left ?? 0;
  const opts = sigOptsFrom(style, input.linesOf);
  const show = effectiveShow(style);
  const lay = (sigs: ReportSignature[]) => layoutSignatureBlock(sigs, left, usableW, 0, input.extraOf, opts);
  const blocks: SignaturePlanBlock[] = [];
  const add = (label: string, sigs: ReportSignature[]) => {
    if (!sigs.length) return;
    const layout = lay(sigs);
    blocks.push({ label, sigs, layout, rowSizes: layout.rows.map(r => r.slots.length) });
  };
  if (style.placement === 'department') {
    for (const d of input.departments) add(d.department, presentSignatures(d.sigs));
  } else if (style.placement === 'end') {
    add('Report', mergeSignatories(input.departments));
  } else {
    const level = presentSignatures(input.reportLevel);
    add('Every page', level.length ? level : mergeSignatories(input.departments));
  }
  const tallest = blocks.reduce<SignaturePlanBlock | null>((a, b) => (!a || reservedOf(b) > reservedOf(a) ? b : a), null);
  const blockH = tallest ? reservedOf(tallest) : 0;
  const reservedH = opts?.reserveH && blockH > 0 ? opts.reserveH : 0;
  return {
    placement: style.placement, show, blocks,
    count: Math.max(0, ...blocks.map(b => b.sigs.length)),
    rows: tallest ? tallest.layout.rows.length : 0,
    blockH,
    perPageH: style.placement === 'every-page' ? blockH : 0,
    reservedH,
    reserveTooSmall: !!tallest && reservedH > 0 && tallest.layout.height > reservedH + 0.01,
  };
}

const reservedOf = (b: SignaturePlanBlock) => b.layout.reserved ?? b.layout.height;

const WHERE: Record<SigPlacement, string> = {
  department: 'at the end of each department',
  end: 'once, after End of Report',
  'every-page': 'at the foot of every page',
};

/** "2 signatories · 1 row · 28 mm · at the end of each department" — the editor's live readout. */
export function signatureReadout(plan: SignaturePlan): string {
  if (plan.count === 0) return 'No signatories to print.';
  const mm = Math.round(plan.blockH / MM_PT);
  const n = plan.count;
  const rows = plan.show === 'verified-line'
    ? `${plan.rows} line${plan.rows === 1 ? '' : 's'}`
    : `${plan.rows} row${plan.rows === 1 ? '' : 's'}`;
  return [`${n} ${n === 1 ? 'signatory' : 'signatories'}`, rows, `${mm} mm`, WHERE[plan.placement]].join(' · ');
}

/** A longer sentence for the card: what the space costs and where. */
export function signatureCost(plan: SignaturePlan): string {
  if (plan.count === 0) return 'Nothing to sign, so no space is used.';
  const mm = Math.round(plan.blockH / MM_PT);
  switch (plan.placement) {
    case 'department': return `Takes ${mm} mm at the foot of each department's last page.`;
    case 'end': return `Takes ${mm} mm once, on the last page. Departments no longer need to end a page.`;
    case 'every-page': return `Takes ${mm} mm on every page, so each page holds ${mm} mm less results.`;
  }
}

// ── editor sample ──────────────────────────────────────────────────────────

/** Stand-in signatories for the designer's preview and readout (never printed on a real report). */
export const SAMPLE_SIGNERS: ReadonlyArray<ReportSignature> = Object.freeze([
  { name: 'Lab Technologist', title: 'Sample signatory' },
  { name: 'Consultant Pathologist', title: 'Sample signatory' },
  { name: 'Consultant Biochemist', title: 'Sample signatory' },
  { name: 'Consultant Haematologist', title: 'Sample signatory' },
  { name: 'Consultant Microbiologist', title: 'Sample signatory' },
  { name: 'Quality Manager', title: 'Sample signatory' },
  { name: 'Laboratory Director', title: 'Sample signatory' },
]);

/** A4 usable width the sign-off lays out in (page minus both side margins). */
export const SIG_USABLE_W = 595.28 - 2 * 30;

/** The plan for `n` sample signatories in two sample departments - what the editor's readout shows. */
export function samplePlan(style: ReportSignatureStyle, n: number): SignaturePlan {
  const sigs = SAMPLE_SIGNERS.slice(0, Math.max(0, Math.min(SIG_MAX, n)));
  return planSignatures({
    style, usableW: SIG_USABLE_W,
    departments: [{ department: 'Haematology', sigs }, { department: 'Biochemistry', sigs }],
  });
}
