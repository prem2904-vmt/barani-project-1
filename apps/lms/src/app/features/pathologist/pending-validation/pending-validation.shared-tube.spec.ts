import { deptOf, departmentsIn, enrich, groupBySample } from './pending-validation.logic';
import { OrderTest } from '../../../shared/models/order.model';

/**
 * Shared tubes (owner 2026-09-27): CBC (Haematology) and HbA1c (Biochemistry)
 * ride ONE EDTA tube. Validation stays per department: each line carries the
 * department it routes to (server `routingDepartment`), and the queue shows one
 * tile per tube PER DEPARTMENT, both carrying the same Sample ID.
 */
const NOW = Date.parse('2026-09-27T10:00:00Z');
const HAEM = { id: 'd-hae', name: 'Haematology', code: 'HEM' };
const BIO = { id: 'd-bio', name: 'Biochemistry', code: 'BIO' };

function line(id: string, test: string, dept: typeof HAEM): OrderTest {
  return {
    id, status: 'entered', subOrderId: 'edta', testId: 't-' + id,
    resultedAt: new Date(NOW - 5 * 60000).toISOString(),
    currentResult: JSON.stringify({ values: {}, flags: { critical: false, notifications: [] } }),
    routingDepartment: dept,
    test: { id: 't-' + id, name: test, tatHours: 4 } as any,
    subOrder: {
      id: 'edta', barcode: '26209', departmentId: HAEM.id, department: HAEM as any,
      receivedAtLab: new Date(NOW - 30 * 60000).toISOString(),
      order: { id: 'o1', patient: { displayName: 'Mr. Arun Kumar', age: 52, sex: 'Male', mrn: 'MW0131' } },
    } as any,
  } as unknown as OrderTest;
}

describe('Pathologist queue — shared tube', () => {
  const rows = [line('l1', 'Haemoglobin', HAEM), line('l2', 'Total Leukocyte Count', HAEM), line('l3', 'Glycated Hemoglobin', BIO)];

  it('labels each line with its own department, not the tube representative', () => {
    expect(deptOf(rows[2])).toEqual({ id: 'd-bio', name: 'Biochemistry' });
    expect(deptOf(rows[0])).toEqual({ id: 'd-hae', name: 'Haematology' });
  });

  it('one tile per department of the shared tube, same Sample ID', () => {
    const tiles = groupBySample(enrich(rows, NOW), 'me');
    expect(tiles.length).toBe(2);
    const bio = tiles.find(t => t.dept === 'Biochemistry')!;
    const haem = tiles.find(t => t.dept === 'Haematology')!;
    expect(bio.sampleLabel).toBe('26209');
    expect(haem.sampleLabel).toBe('26209');
    expect(bio.items.map(i => i.id)).toEqual(['l3']);
    expect(haem.items.map(i => i.id).sort()).toEqual(['l1', 'l2']);
    expect(departmentsIn(tiles).map(d => d.name).sort()).toEqual(['Biochemistry', 'Haematology']);
  });
});
