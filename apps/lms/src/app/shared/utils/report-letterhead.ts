import type { ReportTemplate } from '../models/report.model';
import {
  MM, readHeaderLayout, writeHeaderLayout, type BackgroundImage, type HeaderLayoutConfig, type ResolvedBackground,
} from './report-header-layout';
import { readReportStyle, writeReportStyle, type ReportStyle } from './report-style';

/**
 * LETTERHEAD PRESETS (report layout plan §3.8 / §3.9).
 *
 *  - Digital          the drawn letterhead on page 1 (today). Later pages can carry
 *                     nothing, a slim line (lab name, rule) or the whole letterhead.
 *  - Pre-printed paper the lab's own stationery: turns on the letterpad (header /
 *                     footer blank on paper) and keeps the SCAN as a page background
 *                     that prints on screen / in shared PDFs but NOT on the paper.
 *                     One upload serves both.
 *  - Image letterhead a designed PNG / JPG across the top of every page.
 *
 * A preset writes only what already has a home - the letterpad fields, the
 * template's background list, the "patient details start" height, and
 * `reportStyle.letterhead` - and nothing new in the database. The drawn header
 * is hidden only once the picture that replaces it exists, so a preset can never
 * leave a digital copy with no letterhead at all.
 */

export type LetterheadPresetId = ReportStyle['letterhead']['preset'];
export type LetterheadContinuation = ReportStyle['letterhead']['continuation'];
export const LETTERHEAD_PRESETS: ReadonlyArray<LetterheadPresetId> = ['digital', 'preprinted', 'image'];

/** Backgrounds a preset owns (so switching back can switch them off again). */
export const LH_SCAN_ID = 'lh-scan';
export const LH_IMAGE_ID = 'lh-image';

/** The drawn letterhead elements a picture replaces. */
const DRAWN_IDS = ['logo', 'name', 'tagline', 'address', 'phone', 'email', 'website', 'contact', 'nabl', 'accentBar', 'banner'];

export const DEFAULT_LETTERPAD_HEADER_MM = 45;
export const DEFAULT_LETTERPAD_FOOTER_MM = 30;
const IMAGE_BODY_MIN_MM = 20;
const IMAGE_BODY_MAX_MM = 80;

export function letterheadPresetOf(tpl: Pick<ReportTemplate, 'metadata'> | null | undefined): LetterheadPresetId {
  return readReportStyle(tpl).letterhead.preset;
}

const ownBg = (cfg: HeaderLayoutConfig | null, id: string): BackgroundImage | undefined => cfg?.backgrounds?.find(b => b.id === id);
export const hasStationeryScan = (tpl: Pick<ReportTemplate, 'metadata'> | null | undefined): boolean => !!ownBg(readHeaderLayout(tpl), LH_SCAN_ID);
export const hasLetterheadImage = (tpl: Pick<ReportTemplate, 'metadata'> | null | undefined): boolean => !!ownBg(readHeaderLayout(tpl), LH_IMAGE_ID);

function cloneCfg(cfg: HeaderLayoutConfig | null): HeaderLayoutConfig {
  return cfg
    ? { ...cfg, items: { ...cfg.items }, ...(cfg.backgrounds ? { backgrounds: cfg.backgrounds.map(b => ({ ...b })) } : {}), ...(cfg.lines ? { lines: cfg.lines.map(l => ({ ...l })) } : {}) }
    : { v: 1, items: {} };
}

/** Hide (or show) every drawn letterhead element, custom text lines included. */
function setDrawnHidden(cfg: HeaderLayoutConfig, hidden: boolean): void {
  const ids = [...DRAWN_IDS, ...(cfg.lines ?? []).map(l => 'line:' + l.id)];
  for (const id of ids) {
    const cur = { ...(cfg.items[id] ?? {}) };
    if (hidden) cur.hidden = true; else delete cur.hidden;
    if (Object.keys(cur).length) cfg.items[id] = cur; else delete cfg.items[id];
  }
}

/** Add or update one preset-owned background; `url` absent keeps the current picture. */
function putBg(cfg: HeaderLayoutConfig, id: string, base: Omit<BackgroundImage, 'id' | 'url'>, url?: string): void {
  const list = cfg.backgrounds ?? [];
  const cur = list.find(b => b.id === id);
  const u = url ?? cur?.url;
  if (!u) return;
  const next: BackgroundImage = { ...base, id, url: u };
  cfg.backgrounds = cur ? list.map(b => (b.id === id ? next : b)) : [...list, next];
}
function hideBg(cfg: HeaderLayoutConfig, id: string): void {
  if (!cfg.backgrounds) return;
  cfg.backgrounds = cfg.backgrounds.map(b => (b.id === id ? { ...b, hidden: true } : b));
}

/** Millimetres the image letterhead occupies across the full page width. */
export function imageLetterheadHeightMm(aspectHW: number): number {
  const mm = Math.round(210 * aspectHW + 3);
  return Math.min(IMAGE_BODY_MAX_MM, Math.max(IMAGE_BODY_MIN_MM, mm));
}

export interface LetterheadApplyOptions {
  /** A freshly uploaded stationery scan / header image (private upload path). */
  scanUrl?: string;
  imageUrl?: string;
  /** Height / width of the header image, for the patient-details start. */
  imageAspect?: number;
  /** Pre-printed paper: blank mm at the top / bottom (measured or typed). */
  headerMm?: number;
  footerMm?: number;
}

/** The template fields applying a letterhead preset changes. Immutable. */
export function applyLetterheadPreset(tpl: ReportTemplate, id: LetterheadPresetId, o: LetterheadApplyOptions = {}): Partial<ReportTemplate> {
  const prev = letterheadPresetOf(tpl);
  const cfg = cloneCfg(readHeaderLayout(tpl));
  const out: Partial<ReportTemplate> = {};

  if (id === 'digital') {
    if (prev !== 'digital') {
      setDrawnHidden(cfg, false);
      delete cfg.bodyTop;
      hideBg(cfg, LH_SCAN_ID); hideBg(cfg, LH_IMAGE_ID);
    }
    if (prev === 'preprinted') out.letterpadMode = false;
  } else if (id === 'preprinted') {
    const headerMm = o.headerMm ?? tpl.letterpadHeaderMm ?? DEFAULT_LETTERPAD_HEADER_MM;
    const footerMm = o.footerMm ?? tpl.letterpadFooterMm ?? DEFAULT_LETTERPAD_FOOTER_MM;
    out.letterpadMode = true; out.letterpadHeaderMm = headerMm; out.letterpadFooterMm = footerMm;
    putBg(cfg, LH_SCAN_ID, { area: 'page', fit: 'cover', opacity: 1, pages: 'all' }, o.scanUrl);
    hideBg(cfg, LH_IMAGE_ID);
    if (ownBg(cfg, LH_SCAN_ID)) { setDrawnHidden(cfg, true); cfg.bodyTop = headerMm; }
    else if (prev !== 'digital') { setDrawnHidden(cfg, false); delete cfg.bodyTop; }
  } else {
    if (prev === 'preprinted') out.letterpadMode = false;
    putBg(cfg, LH_IMAGE_ID, { area: 'header', fit: 'contain', opacity: 1, pages: 'all' }, o.imageUrl);
    hideBg(cfg, LH_SCAN_ID);
    if (ownBg(cfg, LH_IMAGE_ID)) {
      setDrawnHidden(cfg, true);
      if (o.imageAspect) cfg.bodyTop = imageLetterheadHeightMm(o.imageAspect);
      else if (cfg.bodyTop === undefined) cfg.bodyTop = 35;
    } else if (prev !== 'digital') { setDrawnHidden(cfg, false); delete cfg.bodyTop; }
  }
  // Un-hide the preset's own picture when its preset is chosen.
  const own = id === 'preprinted' ? LH_SCAN_ID : id === 'image' ? LH_IMAGE_ID : '';
  if (own && cfg.backgrounds) cfg.backgrounds = cfg.backgrounds.map(b => { if (b.id !== own) return b; const { hidden: _h, ...rest } = b; return rest; });
  if (cfg.backgrounds && !cfg.backgrounds.length) delete cfg.backgrounds;

  const existing = readHeaderLayout(tpl);
  const touched = !!existing || Object.keys(cfg.items).length > 0 || !!cfg.backgrounds?.length || cfg.bodyTop !== undefined;
  let metadata = writeHeaderLayout(tpl, touched ? cfg : null);
  metadata = writeReportStyle({ metadata }, { letterhead: { preset: id } });
  out.metadata = metadata;
  return out;
}

/** Blank mm at the top / bottom of the pre-printed paper. While the lab's scan
 *  stands in for the drawn letterhead, the patient details start at the same line. */
export function setLetterpadMm(tpl: ReportTemplate, mm: { headerMm?: number; footerMm?: number }): Partial<ReportTemplate> {
  const clamp = (v: number) => Math.min(120, Math.max(0, Math.round(v * 10) / 10));
  const out: Partial<ReportTemplate> = {};
  if (mm.headerMm !== undefined && isFinite(mm.headerMm)) out.letterpadHeaderMm = clamp(mm.headerMm);
  if (mm.footerMm !== undefined && isFinite(mm.footerMm)) out.letterpadFooterMm = clamp(mm.footerMm);
  const cfg = readHeaderLayout(tpl);
  if (out.letterpadHeaderMm !== undefined && letterheadPresetOf(tpl) === 'preprinted' && ownBg(cfg, LH_SCAN_ID)) {
    out.metadata = writeHeaderLayout(tpl, { ...cfg!, bodyTop: out.letterpadHeaderMm });
  }
  return out;
}

export function setLetterheadContinuation(tpl: Pick<ReportTemplate, 'metadata'>, c: LetterheadContinuation): Partial<ReportTemplate> {
  return { metadata: writeReportStyle(tpl, { letterhead: { continuation: c } }) };
}

// ── what later pages carry (used by the renderer, pure) ───────────────────

/** Height of the slim continuation letterhead (lab name + rule), pt. */
export const SLIM_LETTERHEAD_H = 20;

export type ContinuationKind = 'none' | 'clear' | 'slim' | 'full';
export interface ContinuationHeader {
  kind: ContinuationKind;
  /** pt added above the continuation body (and the mini patient strip). */
  h: number;
}

/**
 * Where the content of pages 2+ must start so nothing prints over artwork:
 * a header / whole-page picture that repeats on every page. 0 = no artwork to clear.
 * Only the Pre-printed and Image presets reserve this - Digital and untouched
 * templates keep the page tops they always had.
 */
export function continuationClearance(
  preset: LetterheadPresetId,
  bgs: ReadonlyArray<Pick<ResolvedBackground, 'area' | 'hidden' | 'loaded' | 'pages' | 'box'>>,
  headerMm: number,
): number {
  if (preset === 'digital') return 0;
  const later = bgs.filter(b => !b.hidden && b.loaded && b.pages === 'all' && (b.area === 'header' || b.area === 'page'));
  if (!later.length) return 0;
  if (preset === 'preprinted') return Math.max(0, headerMm) * MM;
  return Math.max(0, ...later.filter(b => b.area === 'header').map(b => b.box.y + b.box.h));
}

/**
 * What pages 2+ get above their body. `top` = the page's top margin (MARGIN_TOP):
 * a later page's body starts at top + 10 without any of this, and the mini
 * strip's first line sits at top + 9. Artwork to clear moves both to the same
 * place a blank letterpad print puts them (artwork edge + 9 / + 10). Pre-printed
 * paper (a blank letterpad render) never draws a letterhead - the paper has it.
 */
export function planContinuationHeader(a: {
  mode: LetterheadContinuation; letterpad: boolean; clearance: number; top: number; headerBottom: number; bodyGap: number;
}): ContinuationHeader {
  if (a.letterpad) return { kind: 'none', h: 0 };
  if (a.clearance > 0) return { kind: 'clear', h: Math.max(0, Math.ceil(a.clearance - a.top)) };   // body at the artwork's edge + 10
  if (a.mode === 'slim') return { kind: 'slim', h: SLIM_LETTERHEAD_H };
  if (a.mode === 'full') return { kind: 'full', h: Math.max(0, Math.ceil(a.headerBottom + a.bodyGap - (a.top + 10))) };
  return { kind: 'none', h: 0 };
}
