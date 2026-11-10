import { pdfFileName } from './final-view.component';

describe('final view', () => {
  it('names the PDF after the patient, the form and the day (safe characters only)', () => {
    expect(pdfFileName('Rajesh Kumar', 'ENT case sheet', '2026-11-01T16:38:00Z')).toBe(
      'Rajesh Kumar - ENT case sheet - 2026-11-01.pdf',
    );
    expect(pdfFileName('A/B: C?', null, null)).toBe('AB C.pdf');
    expect(pdfFileName(null, null, null)).toBe('case-sheet.pdf');
    expect(pdfFileName('ராஜேஷ்', 'ENT', null)).toContain('ENT');
  });
});
