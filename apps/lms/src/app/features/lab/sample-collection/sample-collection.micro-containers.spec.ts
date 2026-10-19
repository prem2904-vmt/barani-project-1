import { containerFor } from './sample-collection.component';
import { labelSpecimen, labelTubeLine, tubeSpec } from '../../frontdesk/post-payment/label-card.component';

/** Microbiology containers (owner 2026-09-27): every micro test is collected
 *  into a Sterile container, and blood cultures into a Blood culture bottle —
 *  drawn as a BOTTLE that fills with blood like the vacutainer, while every
 *  blood tube keeps its vacutainer + blood-fill drawing. */
const sample = (tubeColor: string | null, sampleType = '', code = 'MIC') =>
  ({ id: 's', tubeColor, department: { code }, tests: [{ test: { name: 'X', sampleType } }] }) as any;

describe('Sample collection — microbiology containers', () => {
  it('a blood culture bottle renders as a bottle with the blood fill', () => {
    const c = containerFor(sample('blood_culture', 'Blood'));
    expect(c.kind).toBe('bottle');
    expect(c.label).toBe('Blood culture bottle');
    expect(c.fill).toBe('#b91c1c');
  });

  it('a sterile container stays a jar named by its specimen', () => {
    const c = containerFor(sample('sterile', 'urine'));
    expect(c.kind).toBe('jar');
    expect(c.label).toBe('Sterile · Urine');
  });

  it('blood tubes keep the vacutainer drawing', () => {
    for (const k of ['edta', 'sst', 'plain', 'citrate', 'fluoride', 'heparin']) {
      expect(containerFor(sample(k, 'Serum', 'BIO')).kind).toBe('vacutainer');
    }
  });

  it('the printed label names the bottle', () => {
    expect(tubeSpec(sample('blood_culture')).label).toBe('BC bottle');
    expect(tubeSpec(sample('sterile')).label).toBe('Sterile');
  });
});

/** The specimen CHOSEN at the desk (owner 2026-09-27): tubes group by it, so
 *  the pot, the drawing and the printed label name it. */
describe('Sample collection — the chosen specimen', () => {
  const chosen = (tubeColor: string | null, specimen: string | null, sampleType = 'As applicable') =>
    ({ id: 's', tubeColor, department: { code: 'MIC' }, tests: [{ specimen, test: { name: 'Gram', sampleType } }] }) as any;

  it('a sterile pot is named by the chosen specimen, not the Test Master text', () => {
    expect(containerFor(chosen('sterile', 'Urine')).label).toBe('Sterile · Urine');
    expect(containerFor(chosen('sterile', null, 'pus')).label).toBe('Sterile · Pus');
  });

  it('a blood culture bottle names the chosen specimen', () => {
    expect(containerFor(chosen('blood_culture', 'Blood')).label).toBe('Blood culture bottle · Blood');
  });

  it('a container-less micro test is drawn by the chosen specimen', () => {
    expect(containerFor(chosen(null, 'Urine')).kind).toBe('urine_cup');
  });

  it('the printed label line names the chosen specimen on pots, never on blood tubes', () => {
    expect(labelTubeLine(chosen('sterile', 'Urine'))).toBe('Sterile · Urine');
    expect(labelSpecimen(chosen('sterile', 'Urine'))).toBe('Urine');
    expect(labelSpecimen(chosen('edta', 'Bone marrow'))).toBeNull();
    expect(labelTubeLine(chosen('edta', 'Bone marrow'))).toBe(`${tubeSpec(chosen('edta', null)).label} · ${tubeSpec(chosen('edta', null)).volume}`);
    expect(labelSpecimen(chosen('sterile', null))).toBeNull();
  });
});
