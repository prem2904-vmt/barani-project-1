import { labelTextLines } from './label-render';

const base = { code: 'OUT-2609-00012', patientName: 'Ms. Paravai Munusamy', ageSex: '44/F', mrn: 'AA0007', deptCode: 'BIO', tube: 'Plain · 4 ml' };

describe('Label text — outsourced', () => {
  it('a normal label has no OUTSOURCED line', () => {
    expect(labelTextLines(base, 1).map(l => l.text)).not.toContain('OUTSOURCED');
  });
  it('an outsourced label is the SAME label with a prominent OUTSOURCED line on top', () => {
    const normal = labelTextLines(base, 1).map(l => l.text);
    const out = labelTextLines({ ...base, outsourced: true }, 1);
    expect(out[0].text).toBe('OUTSOURCED');
    expect(out[0].heavy).toBe(true);
    expect(out.slice(1).map(l => l.text)).toEqual(normal);
    // No partner name on the label.
    expect(out.map(l => l.text).join(' ')).not.toMatch(/Apollo|partner/i);
  });
});
