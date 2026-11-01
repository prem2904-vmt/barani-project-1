import { DEFAULT_REPORT_STYLE, readReportStyle, validateReportStyle, writeReportStyle, type ReportStyle } from './report-style';
import { ageSexText, ageText, gridLabel, miniStripText, pageOfText, patientLabel, reportStatusText, sexText, swapAgeSexColumns } from './report-patient-text';

const P = DEFAULT_REPORT_STYLE.patient;
const style = (patch: Partial<ReportStyle['patient']>): ReportStyle['patient'] => ({ ...P, ...patch });
const pat = { age: 45, sex: 'Male', displayName: 'Ravi Kumar', mrn: 'CHN-2609-004217-3' };

describe('report patient wording (phase 2)', () => {
  it('the default style changes nothing: labels return the literal, age keeps the layout wording', () => {
    expect(patientLabel(P, 'age', 'Age : ')).toBe('Age : ');
    expect(patientLabel(P, 'refdoctor', 'Ref. By: ')).toBe('Ref. By: ');
    expect(patientLabel(P, 'phone', 'Phone: ')).toBe('Phone: ');
    expect(gridLabel(P, 'ageSex', 'AGE / SEX')).toBe('AGE / SEX');
    expect(ageText(pat, P, 'Years')).toBe('45 Years');
    expect(ageText(pat, P, 'yrs')).toBe('45 yrs');
    expect(sexText('Female', 'word')).toBe('Female');
    expect(ageSexText(pat, P, 'yrs')).toBe('45 yrs / Male');
  });

  it('combined age and sex: "45 Y / Male", "45 yrs / M", "45 Years / Male"', () => {
    expect(ageSexText(pat, style({ ageStyle: 'short' }), 'short')).toBe('45 Y / Male');
    expect(ageSexText(pat, style({ ageStyle: 'yrs', sexStyle: 'letter' }), 'short')).toBe('45 yrs / M');
    expect(ageSexText(pat, style({ ageStyle: 'Years' }), 'short')).toBe('45 Years / Male');
    expect(ageSexText(pat, style({ ageStyle: 'long', joiner: ', ' }), 'short')).toBe('45 years, Male');
    expect(ageSexText(pat, style({ ageStyle: 'Y', joiner: '/' }), 'short')).toBe('45Y/Male');
  });

  it('auto uses the layout wording; an infant is months / days, never "0 Y"', () => {
    expect(ageSexText(pat, P, 'short')).toBe('45 Y / Male');
    expect(ageSexText({ age: 0, ageDisplay: '8 M', sex: 'Female' }, style({ ageStyle: 'short' }), 'short')).toBe('8 M / Female');
  });

  it('only one half present: no stray joiner', () => {
    expect(ageSexText({ age: 45 }, style({ ageStyle: 'short' }), 'short')).toBe('45 Y');
    expect(ageSexText({ sex: 'Male' }, style({ ageStyle: 'short' }), 'short')).toBe('Male');
    expect(ageSexText({}, P, 'short')).toBe('');
  });

  it('label overrides and joiner', () => {
    const s = style({ labels: { orderid: 'Lab No.', mrn: 'UHID' }, labelJoiner: ': ' });
    expect(patientLabel(s, 'orderid', 'Order : ')).toBe('Lab No.: ');
    expect(patientLabel(s, 'mrn', 'MRN : ')).toBe('UHID: ');
    expect(patientLabel(s, 'age', 'Age : ')).toBe('Age: ');            // joiner applies to every label
    expect(patientLabel(style({ labels: { refdoctor: 'Ref. Dr.' } }), 'refdoctor', 'Ref. By: ')).toBe('Ref. Dr.: '); // own punctuation kept
    expect(patientLabel(style({ labelJoiner: ' - ' }), 'ccf', 'Custom field: ')).toBe('Custom field - ');
    expect(gridLabel(style({ labels: { ageSex: 'age/sex' } }), 'ageSex', 'AGE / SEX')).toBe('AGE/SEX');
  });

  it('report status, page text and the mini strip line', () => {
    expect(reportStatusText(false)).toBe('Final');
    expect(reportStatusText(true)).toBe('Preliminary');
    expect(pageOfText(2, 3)).toBe('Page 2 of 3');
    expect(miniStripText(pat, 'LAB-2609-000142', style({ ageStyle: 'short' })))
      .toBe('Ravi Kumar  ·  45 Y / Male  ·  MRN CHN-2609-004217-3  ·  Order LAB-2609-000142');
    expect(miniStripText({ displayName: 'A' }, null, P)).toBe('A');
  });

  describe('columns JSON: age + sex <-> ageSex, both ways', () => {
    const sep = [['name', 'age', 'sex', 'mrn'], ['specimen'], ['barcode']];
    it('combines at the first of them and back', () => {
      const comb = swapAgeSexColumns(sep, true);
      expect(comb).toEqual([['name', 'ageSex', 'mrn'], ['specimen'], ['barcode']]);
      expect(swapAgeSexColumns(comb, false)).toEqual(sep);
    });
    it('age and sex in different columns still become one chip', () => {
      expect(swapAgeSexColumns([['name', 'sex'], ['age', 'mrn']], true)).toEqual([['name', 'ageSex'], ['mrn']]);
    });
    it('only one of them placed: it becomes the combined chip; none placed: untouched; input not mutated', () => {
      expect(swapAgeSexColumns([['name', 'age']], true)).toEqual([['name', 'ageSex']]);
      const none = [['name'], ['mrn']];
      expect(swapAgeSexColumns(none, true)).toEqual(none);
      const before = JSON.stringify(sep);
      swapAgeSexColumns(sep, true);
      expect(JSON.stringify(sep)).toBe(before);
    });
  });

  describe('stored shape', () => {
    it('defaults are dropped: a lab that touches nothing stores nothing', () => {
      expect(writeReportStyle({ metadata: '{}' }, { patient: { ageSex: 'separate', ageStyle: 'auto', frame: 'rules', labels: {}, labelJoiner: 'auto', continuation: 'none' } })).toBe('{}');
    });
    it('round-trips the new choices and rejects junk', () => {
      const meta = writeReportStyle({ metadata: '{}' }, { pageNumbers: 'n-of-m', patient: { ageSex: 'combined', ageStyle: 'short', frame: 'tint', continuation: 'mini', labels: { orderid: 'Lab No.' } } });
      const s = readReportStyle({ metadata: meta });
      expect(s.patient).toMatchObject({ ageSex: 'combined', ageStyle: 'short', frame: 'tint', continuation: 'mini', labels: { orderid: 'Lab No.' } });
      expect(s.pageNumbers).toBe('n-of-m');
      expect(validateReportStyle({ patient: { ageStyle: 'nonsense', frame: 'zigzag' } }).rejected).toEqual(['patient.ageStyle', 'patient.frame']);
    });
  });
});
