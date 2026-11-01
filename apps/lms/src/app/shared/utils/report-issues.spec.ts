import { reportIssues, stressSnapshot } from './report-issues';
import { silenceJsdomCanvas } from './report-header-legacy.spec-helpers';
import { richInput } from './report-theme.spec-helpers';

describe('report issues (designer chip)', () => {
  silenceJsdomCanvas();

  it('lengthens the names but keeps everything else', () => {
    const s = JSON.parse(stressSnapshot(JSON.stringify({ patient: { displayName: 'Sita', age: 37 }, order: { id: 'o' }, tests: [1] })));
    expect(s.patient.displayName.length).toBeGreaterThan(40);
    expect(s.patient.age).toBe(37);
    expect(s.order.id).toBe('o');
    expect(s.tests).toEqual([1]);
    expect(stressSnapshot('not json')).toBe('not json');
  });

  it('an existing template (fitting off) with arranged columns reports where long names run into other text', () => {
    const cols = { patientColumnsJson: JSON.stringify([['name', 'age', 'sex', 'mrn'], ['specimen', 'refdoctor', 'refhospital'], ['barcode', 'registered']]) };
    const r = reportIssues(richInput(cols));
    expect(r.count).toBeGreaterThan(0);
    expect(r.lines.length).toBeLessThanOrEqual(5);
    expect(r.lines[0]).toContain('runs into');
  });

  it('the same template with text fitting on has none', () => {
    const cols = { patientColumnsJson: JSON.stringify([['name', 'age', 'sex', 'mrn'], ['specimen', 'refdoctor', 'refhospital'], ['barcode', 'registered']]),
                   metadata: JSON.stringify({ options: { abnormalSummary: true }, reportStyle: { v: 1, fit: { enabled: true } } }) };
    expect(reportIssues(richInput(cols)).count).toBe(0);
  });
});
