import { logicalTestCount, sortTestsForDisplay } from './order.model';

describe('logicalTestCount', () => {
  it('returns 0 for null/undefined/empty tests', () => {
    expect(logicalTestCount(null)).toBe(0);
    expect(logicalTestCount(undefined)).toBe(0);
    expect(logicalTestCount([])).toBe(0);
  });

  it('counts a single standalone test', () => {
    expect(logicalTestCount([{ packageTestId: undefined, profileTestId: undefined }])).toBe(1);
  });

  it('counts multiple standalone tests individually', () => {
    const tests = [
      { packageTestId: undefined, profileTestId: undefined },
      { packageTestId: undefined, profileTestId: undefined },
      { packageTestId: undefined, profileTestId: undefined },
    ];
    expect(logicalTestCount(tests)).toBe(3);
  });

  it('counts a profile once regardless of how many tests share it', () => {
    const tests = [
      { packageTestId: undefined, profileTestId: 'PROF-001' },
      { packageTestId: undefined, profileTestId: 'PROF-001' },
      { packageTestId: undefined, profileTestId: 'PROF-001' },
    ];
    expect(logicalTestCount(tests)).toBe(1);
  });

  it('counts multiple profiles separately', () => {
    const tests = [
      { packageTestId: undefined, profileTestId: 'PROF-001' },
      { packageTestId: undefined, profileTestId: 'PROF-002' },
      { packageTestId: undefined, profileTestId: 'PROF-003' },
    ];
    expect(logicalTestCount(tests)).toBe(3);
  });

  it('counts package (type=package) as a single test', () => {
    const tests = [{ packageTestId: 'PKG-001', packageType: 'package' }];
    expect(logicalTestCount(tests)).toBe(1);
  });

  it('counts multiple packages (type=package) individually', () => {
    const tests = [
      { packageTestId: 'PKG-001', packageType: 'package' },
      { packageTestId: 'PKG-002', packageType: 'package' },
    ];
    expect(logicalTestCount(tests)).toBe(2);
  });

  it('counts packageTestId (non-package type) once per unique id', () => {
    const tests = [
      { packageTestId: 'PKG-001', packageType: 'bundle' },
      { packageTestId: 'PKG-001', packageType: 'bundle' },
      { packageTestId: 'PKG-002', packageType: 'bundle' },
    ];
    expect(logicalTestCount(tests)).toBe(2);
  });

  it('prioritizes profileTestId over packageTestId', () => {
    const tests = [
      { packageTestId: 'PKG-001', profileTestId: 'PROF-001', packageType: 'bundle' },
    ];
    expect(logicalTestCount(tests)).toBe(1);
  });

  it('counts profileTestId once even if packageTestId is also present', () => {
    const tests = [
      { packageTestId: 'PKG-001', profileTestId: 'PROF-001', packageType: 'bundle' },
      { packageTestId: 'PKG-001', profileTestId: 'PROF-001', packageType: 'bundle' },
    ];
    expect(logicalTestCount(tests)).toBe(1);
  });

  it('handles mixed profiles, packages, and standalone tests', () => {
    const tests = [
      { profileTestId: 'PROF-001' },                            // profile 1
      { profileTestId: 'PROF-001' },                            // same profile
      { profileTestId: 'PROF-002' },                            // profile 2
      { packageTestId: 'PKG-001', packageType: 'bundle' },      // package (not type=package)
      { packageTestId: 'PKG-001', packageType: 'bundle' },      // same package
      { packageTestId: 'PKG-002', packageType: 'package' },     // type=package, counts as single
      { packageTestId: 'PKG-003', packageType: 'package' },     // another type=package
      { packageTestId: undefined, profileTestId: undefined },   // standalone
      { packageTestId: undefined, profileTestId: undefined },   // standalone
    ];
    // PROF-001, PROF-002 (2 profiles) + PKG-001 (1 unique package) + 2 singles (2) + PKG-002, PKG-003 (2 type=package singles) = 2 + 1 + 2 + 2 = 7
    expect(logicalTestCount(tests)).toBe(7);
  });

  it('handles null values in packageTestId and profileTestId', () => {
    const tests = [
      { packageTestId: null, profileTestId: null },
      { packageTestId: undefined, profileTestId: undefined },
    ];
    expect(logicalTestCount(tests)).toBe(2);
  });

  it('correctly handles packageType=null', () => {
    const tests = [
      { packageTestId: 'PKG-001', packageType: null },
      { packageTestId: 'PKG-001', packageType: null },
    ];
    // packageType is null (not 'package'), so adds to set
    expect(logicalTestCount(tests)).toBe(1);
  });
});

describe('sortTestsForDisplay', () => {
  it('returns empty array for empty input', () => {
    expect(sortTestsForDisplay([])).toEqual([]);
  });

  it('returns single test unchanged', () => {
    const tests = [{ name: 'Test A', position: 1 }];
    expect(sortTestsForDisplay(tests)).toEqual(tests);
  });

  it('does not mutate the original array', () => {
    const tests = [
      { name: 'Test C', position: 3 },
      { name: 'Test A', position: 1 },
      { name: 'Test B', position: 2 },
    ];
    const result = sortTestsForDisplay(tests);
    expect(tests).toEqual([
      { name: 'Test C', position: 3 },
      { name: 'Test A', position: 1 },
      { name: 'Test B', position: 2 },
    ]);
    expect(result).not.toBe(tests);
  });

  it('sorts tests by position ascending', () => {
    const tests = [
      { name: 'Test C', position: 3 },
      { name: 'Test A', position: 1 },
      { name: 'Test B', position: 2 },
    ];
    const result = sortTestsForDisplay(tests);
    expect(result).toEqual([
      { name: 'Test A', position: 1 },
      { name: 'Test B', position: 2 },
      { name: 'Test C', position: 3 },
    ]);
  });

  it('sorts by name when positions are equal', () => {
    const tests = [
      { name: 'Zebra', position: 1 },
      { name: 'Apple', position: 1 },
      { name: 'Banana', position: 1 },
    ];
    const result = sortTestsForDisplay(tests);
    expect(result).toEqual([
      { name: 'Apple', position: 1 },
      { name: 'Banana', position: 1 },
      { name: 'Zebra', position: 1 },
    ]);
  });

  it('treats missing position as 0', () => {
    const tests = [
      { name: 'Test B', position: 2 },
      { name: 'Test A' },  // position undefined
      { name: 'Test C' },  // position undefined
    ];
    const result = sortTestsForDisplay(tests);
    expect(result[0].position).toBeUndefined();
    expect(result[1].position).toBeUndefined();
    expect(result[2].position).toBe(2);
  });

  it('sorts by name when both have position 0 (or undefined)', () => {
    const tests = [
      { name: 'Zebra' },
      { name: 'Apple' },
      { name: 'Banana' },
    ];
    const result = sortTestsForDisplay(tests);
    expect(result.map(t => t.name)).toEqual(['Apple', 'Banana', 'Zebra']);
  });

  it('handles missing name (treats as empty string)', () => {
    const tests = [
      { position: 1 },
      { name: 'Banana', position: 1 },
      { name: 'Apple', position: 1 },
    ];
    const result = sortTestsForDisplay(tests);
    // empty string comes first in localeCompare
    expect(result[0]).toEqual({ position: 1 });
    expect(result[1].name).toBe('Apple');
    expect(result[2].name).toBe('Banana');
  });

  it('handles both position and name as optional, mixed', () => {
    const tests = [
      { name: 'Test B', position: 2 },
      { position: 1 },
      { name: 'Test A' },
      { name: 'Test Z', position: 1 },
    ];
    const result = sortTestsForDisplay(tests);
    expect(result).toEqual([
      { name: 'Test A' },
      { position: 1 },
      { name: 'Test Z', position: 1 },
      { name: 'Test B', position: 2 },
    ]);
  });

  it('maintains stable sort for equivalent items (consistent order)', () => {
    const tests = [
      { name: 'A', position: 1 },
      { name: 'B', position: 1 },
      { name: 'C', position: 1 },
    ];
    const result = sortTestsForDisplay(tests);
    expect(result.map(t => t.name)).toEqual(['A', 'B', 'C']);
  });

  it('handles large position numbers', () => {
    const tests = [
      { name: 'Test', position: 1000 },
      { name: 'Test', position: 1 },
      { name: 'Test', position: 500 },
    ];
    const result = sortTestsForDisplay(tests);
    expect(result.map(t => t.position)).toEqual([1, 500, 1000]);
  });

  it('handles negative position numbers', () => {
    const tests = [
      { name: 'A', position: -1 },
      { name: 'B', position: 2 },
      { name: 'C', position: 0 },
    ];
    const result = sortTestsForDisplay(tests);
    expect(result.map(t => t.position)).toEqual([-1, 0, 2]);
  });
});
