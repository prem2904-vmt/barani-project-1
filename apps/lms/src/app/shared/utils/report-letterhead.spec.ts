import type { ReportTemplate } from '../models/report.model';
import { MM, readHeaderLayout } from './report-header-layout';
import {
  LH_IMAGE_ID, LH_SCAN_ID, SLIM_LETTERHEAD_H, applyLetterheadPreset, continuationClearance, hasLetterheadImage, hasStationeryScan,
  imageLetterheadHeightMm, letterheadPresetOf, planContinuationHeader, setLetterheadContinuation, setLetterpadMm,
} from './report-letterhead';
import { isDefaultReportStyle, readReportStyle } from './report-style';

const BASE = { id: 't', tenantId: 'x', labName: 'Lab', headerPreset: 'classic' } as unknown as ReportTemplate;
const apply = (t: ReportTemplate, p: Partial<ReportTemplate>): ReportTemplate => ({ ...t, ...p });
const SCAN = '/uploads/t/scan.jpg', HDR = '/uploads/t/header.png';

describe('letterhead presets - what each one writes', () => {
  it('a template that never picks a preset stores nothing and reads as Digital', () => {
    expect(letterheadPresetOf(BASE)).toBe('digital');
    expect(isDefaultReportStyle(readReportStyle(BASE))).toBe(true);
  });

  it('Digital on an untouched template changes no stored byte', () => {
    const p = applyLetterheadPreset(BASE, 'digital');
    expect(apply(BASE, p).metadata ?? '{}').toBe('{}');
    expect(p.letterpadMode).toBeUndefined();
  });

  describe('Pre-printed paper', () => {
    it('without a scan: turns the letterpad on and keeps the drawn letterhead', () => {
      const t = apply(BASE, applyLetterheadPreset(BASE, 'preprinted'));
      expect(t.letterpadMode).toBe(true);
      expect(t.letterpadHeaderMm).toBe(45);
      expect(t.letterpadFooterMm).toBe(30);
      expect(letterheadPresetOf(t)).toBe('preprinted');
      expect(readHeaderLayout(t)).toBeNull();
    });

    it('with a scan: the scan is a page background that prints on screen but NOT on the paper, the drawn header steps aside', () => {
      const t = apply(BASE, applyLetterheadPreset(BASE, 'preprinted', { scanUrl: SCAN, headerMm: 42, footerMm: 28 }));
      expect(t.letterpadHeaderMm).toBe(42);
      expect(t.letterpadFooterMm).toBe(28);
      const cfg = readHeaderLayout(t)!;
      const bg = cfg.backgrounds!.find(b => b.id === LH_SCAN_ID)!;
      expect(bg).toMatchObject({ url: SCAN, area: 'page', fit: 'cover', pages: 'all', opacity: 1 });
      expect(bg.onLetterhead).toBeUndefined();
      expect(cfg.bodyTop).toBe(42);
      for (const id of ['logo', 'name', 'address', 'accentBar', 'banner']) expect(cfg.items[id]?.hidden, id).toBe(true);
      expect(hasStationeryScan(t)).toBe(true);
    });

    it('editing the blank top moves the patient details with it; the bottom does not', () => {
      const t = apply(BASE, applyLetterheadPreset(BASE, 'preprinted', { scanUrl: SCAN, headerMm: 42, footerMm: 28 }));
      const top = setLetterpadMm(t, { headerMm: 47.26 });
      expect(top.letterpadHeaderMm).toBe(47.3);
      expect(readHeaderLayout(apply(t, top))!.bodyTop).toBe(47.3);
      const bottom = setLetterpadMm(t, { footerMm: 33 });
      expect(bottom).toEqual({ letterpadFooterMm: 33 });
      expect(setLetterpadMm(t, { headerMm: 500 }).letterpadHeaderMm).toBe(120);
    });

    it('going back to Digital restores the drawn letterhead and switches the paper off', () => {
      const pre = apply(BASE, applyLetterheadPreset(BASE, 'preprinted', { scanUrl: SCAN, headerMm: 42 }));
      const back = apply(pre, applyLetterheadPreset(pre, 'digital'));
      const cfg = readHeaderLayout(back)!;
      expect(back.letterpadMode).toBe(false);
      expect(cfg.items['logo']?.hidden).toBeUndefined();
      expect(cfg.bodyTop).toBeUndefined();
      expect(cfg.backgrounds!.find(b => b.id === LH_SCAN_ID)!.hidden).toBe(true);
      expect(letterheadPresetOf(back)).toBe('digital');
    });
  });

  describe('Image letterhead', () => {
    it('with an image: header-area picture on every page, drawn header hidden, details start under it', () => {
      const t = apply(BASE, applyLetterheadPreset(BASE, 'image', { imageUrl: HDR, imageAspect: 0.18 }));
      const cfg = readHeaderLayout(t)!;
      expect(cfg.backgrounds!.find(b => b.id === LH_IMAGE_ID)).toMatchObject({ url: HDR, area: 'header', fit: 'contain', pages: 'all' });
      expect(cfg.bodyTop).toBe(imageLetterheadHeightMm(0.18));
      expect(cfg.items['name']?.hidden).toBe(true);
      expect(t.letterpadMode).toBeUndefined();
      expect(hasLetterheadImage(t)).toBe(true);
    });
    it('height follows the picture, kept inside a sane range', () => {
      expect(imageLetterheadHeightMm(0.2)).toBe(45);
      expect(imageLetterheadHeightMm(0.01)).toBe(20);
      expect(imageLetterheadHeightMm(2)).toBe(80);
    });
    it('without an image yet it only records the choice (the drawn letterhead keeps printing)', () => {
      const t = apply(BASE, applyLetterheadPreset(BASE, 'image'));
      expect(letterheadPresetOf(t)).toBe('image');
      expect(readHeaderLayout(t)?.items['name']?.hidden).toBeUndefined();
    });
    it('Pre-printed -> Image swaps the pictures and turns the paper off', () => {
      const pre = apply(BASE, applyLetterheadPreset(BASE, 'preprinted', { scanUrl: SCAN }));
      const img = apply(pre, applyLetterheadPreset(pre, 'image', { imageUrl: HDR, imageAspect: 0.2 }));
      const bgs = readHeaderLayout(img)!.backgrounds!;
      expect(img.letterpadMode).toBe(false);
      expect(bgs.find(b => b.id === LH_SCAN_ID)!.hidden).toBe(true);
      expect(bgs.find(b => b.id === LH_IMAGE_ID)!.hidden).toBeUndefined();
    });
  });

  it('keeps the lab\'s other metadata and its own backgrounds', () => {
    const t0 = { ...BASE, metadata: JSON.stringify({ options: { specimenLine: true }, headerLayout: { v: 1, items: {}, backgrounds: [{ id: 'mine', url: '/uploads/t/w.png', area: 'page', fit: 'cover', opacity: 0.1, pages: 'all' }] } }) } as ReportTemplate;
    const t = apply(t0, applyLetterheadPreset(t0, 'preprinted', { scanUrl: SCAN }));
    expect(JSON.parse(t.metadata!).options).toEqual({ specimenLine: true });
    expect(readHeaderLayout(t)!.backgrounds!.map(b => b.id)).toEqual(['mine', LH_SCAN_ID]);
  });

  it('the continuation choice is its own key', () => {
    const t = apply(BASE, setLetterheadContinuation(BASE, 'slim'));
    expect(readReportStyle(t).letterhead).toEqual({ preset: 'digital', continuation: 'slim' });
    expect(JSON.parse(apply(t, setLetterheadContinuation(t, 'none')).metadata!)).toEqual({});
  });
});

describe('what pages 2+ carry', () => {
  const top = 28;
  const bg = (o: Partial<{ area: 'page' | 'header' | 'footer'; hidden: boolean; loaded: boolean; pages: 'first' | 'all'; box: { x: number; y: number; w: number; h: number } }> = {}) =>
    ({ area: 'header' as const, hidden: false, loaded: true, pages: 'all' as const, box: { x: 0, y: 0, w: 595, h: 110 }, ...o });
  const plan = (mode: 'none' | 'slim' | 'full', o: Partial<{ letterpad: boolean; clearance: number; headerBottom: number }> = {}) =>
    planContinuationHeader({ mode, letterpad: false, clearance: 0, top, headerBottom: 120, bodyGap: 6, ...o });

  it('an untouched template (Digital, none) reserves nothing', () => {
    expect(plan('none')).toEqual({ kind: 'none', h: 0 });
    expect(continuationClearance('digital', [bg()], 45)).toBe(0);
  });
  it('slim reserves a fixed line; full reserves the whole letterhead', () => {
    expect(plan('slim')).toEqual({ kind: 'slim', h: SLIM_LETTERHEAD_H });
    expect(plan('full')).toEqual({ kind: 'full', h: 88 });
  });
  it('pre-printed paper (the blank letterpad print) never draws a letterhead - the paper has it', () => {
    expect(plan('slim', { letterpad: true })).toEqual({ kind: 'none', h: 0 });
    expect(plan('full', { letterpad: true, clearance: 130 })).toEqual({ kind: 'none', h: 0 });
  });
  it('artwork that repeats on every page is cleared, and wins over slim / full', () => {
    expect(continuationClearance('image', [bg()], 45)).toBe(110);
    expect(plan('slim', { clearance: 110 })).toEqual({ kind: 'clear', h: 82 });
    expect(continuationClearance('preprinted', [bg({ area: 'page', box: { x: 0, y: 0, w: 595, h: 842 } })], 42)).toBeCloseTo(42 * MM, 6);
  });
  it('artwork on the first page only, hidden or not yet loaded is not cleared', () => {
    expect(continuationClearance('image', [bg({ pages: 'first' })], 45)).toBe(0);
    expect(continuationClearance('image', [bg({ hidden: true })], 45)).toBe(0);
    expect(continuationClearance('image', [bg({ loaded: false })], 45)).toBe(0);
    expect(continuationClearance('image', [bg({ area: 'footer' })], 45)).toBe(0);
  });
});
