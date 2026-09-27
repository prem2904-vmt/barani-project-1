import { cartOverlaps, descendantIds, overlapMessage, overlapOnAdd, type CartCatalogItem } from './cart-duplicates';

const items = (...ids: string[]) => JSON.stringify({ items: ids.map(testId => ({ testId })) });
const A: CartCatalogItem = { id: 'a', name: 'SGOT', type: 'individual' };
const B: CartCatalogItem = { id: 'b', name: 'SGPT', type: 'individual' };
const C: CartCatalogItem = { id: 'c', name: 'HbA1c', type: 'individual' };
const D: CartCatalogItem = { id: 'd', name: 'TSH', type: 'individual' };
const LFT: CartCatalogItem = { id: 'lft', name: 'Liver Function Test', type: 'profile', parameters: items('a', 'b') };
const PKG: CartCatalogItem = { id: 'pkg', name: 'Health Checkup', type: 'package', parameters: items('lft', 'c') };
const OTHER: CartCatalogItem = { id: 'oth', name: 'Mini Liver', type: 'profile', parameters: items('a', 'd') };
const catalog = [A, B, C, D, LFT, PKG, OTHER];

describe('cart duplicates (owner rule; server DuplicateItemRules)', () => {
  it('a package holds its profile, the profile\'s tests and its own tests', () => {
    const byId = new Map(catalog.map(t => [t.id, t] as const));
    expect([...descendantIds(PKG, byId)].sort()).toEqual(['a', 'b', 'c', 'lft']);
  });

  it.each([
    ['profile, then its member test', ['lft'], 'a', 'lft', 'a'],
    ['member test, then its profile', ['a'], 'lft', 'lft', 'a'],
    ['package, then its profile', ['pkg'], 'lft', 'pkg', 'lft'],
    ['profile, then the package holding it', ['lft'], 'pkg', 'pkg', 'lft'],
    ['package, then its direct test', ['pkg'], 'c', 'pkg', 'c'],
    ['package, then a test inside its profile', ['pkg'], 'b', 'pkg', 'b'],
  ])('%s → refused, naming both', (_label, cart, add, container, member) => {
    const o = overlapOnAdd(catalog, cart as string[], add as string)!;
    expect(o).not.toBeNull();
    expect(o.container.id).toBe(container);
    expect(o.member.id).toBe(member);
  });

  it('unrelated items and sibling bundles sharing a member are allowed', () => {
    expect(overlapOnAdd(catalog, ['lft'], 'd')).toBeNull();
    expect(overlapOnAdd(catalog, ['lft'], 'oth')).toBeNull();
    expect(overlapOnAdd(catalog, ['pkg'], 'd')).toBeNull();
  });

  it('re-adding something already in the cart is not an overlap (toggle removes it)', () => {
    expect(overlapOnAdd(catalog, ['lft', 'd'], 'lft')).toBeNull();
  });

  it('flags every overlap in a restored cart without throwing', () => {
    const found = cartOverlaps(catalog, ['pkg', 'lft', 'a', 'd', 'missing']);
    expect(found.map(o => `${o.container.id}>${o.member.id}`).sort()).toEqual(['lft>a', 'pkg>a', 'pkg>lft']);
    expect(cartOverlaps(catalog, ['lft', 'd'])).toEqual([]);
    expect(cartOverlaps([], ['pkg', 'a'])).toEqual([]);
  });

  it('bad bundle JSON is treated as no members', () => {
    const bad: CartCatalogItem = { id: 'x', name: 'Broken', type: 'profile', parameters: '{not json' };
    expect(overlapOnAdd([bad, A], ['x'], 'a')).toBeNull();
  });

  it('message names the member and the bundle', () => {
    expect(overlapMessage({ container: LFT, member: A }))
      .toBe('“SGOT” is already included in “Liver Function Test” — the same test can\'t be ordered twice. Remove one of them.');
  });
});
