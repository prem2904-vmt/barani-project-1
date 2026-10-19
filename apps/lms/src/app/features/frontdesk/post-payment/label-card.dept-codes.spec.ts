import { tubeSpec } from './label-card.component';

/** Department codes follow the test codes (owner 2026-09-26): Haematology
 *  HAE → HEM, Microbiology MICRO → MIC. The label's department-tube fallback
 *  knows the new codes and keeps the old ones for departments not yet renamed. */
const sample = (code: string, name = '') => ({ id: 's', department: { code, name } }) as any;

describe('Label card — department tube fallback by code', () => {
  it('HEM prints the same lavender tube as HAEM / HAE', () => {
    for (const c of ['HEM', 'HAE', 'HAEM']) expect(tubeSpec(sample(c))).toEqual({ label: 'Lavender', color: 'lavender', volume: '3 mL' });
  });

  it('MIC prints the same red tube as MICRO', () => {
    for (const c of ['MIC', 'MICRO', 'mic']) expect(tubeSpec(sample(c))).toEqual({ label: 'Red', color: 'red', volume: '5 mL' });
  });

  it('an unknown code still falls to grey', () => {
    expect(tubeSpec(sample('ZZZ')).color).toBe('grey');
  });
});
