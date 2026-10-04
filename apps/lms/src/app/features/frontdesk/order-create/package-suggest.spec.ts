import { computeBill } from '../../../shared/utils/bill-math';
import { effectivePrice, taxSlabOf } from '../../../shared/utils/test-pricing';
import { PACKAGE_SUGGEST_RULES, classifyBundle, suggestBundles, type SuggestCatalogItem } from './package-suggest';

/**
 * Package / profile suggestion classification (owner 2026-09-29: a ₹100 test
 * shown as ~~₹100~~ ₹1,000 read as a saving). SAVING = the bundle costs no
 * more than the cart lines it replaces (the only strike-through); UPGRADE =
 * dearer, shown as "+₹X"; everything else is SUPPRESSED.
 */
type Row = SuggestCatalogItem & { price: number; taxSlab?: number; priceIsDefault?: boolean };
const T = (id: string, price: number, extra: Partial<Row> = {}): Row =>
  ({ id, name: id.toUpperCase(), type: 'individual', price, priceIsDefault: false, isActive: true, ...extra });
const items = (...ids: string[]) => JSON.stringify({ items: ids.map(testId => ({ testId })) });
const B = (id: string, price: number, members: string[], extra: Partial<Row> = {}) =>
  T(id, price, { type: 'package', parameters: items(...members), ...extra });
/** The cart's unit: the single price source + its slab (GST on). */
const unit = (t: Row) => ({ price: effectivePrice(t), slab: taxSlabOf(t) });

// Owner's case: a ₹100 test; a ₹1,000 package with 13 members worth ₹1,950.
const FULL_BODY_MEMBERS: Row[] = [
  T('tsh', 100), T('cbc', 300), T('esr', 120), T('crp', 180), T('fbs', 80), T('hba1c', 250), T('chol', 150),
  T('tg', 150), T('crea', 120), T('urea', 100), T('sgpt', 100), T('sgot', 100), T('urine', 200),
];
const FULL_BODY = B('fullbody', 1000, FULL_BODY_MEMBERS.map(m => m.id), { name: 'Full Body Checkup' });

describe('classifyBundle — the three cases in ₹', () => {
  it('SAVING: ₹499 bundle for ₹600 of cart tests', () => {
    expect(classifyBundle({ bundleAmount: 499, coveredAmount: 600, membersAmount: 900, extraCount: 2 })).toEqual({ kind: 'saving' });
  });

  it('SAVING at the same price only when it adds tests; else no benefit', () => {
    expect(classifyBundle({ bundleAmount: 600, coveredAmount: 600, membersAmount: 900, extraCount: 2 })).toEqual({ kind: 'saving' });
    expect(classifyBundle({ bundleAmount: 600, coveredAmount: 600, membersAmount: null, extraCount: 0 }))
      .toEqual({ kind: 'suppressed', reason: 'no_benefit' });
  });

  it("owner: ₹100 test vs ₹1,000 package (members ₹1,950) is an UPGRADE, not a saving", () => {
    expect(classifyBundle({ bundleAmount: 1000, coveredAmount: 100, membersAmount: 1950, extraCount: 12 })).toEqual({ kind: 'upgrade' });
  });

  it('SUPPRESSED: a bundle priced at or above its members is never good value', () => {
    expect(classifyBundle({ bundleAmount: 900, coveredAmount: 600, membersAmount: 900, extraCount: 2 }))
      .toEqual({ kind: 'suppressed', reason: 'not_good_value' });
    expect(classifyBundle({ bundleAmount: 950, coveredAmount: 600, membersAmount: 900, extraCount: 2 }))
      .toEqual({ kind: 'suppressed', reason: 'not_good_value' });
  });

  it('SUPPRESSED upgrade: less than 10% cheaper than its members', () => {
    // ₹1,760 vs ₹1,950 = 9.7% off → not shown; ₹1,755 = exactly 10% → shown.
    expect(classifyBundle({ bundleAmount: 1760, coveredAmount: 1000, membersAmount: 1950, extraCount: 5 }))
      .toEqual({ kind: 'suppressed', reason: 'not_good_value' });
    expect(classifyBundle({ bundleAmount: 1755, coveredAmount: 1000, membersAmount: 1950, extraCount: 5 }))
      .toEqual({ kind: 'upgrade' });
  });

  it('SUPPRESSED upgrade: extra cost above max(₹1,000, 2 × the cart lines)', () => {
    // ₹100 cart: up to +₹1,000. A ₹5,000 package (+₹4,900) is out of proportion.
    expect(classifyBundle({ bundleAmount: 5000, coveredAmount: 100, membersAmount: 9000, extraCount: 40 }))
      .toEqual({ kind: 'suppressed', reason: 'too_big_a_jump' });
    expect(classifyBundle({ bundleAmount: 1100, coveredAmount: 100, membersAmount: 2000, extraCount: 8 })).toEqual({ kind: 'upgrade' });
    expect(classifyBundle({ bundleAmount: 1101, coveredAmount: 100, membersAmount: 2000, extraCount: 8 }))
      .toEqual({ kind: 'suppressed', reason: 'too_big_a_jump' });
    // ₹3,000 cart: up to +₹6,000.
    expect(classifyBundle({ bundleAmount: 9000, coveredAmount: 3000, membersAmount: 15000, extraCount: 20 })).toEqual({ kind: 'upgrade' });
  });

  it('SUPPRESSED upgrade: member value unknown (a member is not orderable here)', () => {
    expect(classifyBundle({ bundleAmount: 1000, coveredAmount: 100, membersAmount: null, extraCount: 12 }))
      .toEqual({ kind: 'suppressed', reason: 'members_unpriced' });
  });

  it('thresholds live in one frozen constant', () => {
    expect(PACKAGE_SUGGEST_RULES).toEqual({ minBundleValuePct: 10, upgradeExtraFloor: 1000, upgradeExtraMultiple: 2, maxSavings: 2, maxUpgrades: 1 });
    expect(Object.isFrozen(PACKAGE_SUGGEST_RULES)).toBe(true);
  });
});

describe('suggestBundles — the cart', () => {
  it("owner's case: ₹100 TSH → upgrade to Full Body Checkup, +₹900, adds 12 tests worth ₹1,850, ₹1,000 vs ₹1,950", () => {
    const [s, ...rest] = suggestBundles([...FULL_BODY_MEMBERS, FULL_BODY], ['tsh'], unit);
    expect(rest).toEqual([]);
    expect(s.kind).toBe('upgrade');
    expect(s.bundle.id).toBe('fullbody');
    expect(s.coveredIds).toEqual(['tsh']);
    expect(s.coveredAmount).toBe(100);
    expect(s.bundleAmount).toBe(1000);
    expect(s.delta).toBe(900);
    expect(s.extraCost).toBe(900);
    expect(s.savings).toBe(0);
    expect(s.extraCount).toBe(12);
    expect(s.extraMembersAmount).toBe(1850);
    expect(s.membersAmount).toBe(1950);
    expect(s.members).toHaveLength(13);
    expect(s.members.filter(m => m.inCart).map(m => m.id)).toEqual(['tsh']);
  });

  it('saving: CBC+ESR+CRP (₹600) → ₹499 Fever Panel, save ₹101, adds 2 tests; the upgrade shows after it', () => {
    const cat = [...FULL_BODY_MEMBERS, T('mal', 150), T('widal', 150), FULL_BODY,
      B('fever', 499, ['cbc', 'esr', 'crp', 'mal', 'widal'])];
    const out = suggestBundles(cat, ['cbc', 'esr', 'crp'], unit);
    expect(out.map(s => [s.kind, s.bundle.id])).toEqual([['saving', 'fever'], ['upgrade', 'fullbody']]);
    expect(out[0].coveredAmount).toBe(600);
    expect(out[0].savings).toBe(101);
    expect(out[0].delta).toBe(-101);
    expect(out[0].extraCount).toBe(2);
    expect(out[1].extraCost).toBe(400);
  });

  it('a poor-value bundle (₹900 for ₹780 of members) is never suggested', () => {
    const cat = [...FULL_BODY_MEMBERS, B('thyroidplus', 900, ['tsh', 'cbc', 'esr', 'crp', 'fbs'])];
    expect(suggestBundles(cat, ['tsh'], unit)).toEqual([]);
  });

  it('profiles follow the same rules as packages (and partial overlap may still save)', () => {
    const cat = [T('sgot', 200), T('sgpt', 200), T('alp', 150), T('tsh', 300),
      T('lft', 350, { type: 'profile', parameters: items('sgot', 'sgpt', 'alp') })];
    const [s] = suggestBundles(cat, ['sgot', 'sgpt', 'tsh'], unit);
    expect(s.kind).toBe('saving');
    expect(s.bundle.type).toBe('profile');
    expect(s.coveredIds).toEqual(['sgot', 'sgpt']);   // TSH stays in the cart
    expect(s.savings).toBe(50);
  });

  it('caps: at most 2 savings (largest first) and 1 upgrade (smallest extra first)', () => {
    const cat = [T('a', 500), T('b', 500), T('c', 400), T('d', 400),
      B('s1', 900, ['a', 'b']), B('s2', 800, ['a', 'b', 'c']), B('s3', 990, ['a', 'b', 'd']),
      B('u1', 1500, ['a', 'b', 'c', 'd']), B('u2', 1300, ['a', 'b', 'c', 'd'])];
    // Savings: s2 ₹200, s1 ₹100, s3 ₹10 → top two. Upgrades: u2 +₹300, u1 +₹500 → u2 only.
    const out = suggestBundles(cat, ['a', 'b'], unit);
    expect(out.map(s => s.bundle.id)).toEqual(['s2', 's1', 'u2']);
  });

  it('skips inactive bundles, bundles already in the cart, and tests already billed at ₹0 inside one', () => {
    const cat = [T('a', 300), T('b', 300), T('c', 300),
      B('off', 400, ['a', 'b'], { isActive: false }),
      B('in', 500, ['a', 'c']),
      B('pa', 350, ['a', 'b'])];
    // 'a' is already inside 'in' (billed ₹0): swapping it for 'pa' saves nothing real.
    expect(suggestBundles(cat, ['a', 'in'], unit)).toEqual([]);
    // Without 'in', 'pa' is a quiet upgrade (+₹50) and 'off' is still never shown.
    expect(suggestBundles(cat, ['a'], unit).map(s => [s.kind, s.bundle.id])).toEqual([['upgrade', 'pa']]);
  });

  it('price source parity: every amount is the BillMath gross of the cart units (GST slabs included)', () => {
    const cat = [T('x', 1000, { taxSlab: 18 }), T('y', 500, { taxSlab: 5 }), T('z', 200),
      B('bx', 1300, ['x', 'y', 'z'], { taxSlab: 12 })];
    const [s] = suggestBundles(cat, ['x', 'y'], unit);
    const gross = (...rows: Row[]) => computeBill(rows.map(unit), 0).gross;
    expect(s.coveredAmount).toBe(gross(cat[0], cat[1]));     // 1180 + 525 = 1705
    expect(s.coveredAmount).toBe(1705);
    expect(s.bundleAmount).toBe(gross(cat[3]));               // 1300 @12% = 1456
    expect(s.bundleAmount).toBe(1456);
    expect(s.kind).toBe('saving');
    expect(s.savings).toBe(249);
    expect(s.membersAmount).toBe(gross(cat[0], cat[1], cat[2]));
  });

  it('an unpriced (₹1 default) test uses the same ₹1 the cart bills', () => {
    const cat = [T('new', 1, { priceIsDefault: true }), T('b', 400), B('p', 350, ['new', 'b'])];
    const [s] = suggestBundles(cat, ['new'], unit);
    expect(s.coveredAmount).toBe(1);
    expect(s.kind).toBe('upgrade');
    expect(s.extraCost).toBe(349);
  });
});
