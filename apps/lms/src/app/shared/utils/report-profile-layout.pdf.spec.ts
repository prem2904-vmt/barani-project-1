import { rowVerdict, type ProfileTableRow, type ProfileTableTheme } from './report-profile-layout.pdf';

/**
 * Abnormal-result styling must match renderColumnarTable's own verdict
 * EXACTLY (owner, 2026-10-02, follow-up review): bold/colour only on the
 * RESULT cell (never the whole row, which is what the plain-table version
 * did), the flag letter (or arrow) per the report theme's flagStyle /
 * flagIndicator — not a hardcoded look.
 *
 * Tests `rowVerdict` directly (the exported decision the drawing code
 * applies only to the result cell) rather than mocking jspdf-autotable —
 * a full autoTable() call needs a REAL jsPDF instance internally (font
 * metrics etc.), which a bare `{}` stand-in doesn't provide, and mocking
 * the module is fragile across vitest's worker-isolation settings (it
 * passed file-by-file locally but broke when `nx test lms` ran every spec
 * in shared workers on the dev PC). The actual PDF-drawing path is already
 * covered end-to-end by report-pdf.one-page-layout.spec.ts.
 */

const THEME: ProfileTableTheme = {
  font: 'helvetica', headFill: '#f1f5f9', headText: '#000', bodyText: '#111', dimText: '#666', hair: '#ccc',
  abnormalColor: '#dc2626', abnormalLowColor: '#2563eb', zebra: false, flagStyle: 'bold_color', flagIndicator: 'letter',
};

function row(partial: Partial<ProfileTableRow>): ProfileTableRow {
  return { cells: {}, ...partial };
}

describe('rowVerdict — abnormal styling matches the continuous table', () => {
  it('a normal (N) row: no colour, no bold, no glyph', () => {
    const v = rowVerdict(row({ flag: 'N' }), THEME);
    expect(v.emphasise).toBe(false);
    expect(v.color).toBeNull();
    expect(v.glyph).toBe('');
  });

  it('no flag at all is treated the same as N', () => {
    const v = rowVerdict(row({ flag: null }), THEME);
    expect(v.emphasise).toBe(false);
    expect(v.color).toBeNull();
    expect(v.glyph).toBe('');
  });

  it('an abnormal HIGH row: bold + the theme\'s high colour + "H" glyph', () => {
    const v = rowVerdict(row({ flag: 'H' }), THEME);
    expect(v.emphasise).toBe(true);
    expect(v.color).toBe(THEME.abnormalColor);
    expect(v.glyph).toBe('H');
  });

  it('an abnormal LOW row uses the low colour and the "L" glyph', () => {
    const v = rowVerdict(row({ flag: 'L' }), THEME);
    expect(v.color).toBe(THEME.abnormalLowColor);
    expect(v.glyph).toBe('L');
  });

  it('critical high/low (CH/CL) are treated as high/low', () => {
    expect(rowVerdict(row({ flag: 'CH' }), THEME).color).toBe(THEME.abnormalColor);
    expect(rowVerdict(row({ flag: 'CL' }), THEME).color).toBe(THEME.abnormalLowColor);
  });

  it('flagStyle "bold" (admin never picked bold_color): bold only, never a colour', () => {
    const v = rowVerdict(row({ flag: 'H' }), { ...THEME, flagStyle: 'bold' });
    expect(v.emphasise).toBe(true);
    expect(v.color).toBeNull();
  });

  it('flagIndicator "none": bold/colour still apply, but no glyph', () => {
    const v = rowVerdict(row({ flag: 'H' }), { ...THEME, flagIndicator: 'none' });
    expect(v.emphasise).toBe(true);
    expect(v.color).toBe(THEME.abnormalColor);
    expect(v.glyph).toBe('');
  });

  it('flagIndicator "arrow": a triangle glyph, not the H/L letter', () => {
    expect(rowVerdict(row({ flag: 'H' }), { ...THEME, flagIndicator: 'arrow' }).glyph).toBe('▲');
    expect(rowVerdict(row({ flag: 'L' }), { ...THEME, flagIndicator: 'arrow' }).glyph).toBe('▼');
  });

  it('a qualitative "A" flag (non-Normal dropdown pick): bold only — no colour, no glyph', () => {
    const v = rowVerdict(row({ flag: 'A' }), THEME);
    expect(v.emphasise).toBe(true);
    expect(v.color).toBeNull();
    expect(v.glyph).toBe('');
  });

  it('an explicit admin row colour (condition chip) always wins and always bolds, even with no flag', () => {
    const v = rowVerdict(row({ flag: null, color: '#f59e0b' }), THEME);
    expect(v.emphasise).toBe(true);
    expect(v.color).toBe('#f59e0b');
  });

  it('the tech\'s own "print in bold" pick (row.bold) bolds without a flag or colour', () => {
    const v = rowVerdict(row({ flag: null, bold: true }), THEME);
    expect(v.emphasise).toBe(true);
    expect(v.color).toBeNull();
    expect(v.glyph).toBe('');
  });
});
