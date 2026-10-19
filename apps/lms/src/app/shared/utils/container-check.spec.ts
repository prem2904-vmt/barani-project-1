import { containerFlag, missingContainerIndex } from './container-check';

describe('container-check', () => {
  it('indexes the server rows by id', () => {
    const m = missingContainerIndex({ count: 2, tests: [
      { id: 'a', name: 'Epithelial Casts', problem: 'blank' },
      { id: 'b', name: 'X', problem: 'unknown' },
    ] });
    expect(m.get('a')).toBe('blank');
    expect(m.get('b')).toBe('unknown');
    expect(missingContainerIndex(null).size).toBe(0);
  });

  it('flags a blank container as an error to fix, naming the pot it falls into', () => {
    const f = containerFlag('blank', 'Urine');
    expect(f?.label).toBe('No container set');
    expect(f?.title).toContain('separate sterile pot of Urine');
  });

  it('flags an unknown key distinctly, and nothing when the test has a container', () => {
    expect(containerFlag('unknown')?.label).toBe('Unknown container');
    expect(containerFlag(undefined)).toBeNull();
  });
});
