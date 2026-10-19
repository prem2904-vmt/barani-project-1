import {
  LABEL_SIZE_PRESETS, MIN_X_MM, QUIET_MODULES, TubeLabelGeometry, code128Modules, fitLabelText, labelPageCss, tubeLabelGeometry,
} from './label-layout';
import { labelTextLines } from './label-render';

const within = (g: TubeLabelGeometry) => {
  for (const b of [g.text, g.code]) {
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.x + b.w).toBeLessThanOrEqual(g.widthMm + 1e-6);
    expect(b.y + b.h).toBeLessThanOrEqual(g.heightMm + 1e-6);
  }
};

describe('Tube label layout — landscape, code BESIDE the text', () => {
  const sizes = [[50, 25], [38, 25], [50.8, 25.4], [50, 20]] as const;

  for (const [w, h] of sizes) {
    for (const mode of ['barcode', 'qr', 'datamatrix'] as const) {
      it(`${w}×${h} mm ${mode}: text left, code right, side by side, on the label`, () => {
        const g = tubeLabelGeometry(w, h, mode, code128Modules('26220'));
        within(g);
        // Horizontal, not stacked: the code starts right of the text column…
        expect(g.code.x).toBeGreaterThanOrEqual(g.text.x + g.text.w);
        // …and the two share the same vertical band.
        expect(g.code.y).toBeLessThan(g.text.y + g.text.h);
        expect(g.text.y).toBeLessThan(g.code.y + g.code.h);
        expect(g.text.w).toBeGreaterThan(8);
      });
    }
  }

  it('a 2-D code is a square no taller than the label', () => {
    const g = tubeLabelGeometry(50, 25, 'qr');
    expect(g.code.w).toBe(g.code.h);
    expect(g.code.h).toBeLessThanOrEqual(25 - 2 * g.padMm);
  });

  it('a 1-D barcode keeps its 10-module quiet zones and full inner height', () => {
    const g = tubeLabelGeometry(50, 25, 'barcode', code128Modules('012600001'));
    expect(g.bars).toBeDefined();
    const quiet = g.bars!.x - g.code.x;
    expect(quiet).toBeCloseTo(QUIET_MODULES * g.xMm!, 1);
    expect(g.code.x + g.code.w - (g.bars!.x + g.bars!.w)).toBeCloseTo(quiet, 1);
    expect(g.code.h).toBeCloseTo(25 - 2 * g.padMm, 5);
  });

  it('keeps a scanner-readable bar width for real sample numbers on 50×25 and 2×1 in', () => {
    for (const code of ['26220', '012600001']) {
      for (const [w, h] of [[50, 25], [50.8, 25.4]]) {
        const g = tubeLabelGeometry(w, h, 'barcode', code128Modules(code));
        expect(g.xMm!).toBeGreaterThanOrEqual(MIN_X_MM);
        expect(g.scannable).toBe(true);
      }
    }
    // 5-digit sample numbers stay at the 0.25 mm target on 50 mm stock.
    expect(tubeLabelGeometry(50, 25, 'barcode', code128Modules('26220')).xMm).toBeGreaterThanOrEqual(0.249);
  });

  it('flags a bar width that is too thin (so Printing settings can warn)', () => {
    const g = tubeLabelGeometry(38, 25, 'barcode', code128Modules('MIC-2607-00001'));
    expect(g.scannable).toBe(false);
  });

  it('offers the common tube-label stock sizes', () => {
    const s = LABEL_SIZE_PRESETS.map(p => `${p.widthMm}x${p.heightMm}`);
    expect(s).toEqual(expect.arrayContaining(['50x25', '38x25', '50.8x25.4']));
  });

  it('@page is the exact label size with zero margin', () => {
    expect(labelPageCss(50, 25)).toBe('@page { size: 50mm 25mm; margin: 0; }');
    expect(labelPageCss(50.8, 25.4)).toBe('@page { size: 50.8mm 25.4mm; margin: 0; }');
  });

  it('code128Modules measures exactly what JsBarcode encodes', () => {
    expect(code128Modules('26220')).toBe(79);
    expect(code128Modules('')).toBe(0);
  });
});

describe('Tube label text — shrink then wrap, never truncate', () => {
  const data = (name: string) => ({ code: '26220', patientName: name, ageSex: '29M', mrn: 'AA0008', deptCode: 'BIO' });

  it('keeps every field, in order: name, MRN, dept, sample number', () => {
    const t = labelTextLines(data('Mr. Kesavan L')).map(l => l.text);
    expect(t).toEqual(['Mr. Kesavan L  29M', 'MRN AA0008', 'BIO', '26220']);
  });

  for (const [w, h] of [[50, 25], [38, 25]] as const) {
    it(`${w}×${h}: a long name shrinks and wraps but keeps every character`, () => {
      const long = 'Ms. Paravai Munusamy Venkataraghavan Subramaniam';
      const g = tubeLabelGeometry(w, h, 'barcode', code128Modules('012600001'));
      const fitted = fitLabelText(labelTextLines({ ...data(long), code: '012600001' }), g.text.w, g.text.h);
      const name = fitted.find(l => l.role === 'name')!;
      expect(name.text).toBe(`${long}  29M`); // untouched — never cut
      expect(name.fontMm).toBeLessThan(3.0);
      expect(name.lines).toBeGreaterThanOrEqual(2);
      // Breaks between words where it can: the longest word fits the column
      // unless even the minimum size can't hold it (then it wraps, uncut).
      const wordAtMin = name.minMm * 0.56 * 'Venkataraghavan'.length;
      if (wordAtMin <= g.text.w) expect(name.fontMm * 0.56 * 'Venkataraghavan'.length).toBeLessThanOrEqual(g.text.w + 1e-6);
      const tall = fitted.reduce((s, l) => s + l.fontMm * 1.12 * l.lines, 0);
      expect(tall).toBeLessThanOrEqual(g.text.h + 1.5); // stays on the label
    });
  }

  it('a short name stays on ONE line (shrinking at most to 80 %)', () => {
    const g = tubeLabelGeometry(50, 25, 'qr');
    const fitted = fitLabelText(labelTextLines(data('Mr. Kesavan L')), g.text.w, g.text.h);
    const name = fitted.find(l => l.role === 'name')!;
    expect(name.lines).toBe(1);
    expect(name.fontMm).toBeGreaterThanOrEqual(2.4);
    expect(fitted.find(l => l.role === 'id')!.fontMm).toBe(3.4);
  });
});
