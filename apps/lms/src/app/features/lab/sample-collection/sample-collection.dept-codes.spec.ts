import { DEPT_VACUTAINER } from './sample-collection.component';

/** Department codes follow the test codes (owner 2026-09-26): HAE → HEM,
 *  MICRO → MIC. The collection screen's container convention knows the new
 *  codes and keeps the old keys for departments not yet renamed. */
describe('Sample collection — department container convention by code', () => {
  it('HEM is the EDTA lavender tube, like HAEM / HAE', () => {
    expect(DEPT_VACUTAINER['HEM']).toEqual(DEPT_VACUTAINER['HAEM']);
    expect(DEPT_VACUTAINER['HAE']).toEqual(DEPT_VACUTAINER['HAEM']);
    expect(DEPT_VACUTAINER['HEM'].label).toBe('EDTA · Lavender');
  });

  it('MIC is the sterile container, like MICRO', () => {
    expect(DEPT_VACUTAINER['MIC']).toEqual(DEPT_VACUTAINER['MICRO']);
    expect(DEPT_VACUTAINER['MIC'].label).toBe('Sterile container');
  });
});
