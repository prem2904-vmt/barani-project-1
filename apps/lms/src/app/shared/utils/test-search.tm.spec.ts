import { filterTestList, scoreTestSearch } from './test-search';

/**
 * Test Master single-source — Stage 1 safety net for test search / the order
 * picker. TODAY the picker matches a member test through the TYPED
 * `tests.Profile` tag ("Liver Function Test") and codes are matched as plain
 * strings. Phase 0 derives `tests.Profile` from profile membership; the
 * effective-list DTO (Phase 3) may merge master + override rows per key.
 */
const alt = { id: 'alt', name: 'SGPT (ALT)', testCode: 'BIO021', profile: 'Liver Function Test', type: 'individual' };
const ast = { id: 'ast', name: 'SGOT (AST)', testCode: 'BIO022', profile: null, type: 'individual' };
const lft = { id: 'lft', name: 'Liver Function Test', testCode: 'LFT', type: 'profile',
  parameters: JSON.stringify({ items: [{ testId: 'alt' }, { testId: 'ast' }] }) };

describe('test search via tests.Profile (CURRENT)', () => {
  it('a member is found by its typed profile tag (substring + acronym)', () => {
    expect(scoreTestSearch(alt, 'liver')).toBeGreaterThan(0);
    expect(scoreTestSearch(alt, 'lft')).toBeGreaterThan(0);
  });

  it('a member WITHOUT the typed tag is not found by the profile it belongs to', () => {
    expect(scoreTestSearch(ast, 'liver')).toBe(0);
    const hits = filterTestList([alt, ast, lft], 'liver').map(t => t.id);
    expect(hits).toContain('alt');
    expect(hits).toContain('lft');
    expect(hits).not.toContain('ast');
  });

  it('exact code hit ranks first (master-shaped codes match like any string)', () => {
    expect(filterTestList([alt, ast], 'BIO022')[0].id).toBe('ast');
  });

  it.skip('TARGET phase 0: tests.Profile is DERIVED from profile membership — AST is found via "liver"/"LFT"', () => {
    const hits = filterTestList([alt, ast, lft], 'liver').map(t => t.id);
    expect(hits).toContain('ast');
  });

  it.skip('TARGET phase 3: effective list has ONE row per catalog key (master + override merged) — no duplicate hits', () => {
    const master = { ...alt, id: 'm-alt', origin: 'master', catalogKey: 'BIO021' };
    const override = { ...alt, id: 't-alt', origin: 'customised', catalogKey: 'BIO021' };
    expect(filterTestList([master, override], 'BIO021')).toHaveLength(1);
  });
});
