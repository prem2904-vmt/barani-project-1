import { DEFAULT_REPORT_STYLE, NEW_TENANT_REPORT_STYLE, STYLE_PRESETS, isDefaultReportStyle, readReportStyle, reportEngineStamp, validateReportStyle, writeReportStyle } from './report-style';

const meta = (o: unknown) => ({ metadata: JSON.stringify(o) });

describe('report style — read / write / validate', () => {
  it('an absent, empty or junk metadata reads as the default', () => {
    for (const m of [null, undefined, '', '{}', 'not json', '[1,2]', JSON.stringify({ reportStyle: 'x' }), JSON.stringify({ reportStyle: [] })]) {
      expect(readReportStyle({ metadata: m as string | null })).toEqual(DEFAULT_REPORT_STYLE);
    }
    expect(readReportStyle(null)).toEqual(DEFAULT_REPORT_STYLE);
  });

  it('defaults are today: fitting off, floor 7 pt, 2 lines, separate age and sex', () => {
    expect(DEFAULT_REPORT_STYLE.fit).toEqual({ enabled: false, minPt: 7, maxLines: 2, autoColumns: false });
    expect(DEFAULT_REPORT_STYLE.patient.ageSex).toBe('separate');
    expect(DEFAULT_REPORT_STYLE.pageNumbers).toBe('n');
    expect(isDefaultReportStyle(DEFAULT_REPORT_STYLE)).toBe(true);
  });

  it('a partial object fills the rest with defaults; junk keys fall back and are reported', () => {
    const { style, rejected } = validateReportStyle({
      fit: { enabled: true, minPt: 99, maxLines: 'two', bogus: 1 }, density: 'huge', patient: { ageSex: 'combined', labels: { orderid: 'Lab No.', bad: 5 } }, extra: true,
    });
    expect(style.fit).toEqual({ enabled: true, minPt: 7, maxLines: 2, autoColumns: false });
    expect(style.density).toBe('normal');
    expect(style.patient.ageSex).toBe('combined');
    expect(style.patient.labels).toEqual({ orderid: 'Lab No.' });
    expect(rejected.sort()).toEqual(['density', 'extra', 'fit.bogus', 'fit.maxLines', 'fit.minPt']);
  });

  it('numbers are range-checked, ints rounded, a nullable stays null', () => {
    const { style } = validateReportStyle({ fit: { maxLines: 3.4 }, signatures: { imageH: 30, reserveMm: null } });
    expect(style.fit.maxLines).toBe(3);
    expect(style.signatures.imageH).toBe(30);
    expect(style.signatures.reserveMm).toBeNull();
    expect(validateReportStyle({ signatures: { imageH: 3 } }).style.signatures.imageH).toBe(24);
  });

  it('write → read round-trips and keeps every other metadata key', () => {
    const before = meta({ reportTheme: 'source-sans', options: { abnormalSummary: true } });
    const out = writeReportStyle(before, { fit: { enabled: true, minPt: 6.5 }, patient: { ageSex: 'combined' } });
    const parsed = JSON.parse(out);
    expect(parsed.reportTheme).toBe('source-sans');
    expect(parsed.options).toEqual({ abnormalSummary: true });
    const style = readReportStyle({ metadata: out });
    expect(style.fit).toMatchObject({ enabled: true, minPt: 6.5, maxLines: 2 });
    expect(style.patient.ageSex).toBe('combined');
  });

  it('writeReportStyle DROPS default-valued keys — an untouched lab stores nothing', () => {
    expect(writeReportStyle({ metadata: null }, { fit: { enabled: false, minPt: 7 } })).toBe('{}');
    const on = writeReportStyle({ metadata: null }, { fit: { enabled: true } });
    expect(JSON.parse(on).reportStyle).toEqual({ v: 1, fit: { enabled: true } });
    // Turning it back off removes the whole key again.
    const off = writeReportStyle({ metadata: on }, { fit: { enabled: false } });
    expect(JSON.parse(off).reportStyle).toBeUndefined();
    expect(writeReportStyle({ metadata: on }, null)).toBe('{}');
  });

  it('a patch merges into what is stored (it does not replace the sibling keys)', () => {
    let m = writeReportStyle({ metadata: null }, { fit: { enabled: true, autoColumns: true } });
    m = writeReportStyle({ metadata: m }, { fit: { minPt: 8 } });
    expect(readReportStyle({ metadata: m }).fit).toEqual({ enabled: true, minPt: 8, maxLines: 2, autoColumns: true });
  });

  it('junk in a patch is ignored, never stored', () => {
    const m = writeReportStyle({ metadata: null }, { fit: { minPt: 500 } as never });
    expect(m).toBe('{}');
  });

  it('labels are replaced whole, not merged', () => {
    let m = writeReportStyle({ metadata: null }, { patient: { labels: { orderid: 'Lab No.', mrn: 'UHID' } } });
    m = writeReportStyle({ metadata: m }, { patient: { labels: { mrn: 'UHID' } } });
    expect(readReportStyle({ metadata: m }).patient.labels).toEqual({ mrn: 'UHID' });
  });

  it('presets and the new-tenant default turn fitting on; Classic is today', () => {
    expect(isDefaultReportStyle(validateReportStyle({ preset: 'classic' }).style)).toBe(true);
    for (const id of ['modern', 'compact'] as const) {
      const m = writeReportStyle({ metadata: null }, STYLE_PRESETS[id]);
      expect(readReportStyle({ metadata: m }).fit.enabled).toBe(true);
      expect(readReportStyle({ metadata: m }).pageNumbers).toBe('n-of-m');
    }
    const t = readReportStyle({ metadata: writeReportStyle({ metadata: null }, NEW_TENANT_REPORT_STYLE) });
    expect(t.fit.enabled).toBe(true);
    expect(t.patient.continuation).toBe('mini');
  });

  it('the engine stamp names the preset', () => {
    expect(reportEngineStamp(readReportStyle({ metadata: writeReportStyle({ metadata: null }, STYLE_PRESETS.modern) }))).toContain('preset modern');
  });
});
