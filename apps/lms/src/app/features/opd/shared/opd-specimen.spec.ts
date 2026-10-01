import { missingSpecimens, opdAsksSpecimen, specimenPayload, type OpdInvestigationItem, type OpdTestLookup } from './opd-specimen';

const choose = { parameters: JSON.stringify({ specimenMode: 'choose' }) };
const fixed = { parameters: JSON.stringify({ specimenMode: 'fixed' }) };
const none = { parameters: JSON.stringify({ specimenMode: 'none' }) };
const legacyChoose = { parameters: JSON.stringify({ askSpecimen: true }) };
const noParams = {};

describe('opdAsksSpecimen', () => {
  it('asks only for choose-mode (explicit or legacy)', () => {
    expect(opdAsksSpecimen(choose)).toBe(true);
    expect(opdAsksSpecimen(legacyChoose)).toBe(true);
    expect(opdAsksSpecimen(fixed)).toBe(false);
    expect(opdAsksSpecimen(none)).toBe(false);
    expect(opdAsksSpecimen(noParams)).toBe(false);
    expect(opdAsksSpecimen(undefined)).toBe(false);
  });
});

describe('missingSpecimens — what blocks Complete / Checkout', () => {
  const testsById: OpdTestLookup = { koh: choose, cs: choose, cbc: none, bloodCulture: fixed, ua: legacyChoose };

  it('flags a choose-mode item with no specimen chosen (the BUG case: KOH Mount)', () => {
    const items: OpdInvestigationItem[] = [{ testId: 'koh', name: 'KOH Mount' }];
    const missing = missingSpecimens(items, testsById);
    expect(missing.map(m => m.testId)).toEqual(['koh']);
  });

  it('a chosen specimen (even whitespace-trimmed) clears the item', () => {
    const items: OpdInvestigationItem[] = [{ testId: 'koh', name: 'KOH Mount', specimen: '  Urine ' }];
    expect(missingSpecimens(items, testsById)).toEqual([]);
  });

  it('an empty-string / whitespace-only specimen still counts as missing', () => {
    const items: OpdInvestigationItem[] = [{ testId: 'cs', name: 'Culture & Sensitivity', specimen: '   ' }];
    expect(missingSpecimens(items, testsById).map(m => m.testId)).toEqual(['cs']);
  });

  it('none / fixed-mode items and unknown tests never block', () => {
    const items: OpdInvestigationItem[] = [
      { testId: 'cbc', name: 'CBC' },
      { testId: 'bloodCulture', name: 'Blood Culture' },
      { testId: 'missing-test', name: 'Untracked' },
    ];
    expect(missingSpecimens(items, testsById)).toEqual([]);
  });

  it('only the items that actually need a choice are reported, in order', () => {
    const items: OpdInvestigationItem[] = [
      { testId: 'cbc', name: 'CBC' },
      { testId: 'koh', name: 'KOH Mount' },
      { testId: 'cs', name: 'Culture & Sensitivity', specimen: 'Pus' },
      { testId: 'ua', name: 'Urine routine' },
    ];
    expect(missingSpecimens(items, testsById).map(m => m.testId)).toEqual(['koh', 'ua']);
  });

  it('a bundle member forwards through memberById the same way order-create does', () => {
    const bundleTestsById: OpdTestLookup = {
      panel: { parameters: JSON.stringify({ items: [{ testId: 'g' }] }) },
    };
    const memberById = (id: string) => (id === 'g' ? choose : undefined);
    const items: OpdInvestigationItem[] = [{ testId: 'panel', name: 'Panel' }];
    expect(missingSpecimens(items, bundleTestsById, memberById).map(m => m.testId)).toEqual(['panel']);
    expect(missingSpecimens(items, bundleTestsById).map(m => m.testId)).toEqual([]); // no lookup → bundle's own row only
  });
});

describe('specimenPayload — testId → specimen for CreateOrderInput.Specimens / CheckoutRequest.LabTestSpecimens', () => {
  it('carries only the items with a non-blank specimen, trimmed', () => {
    const items: OpdInvestigationItem[] = [
      { testId: 'koh', name: 'KOH Mount', specimen: ' Urine ' },
      { testId: 'cbc', name: 'CBC' },
      { testId: 'cs', name: 'C&S', specimen: '' },
    ];
    expect(specimenPayload(items)).toEqual({ koh: 'Urine' });
  });

  it('returns null (never {}) when nothing is carried, so callers can omit the field', () => {
    expect(specimenPayload([{ testId: 'cbc', name: 'CBC' }])).toBeNull();
    expect(specimenPayload([])).toBeNull();
  });
});
