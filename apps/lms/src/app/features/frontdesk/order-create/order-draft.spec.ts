import { buildOrderDraft, parseOrderDraft, orderDraftKey, parseOrderDraftKey, orderDraftInScope, orderDraftKeysFor, DraftScope } from './order-draft';

const TTL = 7 * 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const patient = { id: 'p1', displayName: 'Asha' } as never;

describe('order draft — the discount survives Save as draft', () => {
  it('round-trips a flat discount', () => {
    const raw = JSON.stringify(buildOrderDraft({ savedAt: NOW, priority: 'Normal', testIds: ['a', 'b'], specimens: { a: 'Serum' }, patient, discountValue: '295', discountKind: 'flat' }));
    const d = parseOrderDraft(raw, NOW, TTL)!;
    expect(d.testIds).toEqual(['a', 'b']);
    expect(d.specimens).toEqual({ a: 'Serum' });
    expect(d.discount).toEqual({ value: '295', kind: 'flat' });
  });

  it('round-trips a percent discount (the typed %, so the over-cap check and totals rebuild exactly)', () => {
    const raw = JSON.stringify(buildOrderDraft({ savedAt: NOW, priority: 'Urgent', testIds: ['a'], specimens: null, patient, discountValue: '25', discountKind: 'percent' }));
    const d = parseOrderDraft(raw, NOW, TTL)!;
    expect(d.discount).toEqual({ value: '25', kind: 'percent' });
    expect(d.priority).toBe('Urgent');
  });

  it('no discount typed → none stored, none restored', () => {
    const draft = buildOrderDraft({ savedAt: NOW, priority: 'Normal', testIds: ['a'], specimens: null, patient, discountValue: '  ', discountKind: 'flat' });
    expect('discount' in draft).toBe(false);
    expect(parseOrderDraft(JSON.stringify(draft), NOW, TTL)!.discount).toBeNull();
  });

  it('an OLD draft saved without a discount still restores', () => {
    const old = JSON.stringify({ savedAt: NOW - 1000, priority: 'Normal', testIds: ['x'], specimens: null, patient: { id: 'p1' } });
    const d = parseOrderDraft(old, NOW, TTL)!;
    expect(d.testIds).toEqual(['x']);
    expect(d.discount).toBeNull();
  });

  it('ignores a malformed discount (bad kind / non-numeric) instead of failing the draft', () => {
    const raw = JSON.stringify({ savedAt: NOW, testIds: ['x'], discount: { value: 'abc', kind: 'weird' } });
    const d = parseOrderDraft(raw, NOW, TTL)!;
    expect(d.testIds).toEqual(['x']);
    expect(d.discount).toBeNull();
  });

  it('stale / empty / garbage drafts → null', () => {
    expect(parseOrderDraft(JSON.stringify({ savedAt: NOW - TTL - 1, testIds: ['x'] }), NOW, TTL)).toBeNull();
    expect(parseOrderDraft(JSON.stringify({ savedAt: NOW, testIds: [] }), NOW, TTL)).toBeNull();
    expect(parseOrderDraft('not json', NOW, TTL)).toBeNull();
    expect(parseOrderDraft(null, NOW, TTL)).toBeNull();
  });
});

describe('order draft — branch scope (a Salem cart never shows in Trichy)', () => {
  const salem: DraftScope = { tenantId: 'ten1', branchId: 'bSalem', defaultBranchId: 'bSalem' };
  const trichy: DraftScope = { tenantId: 'ten1', branchId: 'bTrichy', defaultBranchId: 'bSalem' };

  it('keys a draft by branch + patient; legacy key when the branch is unknown', () => {
    expect(orderDraftKey(salem, 'p1')).toBe('pf:order-draft:bSalem:p1');
    expect(orderDraftKey({ tenantId: null, branchId: null, defaultBranchId: null }, 'p1')).toBe('pf:order-draft:p1');
  });

  it('parses both key shapes; the pending-registration stash is not a draft', () => {
    expect(parseOrderDraftKey('pf:order-draft:bSalem:p1')).toEqual({ branchId: 'bSalem', patientId: 'p1' });
    expect(parseOrderDraftKey('pf:order-draft:p1')).toEqual({ branchId: null, patientId: 'p1' });
    expect(parseOrderDraftKey('pf:order-draft:pending-registration')).toBeNull();
    expect(parseOrderDraftKey('pf:other:p1')).toBeNull();
  });

  it("a branch draft is in scope only in its own branch", () => {
    expect(orderDraftInScope('bSalem', {}, salem)).toBe(true);
    expect(orderDraftInScope('bSalem', {}, trichy)).toBe(false);
  });

  it("another tenant's draft (same browser, other account) is never in scope", () => {
    expect(orderDraftInScope('bSalem', { tenantId: 'ten2' }, salem)).toBe(false);
    expect(orderDraftInScope(null, { patient: { tenantId: 'ten2' } }, salem)).toBe(false);
  });

  it('a legacy draft belongs to the default branch only', () => {
    expect(orderDraftInScope(null, {}, salem)).toBe(true);
    expect(orderDraftInScope(null, {}, trichy)).toBe(false);
    expect(orderDraftKeysFor(salem, 'p1')).toEqual(['pf:order-draft:bSalem:p1', 'pf:order-draft:p1']);
    expect(orderDraftKeysFor(trichy, 'p1')).toEqual(['pf:order-draft:bTrichy:p1']);
  });

  it('stamps tenant + branch on a saved draft', () => {
    const d = buildOrderDraft({ savedAt: NOW, priority: 'Normal', testIds: ['a'], specimens: null, patient, discountValue: '', discountKind: 'flat', tenantId: 'ten1', branchId: 'bSalem' });
    expect(d).toMatchObject({ tenantId: 'ten1', branchId: 'bSalem' });
  });
});
