import {
  type FamilyValue, type OptionFamily,
  asFamilyValue, chooseRoot, codeFromLabel, familyCodeFromName, familyDepth, familyIsAbnormal,
  familyReportLines, familyValueText, isFamilyFilled, itemAt, itemsAt, resultValueText, setItemQty,
  toggleItem, validateFamily, familyErrorText,
} from './option-family';
import { CASTS } from './option-family.spec-helpers';

describe('option family — the stored value', () => {
  const v: FamilyValue = { family: 'FAM-CASTS', v: 'PRS', label: 'Present', items: [
    { v: 'HYA', label: 'Hyaline', qty: '2-3', unit: '/LPF' },
    { v: 'GRA', label: 'Granular', qty: 'Few' },
  ] };

  it('familyValueText: the ONE single line', () => {
    expect(familyValueText(v)).toBe('Present — Hyaline 2-3 /LPF; Granular Few');
    expect(familyValueText({ family: 'FAM-CASTS', v: 'ABS', label: 'Absent' })).toBe('Absent');
    expect(familyValueText({ family: 'F', v: '', label: '' })).toBe('');
    expect(familyValueText('Present')).toBe('');
  });

  it('nested items read in brackets', () => {
    const deep: FamilyValue = { ...v, items: [{ v: 'GRA', label: 'Granular', qty: 'Few', items: [{ v: 'FIN', label: 'Fine' }] }] };
    expect(familyValueText(deep)).toBe('Present — Granular Few (Fine)');
  });

  it('asFamilyValue unwraps the object, mw\'s { value } wrapper and JSON text', () => {
    expect(asFamilyValue(v)).toBe(v);
    expect(asFamilyValue({ value: v, flag: 'A' })).toEqual(v);
    expect(asFamilyValue(JSON.stringify(v))).toEqual(v);
    expect(asFamilyValue(JSON.stringify({ value: v, flag: 'A' }))).toEqual(v);
    for (const x of [null, undefined, '', 'Present', 42, ['a'], { value: '5' }, '{"value":"5"}']) expect(asFamilyValue(x)).toBeNull();
  });

  it('resultValueText never prints [object Object]', () => {
    expect(resultValueText(v)).toBe('Present — Hyaline 2-3 /LPF; Granular Few');
    expect(resultValueText({ value: v, flag: 'A' })).toBe('Present — Hyaline 2-3 /LPF; Granular Few');
    expect(resultValueText(['Few', 'Many'])).toBe('Few; Many');
    expect(resultValueText(5.2)).toBe('5.2');
    expect(resultValueText(null)).toBe('');
    expect(resultValueText({ odd: true })).toBe('');
  });

  it('isFamilyFilled: a root answer is a value; a blank pick is not', () => {
    expect(isFamilyFilled(v)).toBe(true);
    expect(isFamilyFilled({ family: 'F', v: '', label: '' })).toBe(false);
    expect(isFamilyFilled('x')).toBe(false);
  });

  it('familyReportLines: parent row, then one indented line per item (deeper indents further)', () => {
    const deep: FamilyValue = { ...v, items: [...v.items!, { v: 'OTH', label: 'Other', qty: 'clumps', items: [{ v: 'X', label: 'Sub', qty: '1' }] }] };
    expect(familyReportLines(deep)).toEqual([
      { depth: 0, label: '', value: 'Present' },
      { depth: 1, label: 'Hyaline', value: '2-3 /LPF' },
      { depth: 1, label: 'Granular', value: 'Few' },
      { depth: 1, label: 'Other', value: 'clumps' },
      { depth: 2, label: 'Sub', value: '1' },
    ]);
    expect(familyReportLines({ family: 'F', v: 'ABS', label: 'Absent' })).toEqual([{ depth: 0, label: '', value: 'Absent' }]);
    expect(familyReportLines({ family: 'F', v: '', label: '' })).toEqual([]);
  });

  it('familyIsAbnormal: the picked ROOT node decides', () => {
    expect(familyIsAbnormal(CASTS, v)).toBe(true);
    expect(familyIsAbnormal(CASTS, { family: 'FAM-CASTS', v: 'ABS', label: 'Absent' })).toBe(false);
    expect(familyIsAbnormal(null, v)).toBeNull();
    expect(familyIsAbnormal(CASTS, { family: 'FAM-CASTS', v: 'GONE', label: 'Removed' })).toBeNull();
    expect(familyIsAbnormal(CASTS, '')).toBeNull();
  });
});

describe('option family — building a value at the bench', () => {
  it('Present → two casts with amounts produces the contract shape exactly', () => {
    let v = chooseRoot(CASTS, null, 'PRS')!;
    expect(v).toEqual({ family: 'FAM-CASTS', v: 'PRS', label: 'Present' });
    v = toggleItem(CASTS, v, ['PRS'], 'GRA', true);
    v = toggleItem(CASTS, v, ['PRS'], 'HYA', true);
    v = setItemQty(CASTS, v, ['PRS', 'HYA'], '2-3');
    v = setItemQty(CASTS, v, ['PRS', 'GRA'], 'Few');
    // Items keep the DEFINITION's order, whatever order they were ticked in.
    expect(v).toEqual({ family: 'FAM-CASTS', v: 'PRS', label: 'Present', items: [
      { v: 'HYA', label: 'Hyaline', qty: '2-3', unit: '/LPF' },
      { v: 'GRA', label: 'Granular', qty: 'Few' },
    ] });
    expect(JSON.parse(JSON.stringify(v))).toEqual(v);
  });

  it('unticking removes the item; the last one drops `items` entirely', () => {
    let v = chooseRoot(CASTS, null, 'PRS')!;
    v = toggleItem(CASTS, v, ['PRS'], 'WAX', true);
    expect(itemAt(v, ['PRS', 'WAX'])).toEqual({ v: 'WAX', label: 'Waxy', unit: '/LPF' });
    v = toggleItem(CASTS, v, ['PRS'], 'WAX', false);
    expect(v).toEqual({ family: 'FAM-CASTS', v: 'PRS', label: 'Present' });
  });

  it('a single-pick sub-list replaces its pick; deeper levels nest', () => {
    let v = chooseRoot(CASTS, null, 'PRS')!;
    v = toggleItem(CASTS, v, ['PRS'], 'GRA', true);
    v = toggleItem(CASTS, v, ['PRS', 'GRA'], 'FIN', true);
    v = toggleItem(CASTS, v, ['PRS', 'GRA'], 'CRS', true);
    expect(itemsAt(v, ['PRS', 'GRA'])).toEqual([{ v: 'CRS', label: 'Coarse' }]);
    expect(familyValueText(v)).toBe('Present — Granular (Coarse)');
  });

  it('switching the root answer drops the old answer\'s items; re-picking keeps them', () => {
    let v = chooseRoot(CASTS, null, 'PRS')!;
    v = toggleItem(CASTS, v, ['PRS'], 'HYA', true);
    expect(chooseRoot(CASTS, v, 'PRS')!.items?.length).toBe(1);
    expect(chooseRoot(CASTS, v, 'ABS')).toEqual({ family: 'FAM-CASTS', v: 'ABS', label: 'Absent' });
    expect(chooseRoot(CASTS, v, '')).toBeNull();
    expect(chooseRoot(CASTS, v, 'NOPE')).toBeNull();
  });

  it('a blank amount clears qty but keeps the unit', () => {
    let v = toggleItem(CASTS, chooseRoot(CASTS, null, 'PRS')!, ['PRS'], 'HYA', true);
    v = setItemQty(CASTS, v, ['PRS', 'HYA'], '3-5');
    v = setItemQty(CASTS, v, ['PRS', 'HYA'], '  ');
    expect(itemAt(v, ['PRS', 'HYA'])).toEqual({ v: 'HYA', label: 'Hyaline', unit: '/LPF' });
  });

  it('unknown codes are ignored (never invent nodes)', () => {
    const v = chooseRoot(CASTS, null, 'PRS')!;
    expect(toggleItem(CASTS, v, ['PRS'], 'ZZZ', true)).toBe(v);
    expect(toggleItem(CASTS, v, ['ABS'], 'HYA', true)).toBe(v);
  });
});

describe('option family — editor validation', () => {
  it('the contract family is valid and 3 deep', () => {
    expect(validateFamily(CASTS)).toEqual([]);
    expect(familyDepth(CASTS.nodes)).toBe(3);
  });

  it('names every blocking problem', () => {
    const bad: OptionFamily = { code: '', name: ' ', active: true, nodes: [
      { code: 'A', label: 'Absent' },
      { code: 'a', label: 'absent' },
      { code: '', label: '' },
      { code: 'P', label: 'Present', qty: { kind: 'choice', options: [' '] }, children: { label: 'x', multi: true, nodes: [] } },
    ] };
    const msgs = validateFamily(bad).map(i => i.message).join(' | ');
    expect(msgs).toContain('Give the family a name');
    expect(msgs).toContain('needs a code');
    expect(msgs).toContain('Code "A" is used twice');
    expect(msgs).toContain('"absent" appears twice');
    expect(msgs).toContain('has no label');
    expect(msgs).toContain('add at least one choice');
    expect(msgs).toContain('sub-list with no options');
    expect(validateFamily({ code: 'F', name: 'F', active: true, nodes: [] })[0].message).toContain('at least one answer');
  });

  it('refuses a fifth level', () => {
    const lvl = (n: number): OptionFamily['nodes'] => n === 0 ? [{ code: 'L', label: 'Leaf' }]
      : [{ code: `N${n}`, label: `Level ${n}`, children: { label: 'k', multi: false, nodes: lvl(n - 1) } }];
    expect(validateFamily({ code: 'F', name: 'F', active: true, nodes: lvl(3) })).toEqual([]);
    expect(validateFamily({ code: 'F', name: 'F', active: true, nodes: lvl(4) }).some(i => i.message.includes('at most 4'))).toBe(true);
  });

  it('codes from labels are stable and unique', () => {
    expect(codeFromLabel('Hyaline', [])).toBe('HYA');
    expect(codeFromLabel('Hyaline', ['HYA'])).toBe('HYA2');
    expect(codeFromLabel('—', [])).toBe('OPT');
    expect(familyCodeFromName('Casts', [])).toBe('FAM-CASTS');
    expect(familyCodeFromName('Urine crystals!', ['FAM-URINE-CRYSTALS'])).toBe('FAM-URINE-CRYSTALS-2');
  });
});

describe('option family — server error codes in plain words', () => {
  it('maps every coded 400/409 and leaves others alone', () => {
    for (const c of ['family_nodes_empty', 'family_node_code_duplicate', 'family_depth', 'family_qty_kind', 'family_qty_options',
      'family_label_required', 'family_value_invalid', 'family_unknown_code', 'family_qty_invalid', 'family_unknown',
      'family_code_exists', 'family_in_use', 'family_via_profile', 'profile_only']) expect(familyErrorText(c)).toBeTruthy();
    expect(familyErrorText('range_invalid')).toBeNull();
    expect(familyErrorText(undefined)).toBeNull();
  });
  it('without a definition the server-stamped verdict decides', () => {
    expect(familyIsAbnormal(null, { family: 'F', v: 'PRS', label: 'Present', abnormal: true })).toBe(true);
  });
});
