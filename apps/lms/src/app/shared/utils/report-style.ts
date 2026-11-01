import type { ReportTemplate } from '../models/report.model';
import { parseTemplateMeta } from './report-header-layout';

/**
 * The report STYLE object — one validated JSON blob in the template's
 * existing `metadata` JSON (`metadata.reportStyle`). It bundles the choices
 * that have no other home (text fitting, patient-block wording, density,
 * signature placement, chart look). No DDL, no backend change: the server
 * keeps its object-only `metadata` guard.
 *
 * Rules (report layout plan §3.1 / §4):
 *  - DEFAULTS = TODAY. A missing / junk key reads as its default, so a lab
 *    that never touches the new cards prints byte-identical paper.
 *  - `writeReportStyle` DROPS every key that equals its default, so an
 *    untouched lab stores nothing at all.
 *  - One reader (`readReportStyle`) and one validator (`validateReportStyle`);
 *    the editor, the renderer and (later) the tidy-up step share them.
 *  - Released / stored PDFs are immutable — a style change affects only
 *    reports rendered after it.
 *
 * Phases 0–1 consume `fit` only; the rest of the shape is declared now so
 * later phases add readers, not a second schema.
 */

export interface ReportFitStyle {
  /** false = exactly today's behaviour (long text may overlap). */
  enabled: boolean;
  /** Never shrink text below this size (pt). */
  minPt: number;
  /** Wrap up to this many lines before shrinking. */
  maxLines: number;
  /** Widen the name column of the results table when names are long. */
  autoColumns: boolean;
}

export interface ReportPatientStyle {
  ageSex: 'separate' | 'combined';
  /** 'auto' = each layout's own wording (today). */
  ageStyle: 'auto' | 'Years' | 'short' | 'Y' | 'yrs' | 'long';
  sexStyle: 'word' | 'letter';
  /** Between age and sex when they print as one field. */
  joiner: string;
  labels: Record<string, string>;
  /** 'auto' = each label keeps its own punctuation (today). */
  labelJoiner: string;
  frame: 'rules' | 'box' | 'tint' | 'none';
  continuation: 'none' | 'mini' | 'full';
  showReportStatus: boolean;
}

export interface ReportSignatureStyle {
  placement: 'department' | 'end' | 'every-page';
  show: 'image' | 'name-only' | 'verified-line';
  imageH: number;
  reserveMm: number | null;
  verifiedText: string;
  maxPerRow: number;
}

export interface ReportStyle {
  v: 1;
  preset: 'classic' | 'modern' | 'compact' | 'custom';
  fit: ReportFitStyle;
  patient: ReportPatientStyle;
  pageNumbers: 'n' | 'n-of-m';
  density: 'normal' | 'compact' | 'relaxed';
  squeeze: boolean;
  colors: { palette: 'ink' | 'navy' | 'teal' | 'forest' | 'plum' | 'slate' | 'custom'; printSafe: boolean };
  letterhead: { preset: 'digital' | 'preprinted' | 'image'; continuation: 'none' | 'slim' | 'full' };
  signatures: ReportSignatureStyle;
  charts: {
    trend: { style: 'png' | 'vector'; layout: 'grid-2' | 'grid-3' | 'list'; band: boolean; values: boolean };
    rangeBar: boolean;
    previous: boolean;
  };
}

export const DEFAULT_REPORT_STYLE: Readonly<ReportStyle> = Object.freeze({
  v: 1,
  preset: 'classic',
  fit: { enabled: false, minPt: 7, maxLines: 2, autoColumns: false },
  patient: {
    ageSex: 'separate', ageStyle: 'auto', sexStyle: 'word', joiner: ' / ', labels: {}, labelJoiner: 'auto',
    frame: 'rules', continuation: 'none', showReportStatus: false,
  },
  pageNumbers: 'n',
  density: 'normal',
  squeeze: false,
  colors: { palette: 'custom', printSafe: true },
  letterhead: { preset: 'digital', continuation: 'none' },
  signatures: {
    placement: 'department', show: 'image', imageH: 24, reserveMm: null,
    verifiedText: 'Electronically verified by {name} on {datetime}', maxPerRow: 4,
  },
  charts: { trend: { style: 'png', layout: 'grid-2', band: true, values: true }, rangeBar: false, previous: false },
} as ReportStyle);

// ── schema: one table drives read, validate and default-dropping ───────────

type Leaf =
  | { k: 'bool' }
  | { k: 'num'; min: number; max: number; int?: boolean; nullable?: boolean }
  | { k: 'enum'; of: readonly string[] }
  | { k: 'str'; max: number }
  | { k: 'strMap'; max: number };
type Schema = { [key: string]: Leaf | Schema };

const SCHEMA: Schema = {
  preset: { k: 'enum', of: ['classic', 'modern', 'compact', 'custom'] },
  fit: {
    enabled: { k: 'bool' },
    minPt: { k: 'num', min: 5, max: 10 },
    maxLines: { k: 'num', min: 1, max: 4, int: true },
    autoColumns: { k: 'bool' },
  },
  patient: {
    ageSex: { k: 'enum', of: ['separate', 'combined'] },
    ageStyle: { k: 'enum', of: ['auto', 'Years', 'short', 'Y', 'yrs', 'long'] },
    sexStyle: { k: 'enum', of: ['word', 'letter'] },
    joiner: { k: 'str', max: 12 },
    labels: { k: 'strMap', max: 40 },
    labelJoiner: { k: 'str', max: 6 },
    frame: { k: 'enum', of: ['rules', 'box', 'tint', 'none'] },
    continuation: { k: 'enum', of: ['none', 'mini', 'full'] },
    showReportStatus: { k: 'bool' },
  },
  pageNumbers: { k: 'enum', of: ['n', 'n-of-m'] },
  density: { k: 'enum', of: ['normal', 'compact', 'relaxed'] },
  squeeze: { k: 'bool' },
  colors: {
    palette: { k: 'enum', of: ['ink', 'navy', 'teal', 'forest', 'plum', 'slate', 'custom'] },
    printSafe: { k: 'bool' },
  },
  letterhead: {
    preset: { k: 'enum', of: ['digital', 'preprinted', 'image'] },
    continuation: { k: 'enum', of: ['none', 'slim', 'full'] },
  },
  signatures: {
    placement: { k: 'enum', of: ['department', 'end', 'every-page'] },
    show: { k: 'enum', of: ['image', 'name-only', 'verified-line'] },
    imageH: { k: 'num', min: 16, max: 40 },
    reserveMm: { k: 'num', min: 5, max: 120, nullable: true },
    verifiedText: { k: 'str', max: 160 },
    maxPerRow: { k: 'num', min: 1, max: 6, int: true },
  },
  charts: {
    trend: {
      style: { k: 'enum', of: ['png', 'vector'] },
      layout: { k: 'enum', of: ['grid-2', 'grid-3', 'list'] },
      band: { k: 'bool' },
      values: { k: 'bool' },
    },
    rangeBar: { k: 'bool' },
    previous: { k: 'bool' },
  },
};

const isLeaf = (n: Leaf | Schema): n is Leaf => typeof (n as Leaf).k === 'string';
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** One leaf value cleaned, or `undefined` when it is junk (caller records it). */
function cleanLeaf(leaf: Leaf, v: unknown): unknown {
  switch (leaf.k) {
    case 'bool': return typeof v === 'boolean' ? v : undefined;
    case 'enum': return typeof v === 'string' && leaf.of.includes(v) ? v : undefined;
    case 'str': return typeof v === 'string' && v.length <= leaf.max ? v : undefined;
    case 'num': {
      if (v === null) return leaf.nullable ? null : undefined;
      if (typeof v !== 'number' || !isFinite(v) || v < leaf.min || v > leaf.max) return undefined;
      return leaf.int ? Math.round(v) : v;
    }
    case 'strMap': {
      if (!isObj(v)) return undefined;
      const out: Record<string, string> = {};
      for (const [k, s] of Object.entries(v)) {
        if (typeof s === 'string' && s.trim() && s.length <= leaf.max && k.length <= 40) out[k] = s;
      }
      return out;
    }
  }
}

const sameLeaf = (a: unknown, b: unknown): boolean =>
  isObj(a) && isObj(b) ? JSON.stringify(a) === JSON.stringify(b) : a === b;

/** Walk `src` through the schema. `onReject` collects dotted paths of junk. */
function walk(schema: Schema, src: unknown, defaults: Record<string, unknown>, path: string,
              onReject: (p: string) => void): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const s = isObj(src) ? src : {};
  for (const [key, node] of Object.entries(schema)) {
    const here = path ? `${path}.${key}` : key;
    const has = Object.prototype.hasOwnProperty.call(s, key);
    if (isLeaf(node)) {
      if (!has) { out[key] = defaults[key]; continue; }
      const c = cleanLeaf(node, s[key]);
      if (c === undefined) { onReject(here); out[key] = defaults[key]; } else out[key] = c;
    } else {
      out[key] = walk(node, has ? s[key] : undefined, defaults[key] as Record<string, unknown>, here, onReject);
      if (has && !isObj(s[key])) onReject(here);
    }
  }
  for (const key of Object.keys(s)) if (key !== 'v' && !(key in schema)) onReject(path ? `${path}.${key}` : key);
  return out;
}

/** Full, clean style + the dotted paths that were rejected (junk / unknown).
 *  The tidy-up step reuses the rejected list to tell the user what it ignored. */
export function validateReportStyle(raw: unknown): { style: ReportStyle; rejected: string[] } {
  const rejected: string[] = [];
  const out = walk(SCHEMA, raw, DEFAULT_REPORT_STYLE as unknown as Record<string, unknown>, '', p => rejected.push(p));
  return { style: { v: 1, ...out } as unknown as ReportStyle, rejected };
}

/** The template's report style — tolerant: missing / junk keys read as default. */
export function readReportStyle(tpl: Pick<ReportTemplate, 'metadata'> | null | undefined): ReportStyle {
  return validateReportStyle(parseTemplateMeta(tpl)['reportStyle']).style;
}

/** The sparse form: only keys that differ from the default. `{}` = untouched. */
function sparse(schema: Schema, full: Record<string, unknown>, defaults: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, node] of Object.entries(schema)) {
    if (isLeaf(node)) {
      if (!sameLeaf(full[key], defaults[key])) out[key] = full[key];
    } else {
      const sub = sparse(node, full[key] as Record<string, unknown>, defaults[key] as Record<string, unknown>);
      if (Object.keys(sub).length) out[key] = sub;
    }
  }
  return out;
}

/** True when the style changes nothing (every renderer path then stays on
 *  today's code, and nothing is stamped on the PDF). */
export function isDefaultReportStyle(s: ReportStyle | null | undefined): boolean {
  if (!s) return true;
  return Object.keys(sparse(SCHEMA, s as unknown as Record<string, unknown>, DEFAULT_REPORT_STYLE as unknown as Record<string, unknown>)).length === 0;
}

export type ReportStylePatch = { [K in keyof Omit<ReportStyle, 'v'>]?: ReportStyle[K] extends object ? Partial<ReportStyle[K]> | Record<string, unknown> : ReportStyle[K] };

function merge(base: unknown, patch: unknown): unknown {
  if (!isObj(patch)) return patch;
  const b = isObj(base) ? base : {};
  const out: Record<string, unknown> = { ...b };
  for (const [k, v] of Object.entries(patch)) {
    // A string map (labels) is replaced whole; every other object merges.
    out[k] = isObj(v) && k !== 'labels' ? merge(b[k], v) : v;
  }
  return out;
}

/** Immutable: the template `metadata` string with `patch` applied to the style
 *  (other metadata keys kept). Keys equal to their default are dropped, and the
 *  whole `reportStyle` key is removed when nothing is left — a lab that never
 *  touches the new cards stores nothing. Junk in the patch is ignored. */
export function writeReportStyle(tpl: Pick<ReportTemplate, 'metadata'> | null | undefined, patch: ReportStylePatch | null): string {
  const meta = parseTemplateMeta(tpl);
  const current = readReportStyle(tpl);
  const next = patch === null ? DEFAULT_REPORT_STYLE : validateReportStyle(merge(current, patch)).style;
  const slim = sparse(SCHEMA, next as unknown as Record<string, unknown>, DEFAULT_REPORT_STYLE as unknown as Record<string, unknown>);
  if (Object.keys(slim).length === 0) delete meta['reportStyle'];
  else meta['reportStyle'] = { v: 1, ...slim };
  return JSON.stringify(meta);
}

/** The bundles of §3.12. `Classic` is today. Newly provisioned tenants and
 *  every preset turn text fitting on (owner decision 1); existing templates
 *  never get it written for them. */
export const STYLE_PRESETS: Readonly<Record<'classic' | 'modern' | 'compact', ReportStylePatch>> = Object.freeze({
  classic: { preset: 'classic' },
  modern: {
    preset: 'modern',
    fit: { enabled: true },
    patient: { ageSex: 'combined', ageStyle: 'short', frame: 'tint', continuation: 'mini' },
    pageNumbers: 'n-of-m',
    colors: { palette: 'teal' },
    signatures: { placement: 'end' },
    charts: { trend: { style: 'vector' }, rangeBar: true },
  },
  compact: {
    preset: 'compact',
    fit: { enabled: true },
    patient: { ageSex: 'combined', ageStyle: 'yrs', sexStyle: 'letter', labelJoiner: ': ', continuation: 'mini' },
    pageNumbers: 'n-of-m',
    density: 'compact',
    squeeze: true,
    colors: { palette: 'ink' },
    signatures: { placement: 'end', show: 'verified-line' },
    charts: { trend: { style: 'vector', layout: 'grid-3' }, rangeBar: true },
  },
} as Record<'classic' | 'modern' | 'compact', ReportStylePatch>);

/** The style a NEWLY provisioned tenant starts with (text fitting on, page
 *  N of M, a mini patient strip on continuation pages). A catalogue-clone-time
 *  default — never written into existing tenants on deploy. */
export const NEW_TENANT_REPORT_STYLE: ReportStylePatch = Object.freeze({
  fit: { enabled: true }, pageNumbers: 'n-of-m', patient: { continuation: 'mini' },
} as ReportStylePatch);

/** The text stamped into the PDF's Creator field — only for a template that
 *  carries a non-default style, so untouched labs stay byte-identical. */
export function reportEngineStamp(s: ReportStyle): string {
  return `Prefrontal report engine v1; style v${s.v}; preset ${s.preset}`;
}
