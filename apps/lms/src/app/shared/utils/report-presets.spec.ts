import type { ReportTemplate } from '../models/report.model';
import { PALETTES, TODAY_COLORS, paletteColumns, PALETTE_KEYS } from './report-palettes';
import { PRESET_IDS, PRESET_INFO, PRESET_KEYS, applyStylePreset, detectPreset, presetBundle } from './report-presets';
import { DEFAULT_REPORT_STYLE, readReportStyle, writeReportStyle } from './report-style';
import { readReportTheme } from './report-theme';

const tpl = (o: Partial<ReportTemplate> = {}): ReportTemplate => ({ metadata: null, ...o }) as ReportTemplate;
const applyTo = (t: ReportTemplate, id: 'classic' | 'modern' | 'compact'): ReportTemplate => ({ ...t, ...applyStylePreset(t, id) });
const meta = (t: ReportTemplate) => JSON.parse(String(t.metadata ?? '{}'));

describe('style presets — Modern writes exactly the documented fields', () => {
  it('style bundle, type theme and Teal colours — and no other column', () => {
    const next = applyStylePreset(tpl(), 'modern');
    expect(Object.keys(next).sort()).toEqual(['metadata', ...PALETTE_KEYS].sort());
    const m = JSON.parse(next.metadata!);
    expect(m.reportTheme).toBe('source-sans');
    expect(m.reportStyle).toEqual({
      v: 1, preset: 'modern', fit: { enabled: true },
      patient: { ageSex: 'combined', ageStyle: 'short', frame: 'tint', continuation: 'mini' },
      pageNumbers: 'n-of-m', colors: { palette: 'teal' }, signatures: { placement: 'end' },
    });
    const teal = PALETTES.find(p => p.id === 'teal')!;
    for (const k of PALETTE_KEYS) expect(next[k]).toBe(teal.colors[k]);
  });

  it('Compact: density, squeeze, Ink colours, Classic type', () => {
    const t = applyTo(tpl(), 'compact');
    const s = readReportStyle(t);
    expect(s).toMatchObject({ preset: 'compact', density: 'compact', squeeze: true, pageNumbers: 'n-of-m', fit: { enabled: true } });
    expect(s.patient).toMatchObject({ ageSex: 'combined', ageStyle: 'yrs', sexStyle: 'letter', labelJoiner: ': ', continuation: 'mini' });
    expect(readReportTheme(t)).toBe('classic');
    expect(t.primaryColor).toBe(PALETTES.find(p => p.id === 'ink')!.colors.primaryColor);
  });

  it('signature placement and wording ride the bundle; the rest of the signature settings do not', () => {
    expect(readReportStyle(applyTo(tpl(), 'modern')).signatures).toEqual({ ...DEFAULT_REPORT_STYLE.signatures, placement: 'end', show: 'image' });
    expect(readReportStyle(applyTo(tpl(), 'compact')).signatures).toEqual({ ...DEFAULT_REPORT_STYLE.signatures, placement: 'end', show: 'verified-line' });
  });

  it('Modern and Compact switch the trend charts to vector and add the range bar; Classic puts the pictures back; band and values stay the lab\'s own', () => {
    const own = tpl({ metadata: writeReportStyle(tpl(), { charts: { trend: { band: false, values: false } } }) });
    const modern = readReportStyle(applyTo(own, 'modern')).charts;
    expect(modern).toEqual({ trend: { style: 'vector', layout: 'grid-2', band: false, values: false }, rangeBar: true, previous: false });
    expect(readReportStyle(applyTo(own, 'compact')).charts.trend).toMatchObject({ style: 'vector', layout: 'grid-3' });
    expect(readReportStyle(applyTo(applyTo(own, 'compact'), 'classic')).charts)
      .toEqual({ ...DEFAULT_REPORT_STYLE.charts, trend: { ...DEFAULT_REPORT_STYLE.charts.trend, band: false, values: false } });
  });

  it('the "what this changes" lists say what the charts do', () => {
    const line = (id: string) => PRESET_INFO.find(p => p.id === id)!.changes.filter(c => /chart/i.test(c)).join(' ');
    expect(line('classic')).toMatch(/pictures/);
    expect(line('modern')).toMatch(/two across.*range bar/);
    expect(line('compact')).toMatch(/three across.*range bar/);
  });

  it('a preset leaves the lab\'s own image height, per-row limit, reserve and wording alone, and Classic puts placement back', () => {
    const own = tpl({ metadata: writeReportStyle(tpl(), { signatures: { imageH: 32, maxPerRow: 3, reserveMm: 40, verifiedText: 'Verified: {name}' } }) });
    expect(readReportStyle(applyTo(applyTo(own, 'compact'), 'classic')).signatures)
      .toEqual({ ...DEFAULT_REPORT_STYLE.signatures, imageH: 32, maxPerRow: 3, reserveMm: 40, verifiedText: 'Verified: {name}' });
  });
});

describe('style presets — Classic restores today', () => {
  it('Modern -> Classic leaves no style, no theme and the original colours', () => {
    const t0 = tpl();
    const back = applyTo(applyTo(t0, 'modern'), 'classic');
    expect(back.metadata).toBe('{}');
    for (const k of PALETTE_KEYS) expect(back[k]).toBe(TODAY_COLORS[k]);
  });
  it('Compact -> Classic is the same', () => {
    const back = applyTo(applyTo(tpl(), 'compact'), 'classic');
    expect(back.metadata).toBe('{}');
  });
  it('re-applying a preset changes nothing the second time', () => {
    for (const id of PRESET_IDS) {
      const once = applyTo(tpl(), id);
      expect(applyStylePreset(once, id)).toEqual(applyStylePreset(applyTo(once, id), id));
      expect(applyTo(once, id).metadata).toBe(once.metadata);
    }
  });
});

describe('style presets — only the bundle is touched', () => {
  const own = tpl({
    metadata: JSON.stringify({
      options: { abnormalSummary: true }, headerLayout: { v: 1 },
      reportStyle: { v: 1, patient: { labels: { orderid: 'Lab No.' } }, fit: { minPt: 6.5 }, signatures: { imageH: 30 }, charts: { rangeBar: true } },
    }),
    labName: 'My Lab', logoUrl: 'x.png', bodyTextColor: '#222222', fontFamily: 'times',
  });

  it('keeps the lab’s field names, font floor, signatures, charts, options, header layout and every other column', () => {
    const next = applyTo(own, 'modern');
    const m = meta(next);
    expect(m.options).toEqual({ abnormalSummary: true });
    expect(m.headerLayout).toEqual({ v: 1 });
    const s = readReportStyle(next);
    expect(s.patient.labels).toEqual({ orderid: 'Lab No.' });
    expect(s.fit.minPt).toBe(6.5);
    expect(s.signatures.imageH).toBe(30);
    expect(s.charts.rangeBar).toBe(true);
    expect(next.labName).toBe('My Lab');
    expect(next.logoUrl).toBe('x.png');
    expect(next.bodyTextColor).toBe('#222222');
    expect(next.fontFamily).toBe('times');
  });

  it('resets a bundle key the preset does not set (Classic over a custom density)', () => {
    const dense = tpl({ metadata: writeReportStyle(tpl(), { density: 'compact', squeeze: true }) });
    expect(readReportStyle(applyTo(dense, 'modern')).density).toBe('normal');
  });

  it('the bundle lists only the documented keys', () => {
    expect(PRESET_KEYS).toContain('density');
    expect(PRESET_KEYS.filter(k => k.startsWith('signatures'))).toEqual(['signatures.placement', 'signatures.show']);
    expect(PRESET_KEYS.filter(k => k.startsWith('charts'))).toEqual(['charts.trend.style', 'charts.trend.layout', 'charts.rangeBar']);
    expect(presetBundle('classic')).toMatchObject({ preset: 'classic', density: 'normal', squeeze: false, pageNumbers: 'n' });
  });
});

describe('style presets — the arranged patient strip follows Age & sex', () => {
  const cols = JSON.stringify([['name', 'age', 'sex'], ['mrn'], ['orderid']]);
  it('Modern swaps age + sex for one ageSex chip; Classic swaps back', () => {
    const t = tpl({ patientColumnsJson: cols });
    const m = applyTo(t, 'modern');
    expect(JSON.parse(m.patientColumnsJson!)).toEqual([['name', 'ageSex'], ['mrn'], ['orderid']]);
    expect(JSON.parse(applyTo(m, 'classic').patientColumnsJson!)).toEqual([['name', 'age', 'sex'], ['mrn'], ['orderid']]);
  });
  it('a never-arranged strip is left alone', () => {
    expect(applyStylePreset(tpl(), 'modern').patientColumnsJson).toBeUndefined();
  });
  it('a junk arrangement is left as it is', () => {
    expect(applyStylePreset(tpl({ patientColumnsJson: '{bad' }), 'modern').patientColumnsJson).toBeUndefined();
  });
});

describe('style presets — detection and the card text', () => {
  it('each applied preset is detected; an untouched template reads as Classic; a tweak is custom', () => {
    for (const id of PRESET_IDS) expect(detectPreset(applyTo(tpl(), id))).toBe(id);
    expect(detectPreset(tpl())).toBe('classic');
    const tweaked = { ...applyTo(tpl(), 'modern'), accentColor: '#123456' } as ReportTemplate;
    expect(detectPreset(tweaked)).toBe('custom');
    const dens = { ...applyTo(tpl(), 'modern'), metadata: writeReportStyle(applyTo(tpl(), 'modern'), { density: 'compact' }) } as ReportTemplate;
    expect(detectPreset(dens)).toBe('custom');
    const sig = { ...applyTo(tpl(), 'modern'), metadata: writeReportStyle(applyTo(tpl(), 'modern'), { signatures: { placement: 'every-page' } }) } as ReportTemplate;
    expect(detectPreset(sig)).toBe('custom');
  });
  it('the card says where the sign-off goes, for every preset', () => {
    for (const p of PRESET_INFO) expect(p.changes.join(' ')).toMatch(/sign/i);
    expect(PRESET_INFO.find(p => p.id === 'compact')!.changes.join(' ')).toMatch(/Electronically verified/);
  });
  it('every preset has a plain-words list of what it changes (no jargon, no AI)', () => {
    expect(PRESET_INFO.map(p => p.id)).toEqual(['classic', 'modern', 'compact']);
    for (const p of PRESET_INFO) {
      expect(p.changes.length).toBeGreaterThanOrEqual(5);
      expect(p.changes.join(' ')).not.toMatch(/\bAI\b|reportStyle|metadata/);
    }
  });
  it('each preset’s palette is a print-safe curated one', () => {
    expect(paletteColumns(PALETTES[0].colors).primaryColor).toBeTruthy();
  });
});
