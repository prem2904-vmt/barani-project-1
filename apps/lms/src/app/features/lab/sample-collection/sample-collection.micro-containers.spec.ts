import { containerFor } from './sample-collection.component';
import { tubeSpec } from '../../frontdesk/post-payment/label-card.component';

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
