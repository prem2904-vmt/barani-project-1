import { isOutsourcedLine, outsourcedChip, splitOutsourced } from './outsourced-lines';

const T = (id: string, vendor?: string) => ({ id, subOrderId: 's', testId: id, name: id, status: 'pending', test: { outsourcedVendorId: vendor ?? null } }) as any;

describe('Result entry — outsourced lines are read-only', () => {
  it('splits outsourced tests (test flag) away from the editable ones', () => {
    const { inHouse, outsourced } = splitOutsourced([T('a'), T('b', 'lab-1')], null);
    expect(inHouse.map(t => t.id)).toEqual(['a']);
    expect(outsourced.map(t => t.id)).toEqual(['b']);
  });
  it('an outsourced TUBE makes every line read-only', () => {
    expect(isOutsourcedLine(T('a'), 'lab-1')).toBe(true);
    expect(splitOutsourced([T('a'), T('b')], 'lab-1').inHouse).toEqual([]);
  });
  it('chip names the partner when known', () => {
    expect(outsourcedChip(T('b', 'lab-1'), { 'lab-1': 'Apollo Diagnostics' })).toBe('Outsourced · Apollo Diagnostics');
    expect(outsourcedChip(T('b', 'lab-2'), {})).toBe('Outsourced');
    expect(outsourcedChip(T('a'), { 'lab-1': 'Apollo' }, 'lab-1')).toBe('Outsourced · Apollo');
  });
});
