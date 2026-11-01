import { layoutSignatureBlock, signatureRowHeight } from './report-signatures';

describe('sign-off geometry with text fitting', () => {
  const sigs = [{ name: 'A', title: 'T', regNo: 'R1' }, { name: 'B', title: 'T', regNo: 'R2' }];

  it('without an extra callback the geometry is exactly today\'s', () => {
    const b = layoutSignatureBlock(sigs, 30, 535, 100);
    expect(b.height).toBe(signatureRowHeight(sigs));
    expect(b.rows[0].extra).toEqual({ name: 0, title: 0, reg: 0 });
  });

  it('a wrapped name makes the row (and the block) taller by the tallest signatory\'s extra', () => {
    const base = layoutSignatureBlock(sigs, 30, 535, 100).height;
    const b = layoutSignatureBlock(sigs, 30, 535, 100, s => (s.name === 'B' ? { name: 10, title: 0, reg: 4 } : { name: 0, title: 0, reg: 0 }));
    expect(b.rows[0].extra).toEqual({ name: 10, title: 0, reg: 4 });
    expect(b.height).toBe(base + 14);
  });

  it('each row takes its own extra (7 signatories → two rows)', () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({ name: `N${i}`, title: 'T', regNo: 'R' }));
    const b = layoutSignatureBlock(seven, 30, 535, 0, s => ({ name: s.name === 'N5' ? 9 : 0, title: 0, reg: 0 }));
    expect(b.rows).toHaveLength(2);
    expect(b.rows[0].extra.name).toBe(0);
    expect(b.rows[1].extra.name).toBe(9);
  });
});
