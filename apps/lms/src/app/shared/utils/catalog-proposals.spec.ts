import {
  pendingProposalIds, proposalBranchLabel, proposalKindLabel, proposalPath, proposalTest,
} from './catalog-proposals';

describe('catalog proposals (copy-on-write, per override row)', () => {
  const tests = [
    { id: 'hb-lab', catalogKey: 'HEM012', branchId: null },
    { id: 'hb-b1', catalogKey: 'HEM012', branchId: 'b1' },
    { id: 'na', catalogKey: 'BIO019', pendingProposal: { id: 'p9' } },
  ];

  it('endpoints: per proposal and the bulk actions', () => {
    expect(proposalPath('p1', 'accept')).toBe('/api/catalog-proposals/p1/accept');
    expect(proposalPath('p1', 'dismiss')).toBe('/api/catalog-proposals/p1/dismiss');
    expect(proposalPath(null, 'accept-all')).toBe('/api/catalog-proposals/accept-all');
    expect(proposalPath(null, 'dismiss-all')).toBe('/api/catalog-proposals/dismiss-all');
  });

  it('targetTestId names the copy; else the same key on the same branch', () => {
    expect(proposalTest({ id: 'p', targetTestId: 'hb-b1' }, tests)?.id).toBe('hb-b1');
    expect(proposalTest({ id: 'p', catalogKey: 'hem012', branchId: 'b1' }, tests)?.id).toBe('hb-b1');
    expect(proposalTest({ id: 'p', catalogKey: 'HEM012' }, tests)?.id).toBe('hb-lab');
    expect(proposalTest({ id: 'p', catalogKey: 'NOPE' }, tests)).toBeUndefined();
  });

  it('branch label: All branches for the lab-wide copy, the branch name otherwise', () => {
    const names = new Map([['b1', 'Alwarpet']]);
    expect(proposalBranchLabel({ id: 'p' }, names)).toBe('All branches');
    expect(proposalBranchLabel({ id: 'p', branchId: 'b1' }, names)).toBe('Alwarpet');
    expect(proposalBranchLabel({ id: 'p', branchId: 'bx' }, names)).toBe('One branch');
    expect(proposalKindLabel({ id: 'p', kind: 'update' })).toBe('Master changed');
    expect(proposalKindLabel({ id: 'p', kind: 'new' })).toBe('New master test');
  });

  it('pending ids are distinct across the list and the rows\' markers', () => {
    expect([...pendingProposalIds([{ id: 'p1' }, { id: 'p9' }], tests)].sort()).toEqual(['p1', 'p9']);
  });
});
