import type { Test } from '../../../../shared/models/test.model';
import type { OptionFamily } from '../../../../shared/utils/option-family';
import {
  absorbedMembers, codeForTest, isFamilyLineTest, isPendingSubchoice, isTypedSubchoice, linkNodeToTest, linkedKeys,
  moveVisible, nestedMembers, pendingSubchoiceIssue, subtestChoices, subtestOptions, subtestQty, visibleOrder,
} from './family-subtest';
import { lineIssues, lineNodes } from './profile-family-lines';

const sel = (options: string[], extra: Record<string, unknown> = {}) => JSON.stringify({ parameters: [{
  name: 'x', type: 'select', options,
  optionRows: options.map((value, i) => ({ code: `UMO00${i + 1}`, value, normal: i === 0, active: true })), ...extra,
}] });

const test = (over: Partial<Test>): Test => ({
  id: over.id ?? over.testCode ?? 'id', tenantId: 't', name: 'Test', type: 'individual', flow: 'direct',
  taxSlab: 0, price: 0, discount: 0, tatHours: 24, isActive: true, createdAt: '', ...over,
} as Test);

const URINE = { id: 'd-clp', name: 'Clinical Pathology', code: 'CLP' };
const BIO = { id: 'd-bio', name: 'Biochemistry', code: 'BIO' };

const catalogue = (): Test[] => [
  test({ id: 'glu', testCode: 'BIO001', catalogKey: 'BIO001', name: 'Glucose Fasting', departmentId: 'd-bio', department: BIO,
    parameters: JSON.stringify({ parameters: [{ name: 'Glucose', type: 'numeric', unit: 'mg/dL' }] }) }),
  test({ id: 'gra', testCode: 'CLP031', catalogKey: 'CLP031', name: 'Granular Casts', departmentId: 'd-clp', department: URINE,
    parameters: sel(['None', 'Few', 'Moderate', 'Many']) }),
  test({ id: 'hya', testCode: 'CLP030', catalogKey: 'CLP030', name: 'Hyaline Casts', departmentId: 'd-clp', department: URINE,
    parameters: sel(['None', 'Few', 'Moderate', 'Many']) }),
  test({ id: 'col', testCode: 'CLP010', catalogKey: 'CLP010', name: 'Colour', departmentId: 'd-clp', department: URINE,
    parameters: JSON.stringify({ parameters: [{ name: 'Colour', type: 'text' }] }) }),
  // Never offered:
  test({ id: 'off', testCode: 'CLP099', catalogKey: 'CLP099', name: 'Switched off', isEnabled: false, departmentId: 'd-clp' }),
  test({ id: 'inact', testCode: 'CLP098', catalogKey: 'CLP098', name: 'Inactive', isActive: false, departmentId: 'd-clp' }),
  test({ id: 'nokey', testCode: 'LOC001', catalogKey: null, name: 'No key' }),
  test({ id: 'prof', testCode: 'CLP002', catalogKey: 'CLP002', name: 'Urine Microscopy', type: 'profile' }),
  test({ id: 'line', testCode: 'PF-CLP002-1', catalogKey: 'PF-CLP002-1', name: 'Casts',
    parameters: JSON.stringify({ parameters: [{ name: 'Casts', type: 'family', familyCode: 'PF-CLP002-1' }] }) }),
  test({ id: 'own', testCode: 'PF-CLP002-2', catalogKey: 'PF-CLP002-2', name: 'Crystals' }),
];

describe('family sub-choices from real tests — the amount a pick starts with', () => {
  it('a list test → its own answers (active option rows, in order) + unit', () => {
    expect(subtestQty(test({ parameters: sel(['None', 'Few', 'Moderate', 'Many'], { unit: '/LPF' }) })))
      .toEqual({ kind: 'choice', options: ['None', 'Few', 'Moderate', 'Many'], unit: '/LPF' });
    const rows = JSON.stringify({ parameters: [{ name: 'x', type: 'select', optionRows: [
      { value: 'Few', active: true }, { value: 'Old', active: false }, { value: 'Many', active: true }] }] });
    expect(subtestQty(test({ parameters: rows }))).toEqual({ kind: 'choice', options: ['Few', 'Many'] });
  });

  it('a number test → a number with its unit (the test-level unit when the value has none); text → text; nothing → none', () => {
    expect(subtestQty(test({ parameters: JSON.stringify({ parameters: [{ name: 'G', type: 'numeric', unit: 'mg/dL' }] }) })))
      .toEqual({ kind: 'number', unit: 'mg/dL' });
    expect(subtestQty(test({ unit: '/HPF', parameters: JSON.stringify({ parameters: [{ name: 'G', type: 'numeric' }] }) })))
      .toEqual({ kind: 'number', unit: '/HPF' });
    expect(subtestQty(test({ parameters: JSON.stringify({ parameters: [{ name: 'C', type: 'text' }] }) }))).toEqual({ kind: 'text' });
    expect(subtestQty(test({ parameters: undefined }))).toBeNull();
    // An already-parsed blob (some payloads) reads the same.
    expect(subtestQty(test({ parameters: { parameters: [{ name: 'G', type: 'numeric', unit: 'g' }] } as unknown as string })))
      .toEqual({ kind: 'number', unit: 'g' });
  });
});

describe('family sub-choices — the picker offers ONLY this profile\'s own members (revision 2)', () => {
  const MEMBERS = ['col', 'hya', 'gra', 'line', 'glu', 'off', 'nokey', 'prof'];

  it('members only, in the lab entry order — never a non-member, a family line, a profile or a test without a key', () => {
    const keys = subtestChoices(catalogue(), { memberIds: MEMBERS, excludeIds: ['line'] }).map(c => c.key);
    // 'off' is switched off for ordering but still a member: offered (it is the profile\'s own test).
    expect(keys).toEqual(['CLP010', 'CLP030', 'CLP031', 'BIO001', 'CLP099']);
    expect(subtestChoices(catalogue(), { memberIds: [] })).toEqual([]);
    expect(isFamilyLineTest(catalogue().find(t => t.id === 'line')!)).toBe(true);
  });

  it('a member already linked in ANOTHER family line of the profile is not offered (one family per member)', () => {
    const c = subtestChoices(catalogue(), { memberIds: MEMBERS, excludeIds: ['line'], takenElsewhere: new Set(['clp030']) });
    expect(c.map(x => x.key)).not.toContain('CLP030');
    expect(c.find(x => x.code === 'CLP031')!.qty).toEqual({ kind: 'choice', options: ['None', 'Few', 'Moderate', 'Many'] });
  });

  it('rows carry the code; a test picked beside it is shown but disabled', () => {
    const c = subtestChoices(catalogue(), { memberIds: ['hya', 'gra'] });
    expect(subtestOptions(c, new Set(['CLP030']))).toEqual([
      { value: 'CLP030', label: 'Hyaline Casts', hint: 'CLP030 · Already picked here', disabled: true },
      { value: 'CLP031', label: 'Granular Casts', hint: 'CLP031', disabled: false },
    ]);
    expect(subtestOptions(c, new Set(['CLP030']), 'CLP030')[0].disabled).toBe(false);
  });
});

describe('family sub-choices — absorbed members leave the order lists (revision 2)', () => {
  const lines = [
    { testId: 'casts', family: { nodes: [{ code: 'ABS', label: 'Absent' }, { code: 'PRS', label: 'Present', children: { label: 'Type', multi: true, nodes: [
      { code: 'CLP031', label: 'Granular Casts', test: 'CLP031' }, { code: 'CLP030', label: 'Hyaline Casts', test: 'clp030' }, { code: 'X', label: 'Typed' },
    ] } }] } },
    { testId: 'crystals', family: { nodes: [{ code: 'PRS', label: 'Present', children: { label: 'T', multi: true, nodes: [{ code: 'Z', label: 'Gone', test: 'NOPE' }] } }] } },
  ];
  const members = [{ id: 'rbc', catalogKey: 'CLP025' }, { id: 'hya', catalogKey: 'CLP030' }, { id: 'casts', catalogKey: 'L1' },
    { id: 'gra', catalogKey: 'CLP031' }, { id: 'crystals', catalogKey: 'L2' }, { id: 'muc', catalogKey: 'CLP045' }];
  const ids = members.map(m => m.id);

  it('the live family trees decide which members are absorbed (by CatalogKey, any case); a key that is no member absorbs nothing', () => {
    expect(linkedKeys(lines[0].family.nodes)).toEqual(['CLP031', 'clp030']);
    const abs = absorbedMembers(lines, members);
    expect([...abs.entries()]).toEqual([['gra', 'casts'], ['hya', 'casts']]);
  });

  it('lists show the free members and family lines; the absorbed ones nest under their family, in the list\'s order', () => {
    const abs = absorbedMembers(lines, members);
    expect(visibleOrder(ids, abs)).toEqual(['rbc', 'casts', 'crystals', 'muc']);
    expect(nestedMembers('casts', ids, abs)).toEqual(['hya', 'gra']);
    expect(nestedMembers('crystals', ids, abs)).toEqual([]);
  });

  it('moving a visible row keeps every absorbed member in its own slot (un-linking restores its place)', () => {
    const abs = absorbedMembers(lines, members);
    // Casts (visible 1) down past Crystals (visible 2).
    const moved = moveVisible(ids, abs, 1, 2);
    expect(moved).toEqual(['rbc', 'hya', 'crystals', 'gra', 'casts', 'muc']);
    expect(visibleOrder(moved, abs)).toEqual(['rbc', 'crystals', 'casts', 'muc']);
    // Un-link both: they are back exactly where they were.
    expect(visibleOrder(moved, new Map())).toEqual(['rbc', 'hya', 'crystals', 'gra', 'casts', 'muc']);
    expect(moveVisible(ids, abs, 0, 9)).toEqual(ids);
  });
});

describe('family sub-choices from real tests — linking a node', () => {
  const choices = () => subtestChoices(catalogue(), { memberIds: ['hya', 'gra'] });
  const hya = () => choices().find(c => c.key === 'CLP030')!;

  it('a new sub-choice takes the test code, name, link and the prefilled amount', () => {
    expect(linkNodeToTest({ code: '', label: '' }, hya(), ['ABC'])).toEqual({
      code: 'CLP030', label: 'Hyaline Casts', test: 'CLP030',
      qty: { kind: 'choice', options: ['None', 'Few', 'Moderate', 'Many'] },
    });
  });

  it('a typed (older) sub-choice keeps its sub-list; a test without answers keeps the node amount; testMissing clears', () => {
    const typed = { code: 'HYA', label: 'Hyaline', qty: { kind: 'number' as const, unit: '/LPF' }, testMissing: true,
      children: { label: 'Size', multi: false, nodes: [{ code: 'BIG', label: 'Big' }] } };
    const linked = linkNodeToTest(typed, hya(), ['HYA', 'GRA']);
    expect(linked.code).toBe('CLP030');
    expect(linked.test).toBe('CLP030');
    expect(linked.children).toEqual(typed.children);
    expect('testMissing' in linked).toBe(false);
    const bare = { ...hya(), qty: null };
    expect(linkNodeToTest(typed, bare, []).qty).toEqual({ kind: 'number', unit: '/LPF' });
  });

  it('codes stay unique among siblings and inside the stable-key alphabet', () => {
    expect(codeForTest('CLP030', 'Hyaline', ['CLP030'])).toBe('CLP030-2');
    expect(codeForTest('CLP/030 a', 'Hyaline', [])).toBe('CLP-030-a');
    expect(codeForTest('', 'Hyaline', ['HYA'])).toBe('HYA2');
  });

  it('pending vs typed sub-choices; the root never counts', () => {
    expect(isPendingSubchoice({ code: '', label: '' }, 2)).toBe(true);
    expect(isPendingSubchoice({ code: '', label: '' }, 1)).toBe(false);
    expect(isTypedSubchoice({ code: 'HYA', label: 'Hyaline' }, 2)).toBe(true);
    expect(isTypedSubchoice({ code: 'CLP030', label: 'Hyaline Casts', test: 'CLP030' }, 2)).toBe(false);
  });
});

describe('family line save — sub-choices waiting for a test', () => {
  const draft = (): OptionFamily => ({ code: 'NEW', name: 'Casts', active: true, nodes: [
    { code: 'ABS', label: 'Absent', normal: true },
    { code: 'PRS', label: 'Present', children: { label: 'Cast type', multi: true, nodes: [
      { code: 'CLP030', label: 'Hyaline Casts', test: 'CLP030', testMissing: true },
      { code: '', label: '' },
    ] } },
  ] });

  it('blocks the save with one plain line until every sub-choice has its test', () => {
    expect(pendingSubchoiceIssue(draft().nodes)).toBe('Pick a test for every sub-choice — or remove the empty one.');
    expect(lineIssues(draft())[0]).toBe('Pick a test for every sub-choice — or remove the empty one.');
    const ok = draft();
    ok.nodes[1].children!.nodes.pop();
    expect(lineIssues(ok)).toEqual([]);
  });

  it('sends the link but never the read-only testMissing flag', () => {
    const d = draft();
    d.nodes[1].children!.nodes.pop();
    expect(lineNodes(d)[1].children!.nodes).toEqual([{ code: 'CLP030', label: 'Hyaline Casts', test: 'CLP030' }]);
  });
});
