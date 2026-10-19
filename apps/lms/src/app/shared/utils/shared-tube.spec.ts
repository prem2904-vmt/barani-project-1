import { isSharedTube, lineDepartment, tubeDepartmentCodes, tubeDepartmentLabel, tubeDepartmentNames } from './shared-tube';

/** Shared tubes (owner 2026-09-27): one tube per tube type per draw, whatever
 *  the department — a tube names every department whose tests ride on it. */
describe('shared-tube', () => {
  const haem = { id: 'h', name: 'Haematology', code: 'HEM' };
  const bio = { id: 'b', name: 'Biochemistry', code: 'BIO' };

  it('names every department on a shared tube, representative first', () => {
    const s = { department: haem as never, departments: [haem, bio] };
    expect(tubeDepartmentNames(s)).toEqual(['Haematology', 'Biochemistry']);
    expect(tubeDepartmentLabel(s)).toBe('Haematology · Biochemistry');
    expect(tubeDepartmentCodes(s)).toBe('HEM/BIO');
    expect(isSharedTube(s)).toBe(true);
  });

  it('falls back to the representative department on older payloads', () => {
    const s = { department: haem as never };
    expect(tubeDepartmentLabel(s)).toBe('Haematology');
    expect(tubeDepartmentCodes(s)).toBe('HEM');
    expect(isSharedTube(s)).toBe(false);
    expect(tubeDepartmentLabel({}, 'Sample')).toBe('Sample');
    expect(tubeDepartmentCodes(null)).toBe('');
  });

  it('a line routes by the server-resolved department, then its test, then its tube', () => {
    const sub = { departmentId: 'h', department: haem as never };
    expect(lineDepartment({ routingDepartment: bio, subOrder: sub } as never)).toEqual({ id: 'b', name: 'Biochemistry' });
    expect(lineDepartment({ test: { departmentId: 'b', department: bio } as never, subOrder: sub } as never))
      .toEqual({ id: 'b', name: 'Biochemistry' });
    expect(lineDepartment({ subOrder: sub } as never)).toEqual({ id: 'h', name: 'Haematology' });
    // An outsourced tube keeps its own (department-at-vendor).
    expect(lineDepartment({ test: { departmentId: 'b', department: bio } as never,
      subOrder: { ...sub, outsourcedVendorId: 'v1' } } as never)).toEqual({ id: 'h', name: 'Haematology' });
  });
});
